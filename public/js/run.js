// Starting runs, the live SSE event stream and the agent log.
import { $, api, esc, toast } from "./lib.js";
import { state } from "./state.js";
import { upsertAsset } from "./assets.js";
import { renderStyle } from "./styleGuide.js";
import { loadConversationInfo, loadProjectsQuiet } from "./projects.js";
import { bindUsageDialog, openUsageDialog, renderLiveUsage } from "./usage.js";

export function logEntry(cls, html) {
  const log = $("#log");
  if (log.querySelector(".muted:only-child")) log.innerHTML = "";
  const el = document.createElement("div");
  el.className = `entry ${cls}`;
  el.innerHTML = html;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

const TOOL_LABEL = {
  save_style_guide: "提炼风格指南",
  generate_image: "生成",
  review_asset: "审核",
  fix_tile_seams: "瓦片无缝化",
  align_sprite_frames: "对齐帧",
  remove_background: "重新去背景",
};

export function describeTool(name, input) {
  if (name === "generate_image") return `<b>${TOOL_LABEL[name]}</b> ${esc(input.name)} <span class="muted">[${esc(input.asset_type)}]</span>`;
  if (name === "review_asset") {
    const a = state.project.assets.find((x) => x.id === input.asset_id);
    return `<b>${TOOL_LABEL[name]}</b> ${esc(a?.name ?? input.asset_id)} → ${input.verdict === "approved" ? "通过" : "驳回"} ${input.consistency_score}/10 <span class="muted">${esc(input.notes)}</span>`;
  }
  if (input?.asset_id) {
    const a = state.project.assets.find((x) => x.id === input.asset_id);
    return `<b>${TOOL_LABEL[name] ?? esc(name)}</b> ${esc(a?.name ?? input.asset_id)} <span class="muted">（后处理，不调用图像模型）</span>`;
  }
  return `<b>${TOOL_LABEL[name] ?? esc(name)}</b>`;
}

export function handleEvent(e) {
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

export function attachJob(jobId) {
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

export function finishJob() {
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


/** Start a run; `redraws` = [{ assetId, feedback }] asks the agent to redraw those assets. */
export async function run(extraRequest, redraws) {
  if (!state.project.refs.length) return toast("请先上传至少一张风格参考图");
  const request = extraRequest ?? $("#request").value.trim();
  if (!redraws?.length && !request && !state.selectedTypes.size) return toast("请选择素材类型或描述需求");
  $("#log").innerHTML = "";
  renderLiveUsage(null);
  try {
    const { jobId } = await api(`/api/projects/${state.project.id}/run`, {
      method: "POST",
      body: {
        request,
        assetTypes: redraws?.length ? [] : [...state.selectedTypes],
        provider: $("#providerSelect").value,
        redraws,
        continueConversation: $("#continueConv").checked,
        budget: readBudget(),
      },
    });
    attachJob(jobId);
  } catch (e) {
    if (e.data?.jobId) attachJob(e.data.jobId);
    else toast(e.message);
  }
}


export function resumeJob() {
  let jobId = null;
  try { jobId = localStorage.getItem(`gaa.job.${state.project.id}`); } catch {}
  if (jobId && !state.job) attachJob(jobId);
}


/** Per-run limits from the budget popover; empty fields are left out so server defaults apply. */
function readBudget() {
  const out = {};
  const images = $("#budgetImages").value.trim();
  const usd = $("#budgetUsd").value.trim();
  if (images !== "") out.maxImages = Number(images);
  if (usd !== "") out.maxUsd = Number(usd);
  return out;
}

function bindBudget() {
  const d = state.config.budget ?? {};
  $("#budgetImages").placeholder = d.maxImages ? `默认 ${d.maxImages}` : "默认不限";
  $("#budgetUsd").placeholder = d.maxUsd ? `默认 $${d.maxUsd}` : "默认不限";
  try {
    const saved = JSON.parse(localStorage.getItem("gaa.budget") ?? "{}");
    if (saved.images !== undefined) $("#budgetImages").value = saved.images;
    if (saved.usd !== undefined) $("#budgetUsd").value = saved.usd;
  } catch {}
  const summary = () => {
    const b = readBudget();
    const parts = [
      b.maxImages !== undefined ? (b.maxImages > 0 ? `${b.maxImages} 张` : "不限张数") : "",
      b.maxUsd !== undefined ? (b.maxUsd > 0 ? `$${b.maxUsd}` : "不限费用") : "",
    ].filter(Boolean);
    $("#budget summary").textContent = parts.length ? `预算：${parts.join(" · ")}` : "预算";
  };
  $("#budget").addEventListener("input", () => {
    try { localStorage.setItem("gaa.budget", JSON.stringify({ images: $("#budgetImages").value, usd: $("#budgetUsd").value })); } catch {}
    summary();
  });
  summary();
}

/** Asset-type chips, provider picker and run controls. */
export function bindRun() {
  bindBudget();
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

  $("#runBtn").addEventListener("click", () => run());
  $("#usageBar").addEventListener("click", (e) => e.target.closest("[data-usage-open]") && openUsageDialog(state.project.id));
  $("#usageBtn").addEventListener("click", () => openUsageDialog(state.project.id));
  bindUsageDialog(() => state.project.id);
  $("#stopBtn").addEventListener("click", () => state.job && api(`/api/jobs/${state.job}/stop`, { method: "POST" }));
  $("#request").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); });
  $("#showThinking").addEventListener("change", (e) => $("#log").classList.toggle("hide-thinking", !e.target.checked));
}
