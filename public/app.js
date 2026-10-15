import { $, api, esc, toast } from "./lib.js";
import { openUsageDialog, renderLiveUsage } from "./usage.js";

const state = {
  config: null,
  project: null,
  selectedTypes: new Set(),
  filter: "all",
  job: null,
  source: null,
  textEntry: null,
};

const fileUrl = (rel) => `/api/projects/${state.project.id}/files/${rel}`;

// ---------------- projects ----------------

async function loadProjects(selectId) {
  const list = await api("/api/projects");
  const sel = $("#projectSelect");
  if (!list.length) {
    const p = await api("/api/projects", { method: "POST", body: { name: "我的第一个项目" } });
    return loadProjects(p.id);
  }
  sel.innerHTML = list.map((p) => `<option value="${p.id}">${esc(p.name)}（${p.assets}）</option>`).join("");
  const id = selectId || localStorage.getItem("gaa.project") || list[0].id;
  sel.value = list.some((p) => p.id === id) ? id : list[0].id;
  await openProject(sel.value);
}

async function openProject(id) {
  try { localStorage.setItem("gaa.project", id); } catch {}
  state.project = await api(`/api/projects/${id}`);
  renderAll();
}

async function loadConversationInfo() {
  const info = await api(`/api/projects/${state.project.id}/conversation`);
  const bar = $("#convBar");
  bar.hidden = !info.runs.length;
  if (!info.runs.length) return;
  const recent = info.runs.slice(-3).map((r) => `<li>${esc(r.request || "（按所选类型生成）")}</li>`).join("");
  bar.innerHTML = `<div class="conv-head"><span>对话已进行 <b>${info.runs.length}</b> 轮 · ${(info.bytes / 1048576).toFixed(1)} MB</span>
    <button class="btn link" id="newConv">开启新对话</button></div><ol start="${Math.max(1, info.runs.length - 2)}">${recent}</ol>`;
}

function renderAll() {
  loadConversationInfo();
  $("#exportApproved").href = `/api/projects/${state.project.id}/export.zip`;
  $("#exportAll").href = `/api/projects/${state.project.id}/export.zip?status=all`;
  $("#exportSized").href = `/api/projects/${state.project.id}/export.zip?sizes=1`;
  state.pixelKernel = /pixel|像素|8-?bit|16-?bit/i.test(JSON.stringify(state.project.styleGuide ?? ""));
  renderRefs();
  renderStyle();
  renderAssets();
}

// ---------------- refs ----------------

function renderRefs() {
  const refs = state.project.refs;
  $("#refs").innerHTML = refs
    .map((r) => `<div class="ref"><img src="${fileUrl(r.file)}" alt="${esc(r.originalName)}" /><button data-ref="${r.id}" title="移除">×</button></div>`)
    .join("");
}

async function uploadRefs(files) {
  const imgs = [...files].filter((f) => f.type.startsWith("image/"));
  if (!imgs.length) return;
  const fd = new FormData();
  imgs.slice(0, 8).forEach((f) => fd.append("images", f));
  toast("上传中…");
  try {
    state.project = await api(`/api/projects/${state.project.id}/refs`, { method: "POST", body: fd });
    renderRefs();
    toast(`已添加 ${imgs.length} 张参考图`);
  } catch (e) {
    toast(e.message);
  }
}

// ---------------- style guide ----------------

const STYLE_FIELDS = [
  ["rendering", "技法"],
  ["line_and_edges", "线条"],
  ["lighting_and_shading", "光影"],
  ["perspective", "视角"],
  ["proportions", "比例"],
  ["texture_and_detail", "细节"],
  ["mood", "氛围"],
];

const EMPTY_STYLE = {
  summary: "", palette: [{ hex: "#222222", role: "描边" }, { hex: "#ffffff", role: "高光" }, { hex: "#e2562b", role: "主色" }],
  rendering: "", line_and_edges: "", lighting_and_shading: "", perspective: "", proportions: "",
  texture_and_detail: "", mood: "", avoid: [], prompt_prefix: "",
};

function paletteRow(c) {
  return `<div class="pal-row">
    <input type="color" value="${esc(c.hex)}" data-pal="pick" />
    <input type="text" value="${esc(c.hex)}" data-pal="hex" maxlength="7" />
    <input type="text" value="${esc(c.role)}" data-pal="role" placeholder="用途" />
    <button type="button" class="btn link" data-pal="del" title="删除">×</button>
  </div>`;
}

function renderStyleEditor() {
  const sg = state.project.styleGuide ?? EMPTY_STYLE;
  const box = $("#styleGuide");
  box.className = "style-guide editing";
  box.innerHTML = `<form id="styleForm">
    <label>概述<textarea name="summary" rows="2">${esc(sg.summary)}</textarea></label>
    <div class="field-label">色板</div>
    <div id="palRows">${sg.palette.map(paletteRow).join("")}</div>
    <button type="button" class="btn link" id="addColor">+ 添加颜色</button>
    ${STYLE_FIELDS.map(([k, l]) => `<label>${l}<textarea name="${k}" rows="2">${esc(sg[k])}</textarea></label>`).join("")}
    <label>避免（每行一条）<textarea name="avoid" rows="2">${esc((sg.avoid ?? []).join("\n"))}</textarea></label>
    <label>Prompt 前缀（英文，生成时拼在每条 prompt 前）<textarea name="prompt_prefix" rows="4">${esc(sg.prompt_prefix)}</textarea></label>
    <div class="form-actions"><button class="btn primary" type="submit">保存</button><button class="btn ghost" type="button" id="cancelStyle">取消</button></div>
  </form>`;
}

async function saveStyle(form) {
  const fd = new FormData(form);
  const palette = [...form.querySelectorAll(".pal-row")].map((r) => ({
    hex: r.querySelector('[data-pal="hex"]').value.trim(),
    role: r.querySelector('[data-pal="role"]').value.trim(),
  }));
  const body = { palette, avoid: String(fd.get("avoid")).split("\n").map((s) => s.trim()).filter(Boolean) };
  for (const k of ["summary", "prompt_prefix", ...STYLE_FIELDS.map(([k]) => k)]) body[k] = String(fd.get(k)).trim();
  try {
    state.project = await api(`/api/projects/${state.project.id}/style-guide`, { method: "PUT", body });
    renderStyle();
    toast("风格指南已保存，之后的生成都会使用它");
  } catch (e) {
    toast(e.message);
  }
}

function renderStyle() {
  const sg = state.project.styleGuide;
  $("#editStyle").textContent = sg ? "编辑" : "手动填写";
  const box = $("#styleGuide");
  $("#resetStyle").hidden = !sg;
  if (!sg) {
    box.className = "style-guide empty";
    box.textContent = "还没有风格指南，第一次运行时 Agent 会根据参考图自动生成。";
    return;
  }
  box.className = "style-guide";
  box.innerHTML = `
    <p class="summary">${esc(sg.summary)}</p>
    <div class="palette">${sg.palette
      .map((c) => `<div class="swatch" title="${esc(c.role)}"><i style="background:${esc(c.hex)}"></i>${esc(c.hex)}</div>`)
      .join("")}</div>
    <dl>${STYLE_FIELDS.map(([k, l]) => `<dt>${l}</dt><dd>${esc(sg[k])}</dd>`).join("")}
      ${sg.avoid?.length ? `<dt>避免</dt><dd>${esc(sg.avoid.join("；"))}</dd>` : ""}</dl>`;
}

// ---------------- assets ----------------

function renderAssets(newId) {
  const all = state.project.assets;
  const shown = all.filter((a) => state.filter === "all" || a.status === state.filter).slice().reverse();
  $("#assetCount").textContent = all.length ? `${all.filter((a) => a.status === "approved").length}/${all.length}` : "";
  const label = { approved: "✓ 通过", rejected: "✗ 驳回", pending_review: "… 审核中" };
  const typeName = (t) => state.config.assetTypes[t] ?? t;
  $("#assets").innerHTML = shown.length
    ? shown
        .map(
          (a) => `<div class="card ${a.status} ${a.id === newId ? "new" : ""}" data-asset="${a.id}">
            <div class="checker"><img loading="lazy" src="${fileUrl(a.gif ?? a.file)}" alt="${esc(a.name)}" /></div>
            <div class="meta"><span class="name">${esc(a.name)}</span>
              <span class="sub"><span>${esc(typeName(a.assetType))}</span><span class="badge ${a.status}">${label[a.status]}${a.score ? ` ${a.score}/10` : ""}</span></span>
            </div></div>`,
        )
        .join("")
    : `<p class="empty">${all.length ? "没有符合筛选的素材" : "生成的素材会出现在这里"}</p>`;
}

function upsertAsset(asset) {
  const list = state.project.assets;
  const i = list.findIndex((a) => a.id === asset.id);
  if (i >= 0) list[i] = asset;
  else list.push(asset);
  renderAssets(i >= 0 ? undefined : asset.id);
}

function openViewer(id) {
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
}

function tileSection(a) {
  return `<div class="tile-check">
    <div class="sizes-head"><b>无缝平铺检查</b><span class="seam-result muted">检测中…</span></div>
    <div class="tile-grid" style="background-image:url('${fileUrl(a.file)}?t=${Date.now()}')"></div>
  </div>`;
}

async function loadSeams(id) {
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

function sizeSection(a) {
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

function versionLinks(a) {
  const parent = a.parentId && state.project.assets.find((x) => x.id === a.parentId);
  const children = state.project.assets.filter((x) => x.parentId === a.id);
  if (!parent && !children.length) return "";
  return `<div class="versions">${parent ? `<button class="btn link" data-open="${parent.id}">← 上一版本</button>` : ""}
    ${children.map((c, i) => `<button class="btn link" data-open="${c.id}">新版本 ${i + 1} →</button>`).join("")}</div>`;
}

function spriteSection(a) {
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

// ---------------- run + log ----------------

function logEntry(cls, html) {
  const log = $("#log");
  if (log.querySelector(".muted:only-child")) log.innerHTML = "";
  const el = document.createElement("div");
  el.className = `entry ${cls}`;
  el.innerHTML = html;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

const TOOL_LABEL = { save_style_guide: "提炼风格指南", generate_image: "生成", review_asset: "审核" };

function describeTool(name, input) {
  if (name === "generate_image") return `<b>${TOOL_LABEL[name]}</b> ${esc(input.name)} <span class="muted">[${esc(input.asset_type)}]</span>`;
  if (name === "review_asset") {
    const a = state.project.assets.find((x) => x.id === input.asset_id);
    return `<b>${TOOL_LABEL[name]}</b> ${esc(a?.name ?? input.asset_id)} → ${input.verdict === "approved" ? "通过" : "驳回"} ${input.consistency_score}/10 <span class="muted">${esc(input.notes)}</span>`;
  }
  return `<b>${TOOL_LABEL[name] ?? esc(name)}</b>`;
}

function handleEvent(e) {
  if (e.type !== "text") state.textEntry = null;
  switch (e.type) {
    case "status": logEntry("status", esc(e.text)); break;
    case "text":
      if (!state.textEntry) state.textEntry = logEntry("text", "");
      state.textEntry.textContent += e.delta;
      $("#log").scrollTop = $("#log").scrollHeight;
      break;
    case "thinking": logEntry("thinking", esc(e.text)); break;
    case "tool": logEntry("tool", describeTool(e.name, e.input)); break;
    case "style": state.project.styleGuide = e.styleGuide; renderStyle(); break;
    case "asset": upsertAsset(e.asset); break;
    case "error": logEntry("error", esc(e.message)); break;
    case "usage": renderLiveUsage(e.usage); break;
    case "done": finishJob(); break;
  }
}

function attachJob(jobId) {
  state.job = jobId;
  try { localStorage.setItem(`gaa.job.${state.project.id}`, jobId); } catch {}
  $("#runBtn").disabled = true;
  $("#runBtn").textContent = "生成中…";
  $("#stopBtn").hidden = false;
  state.source?.close();
  const src = new EventSource(`/api/jobs/${jobId}/events`);
  state.source = src;
  src.onmessage = (m) => handleEvent(JSON.parse(m.data));
  src.onerror = () => {
    // The job is gone (server restart) or finished; stop retrying.
    if (!state.job) return;
    src.close();
    finishJob();
  };
}

function finishJob() {
  state.source?.close();
  state.source = null;
  state.job = null;
  state.textEntry = null;
  try { localStorage.removeItem(`gaa.job.${state.project.id}`); } catch {}
  $("#runBtn").disabled = false;
  $("#runBtn").textContent = "开始生成";
  $("#stopBtn").hidden = true;
  if (state.project) loadConversationInfo();
  loadProjectsQuiet();
}

async function loadProjectsQuiet() {
  const list = await api("/api/projects");
  const sel = $("#projectSelect");
  const cur = sel.value;
  sel.innerHTML = list.map((p) => `<option value="${p.id}">${esc(p.name)}（${p.assets}）</option>`).join("");
  sel.value = cur;
}

async function run(extraRequest, redraw) {
  if (!state.project.refs.length) return toast("请先上传至少一张风格参考图");
  const request = extraRequest ?? $("#request").value.trim();
  if (!redraw && !request && !state.selectedTypes.size) return toast("请选择素材类型或描述需求");
  $("#log").innerHTML = "";
  renderLiveUsage(null);
  try {
    const { jobId } = await api(`/api/projects/${state.project.id}/run`, {
      method: "POST",
      body: {
        request,
        assetTypes: redraw ? [] : [...state.selectedTypes],
        provider: $("#providerSelect").value,
        redraw,
        continueConversation: $("#continueConv").checked,
      },
    });
    attachJob(jobId);
  } catch (e) {
    if (e.data?.jobId) attachJob(e.data.jobId);
    else toast(e.message);
  }
}

// ---------------- init ----------------

async function init() {
  state.config = await api("/api/config");
  const chips = $("#typeChips");
  chips.innerHTML = Object.entries(state.config.assetTypes)
    .map(([k, v]) => `<button class="chip" data-type="${k}">${esc(v)}</button>`)
    .join("");
  const ps = $("#providerSelect");
  ps.innerHTML = state.config.providers
    .map((p) => `<option value="${p.id}" ${p.available ? "" : "disabled"}>${esc(p.label)}${p.available ? "" : "（未配置）"}</option>`)
    .join("");
  ps.value = state.config.providers.find((p) => p.available)?.id;
  if (state.config.demo) logEntry("status", "当前为演示模式（AGENT_MODE=demo）：不调用 Claude，仅走一遍流水线。");

  chips.addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    const t = b.dataset.type;
    state.selectedTypes.has(t) ? state.selectedTypes.delete(t) : state.selectedTypes.add(t);
    b.classList.toggle("on");
  });

  $("#projectSelect").addEventListener("change", (e) => openProject(e.target.value).then(resumeJob));
  $("#newProject").addEventListener("click", async () => {
    const name = prompt("项目名称", "新项目");
    if (name === null) return;
    const p = await api("/api/projects", { method: "POST", body: { name } });
    await loadProjects(p.id);
  });
  $("#deleteProject").addEventListener("click", async () => {
    if (!confirm(`删除项目「${state.project.name}」及其全部素材？此操作不可撤销。`)) return;
    await api(`/api/projects/${state.project.id}`, { method: "DELETE" });
    try { localStorage.removeItem("gaa.project"); } catch {}
    await loadProjects();
  });

  const dz = $("#dropzone");
  $("#refInput").addEventListener("change", (e) => { uploadRefs(e.target.files); e.target.value = ""; });
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("over"));
  dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("over"); uploadRefs(e.dataTransfer.files); });
  document.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length && !e.target.closest?.("textarea")) uploadRefs(files);
  });
  $("#refs").addEventListener("click", async (e) => {
    const id = e.target.dataset?.ref;
    if (!id) return;
    state.project = await api(`/api/projects/${state.project.id}/refs/${id}`, { method: "DELETE" });
    renderRefs();
  });

  $("#editStyle").addEventListener("click", renderStyleEditor);
  const sgBox = $("#styleGuide");
  sgBox.addEventListener("submit", (e) => {
    e.preventDefault();
    saveStyle(e.target);
  });
  sgBox.addEventListener("click", (e) => {
    if (e.target.id === "cancelStyle") renderStyle();
    else if (e.target.id === "addColor") $("#palRows").insertAdjacentHTML("beforeend", paletteRow({ hex: "#888888", role: "" }));
    else if (e.target.dataset.pal === "del") e.target.closest(".pal-row").remove();
  });
  sgBox.addEventListener("input", (e) => {
    const row = e.target.closest(".pal-row");
    if (!row) return;
    if (e.target.dataset.pal === "pick") row.querySelector('[data-pal="hex"]').value = e.target.value;
    if (e.target.dataset.pal === "hex" && /^#[0-9a-fA-F]{6}$/.test(e.target.value)) row.querySelector('[data-pal="pick"]').value = e.target.value;
  });
  $("#resetStyle").addEventListener("click", async () => {
    if (!confirm("清空当前风格指南？下次运行时 Agent 会重新从参考图提炼。")) return;
    state.project = await api(`/api/projects/${state.project.id}`, { method: "PATCH", body: { resetStyle: true } });
    renderStyle();
  });

  $("#runBtn").addEventListener("click", () => run());
  $("#convBar").addEventListener("click", async (e) => {
    if (e.target.id !== "newConv") return;
    if (!confirm("清空与 Agent 的对话记忆？风格指南和已生成的素材都会保留。")) return;
    await api(`/api/projects/${state.project.id}/conversation`, { method: "DELETE" });
    loadConversationInfo();
    toast("已开启新对话");
  });
  $("#usageBar").addEventListener("click", (e) => e.target.closest("[data-usage-open]") && openUsageDialog(state.project.id));
  $("#usageBtn").addEventListener("click", () => openUsageDialog(state.project.id));
  $("#stopBtn").addEventListener("click", () => state.job && api(`/api/jobs/${state.job}/stop`, { method: "POST" }));
  $("#request").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); });
  $("#showThinking").addEventListener("change", (e) => $("#log").classList.toggle("hide-thinking", !e.target.checked));

  $("#filters").addEventListener("click", (e) => {
    const f = e.target.dataset?.filter;
    if (!f) return;
    state.filter = f;
    document.querySelectorAll("#filters button").forEach((b) => b.classList.toggle("on", b.dataset.filter === f));
    renderAssets();
  });
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

  await loadProjects();
  resumeJob();
}

function resumeJob() {
  let jobId = null;
  try { jobId = localStorage.getItem(`gaa.job.${state.project.id}`); } catch {}
  if (jobId && !state.job) attachJob(jobId);
}

init().catch((e) => toast(e.message));
