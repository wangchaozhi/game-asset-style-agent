// Sprite sheets: animation preview, frame strip, re-slicing and frame alignment.
import { $, api, esc } from "../lib.js";
import { fileUrl, state } from "../state.js";
import { onSubmit } from "./common.js";

export function html(a) {
  if (a.assetType !== "sprite_sheet") return "";
  const frameFiles = a.frames ?? [];
  return `<div class="sprite">
      ${a.gif ? `<div class="checker sprite-gif"><img src="${fileUrl(a.gif)}?t=${Date.now()}" alt="动画预览" /></div>` : ""}
      ${frameFiles.length ? `<div class="frame-strip">${frameFiles.map((f, i) => `<a class="checker" href="${fileUrl(f)}" download="${esc(a.name)}_${i}.png" title="下载第 ${i + 1} 帧"><img src="${fileUrl(f)}?t=${Date.now()}" alt="帧 ${i + 1}" /></a>`).join("")}</div>` : ""}
      <form class="slice-form" data-slice="${a.id}">
        <label>帧数 <input name="frames" type="number" min="1" max="32" value="${frameFiles.length || 4}" /></label>
        <label>FPS <input name="fps" type="number" min="1" max="30" value="${a.fps ?? 8}" /></label>
        <button class="btn ghost" type="submit">${frameFiles.length ? "重新切帧" : "切帧"}</button>
        ${a.gif ? `<a class="btn ghost" href="${fileUrl(a.gif)}" download="${esc(a.name)}.gif">下载 GIF</a>` : ""}
      </form>
      <form class="align-form" data-align="${a.id}">
        <span class="jitter muted">帧抖动检测中…</span>
        <select name="mode"><option value="bottom">底边居中（角色）</option><option value="center">中心（特效 / 漂浮物）</option></select>
        <button class="btn ghost" type="submit">对齐帧（生成新版本）</button>
      </form>
    </div>`;
}

export const load = (a) => a.assetType === "sprite_sheet" && loadJitter(a.id);

/** How far the content drifts between frames; > 2px is visible as jitter. */
export async function loadJitter(id, mode = "bottom") {
  const el = $("#viewerMeta .jitter");
  try {
    const r = await api(`/api/projects/${state.project.id}/assets/${id}/jitter?mode=${mode}`);
    if (!el?.isConnected) return;
    const worst = Math.max(r.horizontal, r.vertical);
    el.className = `jitter ${worst <= 2 ? "ok" : worst <= 8 ? "warn" : "bad"}`;
    el.textContent = `帧抖动：水平 ${r.horizontal}px · ${mode === "bottom" ? "底边" : "垂直"} ${r.vertical}px`;
  } catch (err) {
    if (el) el.textContent = err.message;
  }
}

export function bind(root, ctx) {
  onSubmit(root, "form[data-slice]", async (form, fd) => {
    const asset = await api(`/api/projects/${state.project.id}/assets/${form.dataset.slice}/slice`, {
      method: "POST",
      body: { frames: Number(fd.get("frames")), fps: Number(fd.get("fps")) },
    });
    ctx.show(asset, `已切成 ${asset.frames.length} 帧`);
  });
  onSubmit(root, "form[data-align]", async (form, fd) => {
    const { asset, before, after } = await api(`/api/projects/${state.project.id}/assets/${form.dataset.align}/align-frames`, {
      method: "POST",
      body: { mode: fd.get("mode") },
    });
    ctx.show(asset, `已对齐：水平 ${before.horizontal}→${after.horizontal}px，垂直 ${before.vertical}→${after.vertical}px`);
  });
  root.addEventListener("change", (e) => {
    const form = e.target.closest("form[data-align]");
    if (form && e.target.name === "mode") loadJitter(form.dataset.align, e.target.value);
  });
}
