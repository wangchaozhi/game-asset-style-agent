// Asset viewer dialog: review, redraw, sprite slicing, tile seams, game sizes, background cut-out.
import { $, api, esc, toast } from "./lib.js";
import { fileUrl, state } from "./state.js";
import { upsertAsset, renderAssets } from "./assets.js";
import { run } from "./run.js";

export function openViewer(id) {
  const a = state.project.assets.find((x) => x.id === id);
  if (!a) return;
  $("#viewerImg").src = fileUrl(a.file);
  $("#viewerMeta").innerHTML = `
    <h3 style="margin:0">${esc(a.name)}</h3>
    <div class="muted">${esc(state.config.assetTypes[a.assetType] ?? a.assetType)} · ${esc(a.provider)} · ${new Date(a.createdAt).toLocaleString()}</div>
    ${a.notes ? `<div><b>${a.reviewer === "user" ? "我的意见" : "Agent 审核"}：</b>${esc(a.notes)}${a.score && a.reviewer !== "user" ? `（一致性 ${a.score}/10）` : ""}</div>` : ""}
    ${versionLinks(a)}
    <div class="review">
      <div class="verdict">
        <button class="btn ghost ${a.status === "approved" ? "on-ok" : ""}" data-verdict="approved">✓ 通过</button>
        <button class="btn ghost ${a.status === "rejected" ? "on-bad" : ""}" data-verdict="rejected">✗ 驳回</button>
      </div>
      <textarea id="feedback" rows="2" placeholder="修改意见，例如：剑身改成蓝色，描边再粗一点"></textarea>
      <button class="btn primary" data-redraw="${a.id}">按意见重画</button>
    </div>
    ${a.assetType === "sprite_sheet" ? spriteSection(a) : ""}
    ${a.assetType === "tile" ? tileSection(a) : ""}
    ${state.project.styleGuide ? `<div class="palette-check"><div class="sizes-head"><b>色板一致性</b><span class="pal-result muted">检测中…</span></div></div>` : ""}
    ${sizeSection(a)}
    <form class="cutout-form" data-cutout="${a.id}">
      <label>去背景容差 <input name="tolerance" type="range" min="4" max="100" value="28" /><output>28</output></label>
      <button class="btn ghost" type="submit">${a.originalFile ? "重新抠图" : "去除背景"}</button>
      ${a.originalFile ? `<button class="btn ghost" type="button" data-restore="${a.id}">恢复原图</button>` : ""}
    </form>
    <div><b>Prompt</b></div><pre>${esc(a.prompt)}</pre>
    <div class="actions">
      <a class="btn primary" href="${fileUrl(a.file)}" download="${esc(a.name)}.${a.file.split(".").pop()}">下载</a>
      <button class="btn ghost" data-variant="${a.id}">基于此图继续生成</button>
      <button class="btn ghost danger" data-del-asset="${a.id}">删除</button>
    </div>`;
  $("#viewer").showModal();
  if (a.assetType === "tile") loadSeams(a.id);
  if (state.project.styleGuide) loadPalette(a.id);
}

const pct = (x) => `${Math.round(x * 100)}%`;

/** Palette check: share of pixels on-palette, per-colour usage bar, and the main off-palette colours. */
export async function loadPalette(id) {
  const box = $("#viewerMeta .palette-check");
  const label = box?.querySelector(".pal-result");
  try {
    const r = await api(`/api/projects/${state.project.id}/assets/${id}/palette`);
    if (!box?.isConnected) return;
    const level = r.coverage >= 0.8 ? "ok" : r.coverage >= 0.55 ? "warn" : "bad";
    label.className = `pal-result ${level}`;
    label.textContent = `${pct(r.coverage)} 在色板内 · 平均色差 ΔE ${r.meanDeltaE}`;
    const offShare = Math.max(0, 1 - r.coverage);
    const segs = r.usage
      .filter((u) => u.share > 0)
      .map((u) => `<i style="flex:${u.share};background:${esc(u.hex)}" title="${esc(u.hex)} · ${pct(u.share)}"></i>`)
      .join("");
    box.insertAdjacentHTML(
      "beforeend",
      `<div class="pal-bar" title="每段宽度 = 最接近该色板颜色的像素占比">${segs}</div>
      ${
        r.offPalette.length
          ? `<div class="pal-off"><span class="muted">色板外：</span>${r.offPalette
              .map((o) => `<span class="pal-chip"><i style="background:${esc(o.hex)}"></i>${esc(o.hex)} ${pct(o.share)}</span>`)
              .join("")}</div>`
          : `<div class="muted pal-off">没有明显的色板外颜色${offShare > 0.02 ? "（零散的过渡色）" : ""}</div>`
      }`,
    );
  } catch (err) {
    if (label) label.textContent = err.message;
  }
}

export function tileSection(a) {
  return `<div class="tile-check">
    <div class="sizes-head"><b>无缝平铺检查</b><span class="seam-result muted">检测中…</span></div>
    <div class="tile-grid" style="background-image:url('${fileUrl(a.file)}?t=${Date.now()}')"></div>
  </div>`;
}

export async function loadSeams(id) {
  const el = $("#viewerMeta .seam-result");
  try {
    const r = await api(`/api/projects/${state.project.id}/assets/${id}/seams`);
    if (!el.isConnected) return;
    const bad = [!r.horizontalOk && "左右", !r.verticalOk && "上下"].filter(Boolean).join("、");
    el.className = `seam-result ${r.seamless ? "ok" : "bad"}`;
    el.textContent = r.seamless
      ? `✓ 可无缝平铺（左右差 ${r.horizontalDiff}，上下差 ${r.verticalDiff}）`
      : `✗ ${bad}边缘有接缝（左右差 ${r.horizontalDiff}，上下差 ${r.verticalDiff}，基线 ${r.baseline}）`;
  } catch (err) {
    el.textContent = err.message;
  }
}

export function sizeSection(a) {
  const presets = state.config.sizePresets[a.assetType] ?? [];
  const base = `/api/projects/${state.project.id}/assets/${a.id}/sized.png`;
  return `<div class="sizes">
    <div class="sizes-head"><b>游戏尺寸</b>
      <label class="toggle"><input type="checkbox" id="pixelKernel" ${state.pixelKernel ? "checked" : ""} /> 像素风（最近邻）</label></div>
    <div class="size-row">${presets
      .map((s) => `<a class="size-chip" data-size="${s}" href="${base}?size=${s}&kernel=${state.pixelKernel ? "nearest" : "smooth"}&download=1">${s}</a>`)
      .join("")}
      <input class="size-custom" placeholder="自定义 48 / 300x200" data-base="${base}" /></div>
    <div class="size-preview checker" hidden><img alt="缩放预览" /></div>
  </div>`;
}

export function versionLinks(a) {
  const parent = a.parentId && state.project.assets.find((x) => x.id === a.parentId);
  const children = state.project.assets.filter((x) => x.parentId === a.id);
  if (!parent && !children.length) return "";
  return `<div class="versions">${parent ? `<button class="btn link" data-open="${parent.id}">← 上一版本</button>` : ""}
    ${children.map((c, i) => `<button class="btn link" data-open="${c.id}">新版本 ${i + 1} →</button>`).join("")}</div>`;
}

export function spriteSection(a) {
  const frames = a.frames ?? [];
  return `<div class="sprite">
      ${a.gif ? `<div class="checker sprite-gif"><img src="${fileUrl(a.gif)}?t=${Date.now()}" alt="动画预览" /></div>` : ""}
      ${frames.length ? `<div class="frame-strip">${frames.map((f, i) => `<a class="checker" href="${fileUrl(f)}" download="${esc(a.name)}_${i}.png" title="下载第 ${i + 1} 帧"><img src="${fileUrl(f)}?t=${Date.now()}" alt="帧 ${i + 1}" /></a>`).join("")}</div>` : ""}
      <form class="slice-form" data-slice="${a.id}">
        <label>帧数 <input name="frames" type="number" min="1" max="32" value="${frames.length || 4}" /></label>
        <label>FPS <input name="fps" type="number" min="1" max="30" value="${a.fps ?? 8}" /></label>
        <button class="btn ghost" type="submit">${frames.length ? "重新切帧" : "切帧"}</button>
        ${a.gif ? `<a class="btn ghost" href="${fileUrl(a.gif)}" download="${esc(a.name)}.gif">下载 GIF</a>` : ""}
      </form>
    </div>`;
}


export function bindViewer() {
  $("#assets").addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (card) openViewer(card.dataset.asset);
  });
  $("#viewerMeta").addEventListener("change", (e) => {
    if (e.target.id === "pixelKernel") {
      state.pixelKernel = e.target.checked;
      const id = $("#viewerMeta").querySelector("[data-redraw]").dataset.redraw;
      openViewer(id);
    }
  });
  $("#viewerMeta").addEventListener("mouseover", (e) => {
    const chip = e.target.closest(".size-chip");
    if (!chip) return;
    const box = $("#viewerMeta .size-preview");
    box.hidden = false;
    const img = box.querySelector("img");
    // Show small sizes enlarged so pixel crispness can be judged.
    img.onload = () => (img.style.width = `${Math.min(img.naturalWidth * (img.naturalWidth <= 64 ? 4 : 1), 280)}px`);
    img.src = chip.href.replace("&download=1", "");
  });
  $("#viewerMeta").addEventListener("keydown", (e) => {
    if (!e.target.classList.contains("size-custom") || e.key !== "Enter") return;
    e.preventDefault();
    const v = e.target.value.trim().toLowerCase().replace("×", "x");
    if (!/^\d{1,4}(x\d{1,4})?$/.test(v)) return toast("格式：48 或 300x200");
    location.href = `${e.target.dataset.base}?size=${v}&kernel=${state.pixelKernel ? "nearest" : "smooth"}&download=1`;
  });
  $("#viewerMeta").addEventListener("input", (e) => {
    if (e.target.name === "tolerance") e.target.nextElementSibling.value = e.target.value;
  });
  const cutout = async (id, body) => {
    try {
      const asset = await api(`/api/projects/${state.project.id}/assets/${id}/cutout`, { method: "POST", body });
      upsertAsset(asset);
      openViewer(asset.id);
      toast(body.restore ? "已恢复原图" : "背景已去除");
    } catch (err) {
      toast(err.message);
    }
  };
  $("#viewerMeta").addEventListener("submit", (e) => {
    const form = e.target.closest("form[data-cutout]");
    if (!form) return;
    e.preventDefault();
    cutout(form.dataset.cutout, { tolerance: Number(new FormData(form).get("tolerance")) });
  });
  $("#viewerMeta").addEventListener("submit", async (e) => {
    const form = e.target.closest("form[data-slice]");
    if (!form) return;
    e.preventDefault();
    const fd = new FormData(form);
    try {
      const asset = await api(`/api/projects/${state.project.id}/assets/${form.dataset.slice}/slice`, {
        method: "POST",
        body: { frames: Number(fd.get("frames")), fps: Number(fd.get("fps")) },
      });
      upsertAsset(asset);
      openViewer(asset.id);
      toast(`已切成 ${asset.frames.length} 帧`);
    } catch (err) {
      toast(err.message);
    }
  });
  $("#viewerMeta").addEventListener("click", async (e) => {
    const ds = e.target.dataset ?? {};
    if (ds.restore) return cutout(ds.restore, { restore: true });
    if (ds.open) return openViewer(ds.open);
    if (ds.verdict) {
      const id = $("#viewerMeta").querySelector("[data-redraw]").dataset.redraw;
      const notes = $("#feedback").value.trim();
      const asset = await api(`/api/projects/${state.project.id}/assets/${id}`, {
        method: "PATCH",
        body: notes ? { status: ds.verdict, notes } : { status: ds.verdict },
      });
      upsertAsset(asset);
      openViewer(asset.id);
      return toast(ds.verdict === "approved" ? "已标记为通过" : "已标记为驳回");
    }
    if (ds.redraw) {
      if (state.job) return toast("已有任务在运行，请稍候");
      const feedback = $("#feedback").value.trim();
      if (!feedback) return toast("请先写下修改意见");
      $("#viewer").close();
      return run("", { assetId: ds.redraw, feedback });
    }
    const del = e.target.dataset?.delAsset;
    const variant = e.target.dataset?.variant;
    if (del) {
      state.project = await api(`/api/projects/${state.project.id}/assets/${del}`, { method: "DELETE" });
      $("#viewer").close();
      renderAssets();
    } else if (variant) {
      const a = state.project.assets.find((x) => x.id === variant);
      $("#viewer").close();
      $("#request").value = `以素材 ${a.id}（${a.name}）为一致性参考，`;
      $("#request").focus();
    }
  });

}
