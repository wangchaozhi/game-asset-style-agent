// Starting runs, the live SSE event stream and the agent log.
import { $, api, esc, toast } from "./lib.js";
import { state } from "./state.js";
import { has, t, typeLabel } from "./i18n.js";
import { upsertAsset } from "./assets.js";
import { renderStyle } from "./styleGuide.js";
import { loadConversationInfo, loadProjectsQuiet } from "./projects.js";
import { bindUsageDialog, openUsageDialog, renderLiveUsage } from "./usage.js";
import { bindNotify, jobFinished, jobProgress, jobStarted } from "./notify.js";

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

/** Tool names shown in the log (tool.*); unknown tools show their own name. */
const toolLabel = (name) => (has(`tool.${name}`) ? t(`tool.${name}`) : esc(name));

export function describeTool(name, input) {
  if (name === "generate_image") return `<b>${toolLabel(name)}</b> ${esc(input.name)} <span class="muted">[${esc(input.asset_type)}]</span>`;
  if (name === "review_asset") {
    const a = state.project.assets.find((x) => x.id === input.asset_id);
    return `<b>${toolLabel(name)}</b> ${esc(a?.name ?? input.asset_id)} → ${t(input.verdict === "approved" ? "compare.approved" : "compare.rejected")} ${input.consistency_score}/10 <span class="muted">${esc(input.notes)}</span>`;
  }
  if (input?.asset_id) {
    const a = state.project.assets.find((x) => x.id === input.asset_id);
    return `<b>${toolLabel(name)}</b> ${esc(a?.name ?? input.asset_id)} <span class="muted">${t("tool.postprocess")}</span>`;
  }
  return `<b>${toolLabel(name)}</b>`;
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
    case "asset":
      // Never mix a job's assets into another project's library.
      if (state.run?.projectId !== state.project.id) break;
      if (state.run && !state.run.known.has(e.asset.id)) {
        state.run.known.add(e.asset.id);
        jobProgress(++state.run.made);
      }
      upsertAsset(e.asset);
      break;
    case "error":
      if (state.run) state.run.error = e.message;
      logEntry("error", esc(e.message));
      break;
    case "usage": renderLiveUsage(e.usage); break;
    case "done": finishJob(); break;
  }
}

export function attachJob(jobId) {
  state.job = jobId;
  // Assets already in the library don't count as new when the event log is replayed.
  state.run = { projectId: state.project.id, known: new Set(state.project.assets.map((a) => a.id)), made: 0, error: null };
  jobStarted();
  try { localStorage.setItem(`gaa.job.${state.project.id}`, jobId); } catch {}
  $("#runBtn").disabled = true;
  $("#runBtn").textContent = t("run.running");
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

/**
 * Stop listening to the current job without forgetting it: it keeps running on the server and
 * resumeJob() re-attaches (replaying its events) when its project is opened again.
 */
export function detachJob() {
  state.source?.close();
  state.source = null;
  state.job = null;
  state.run = null;
  state.textEntry = null;
  $("#runBtn").disabled = false;
  $("#runBtn").textContent = t("run.start");
  $("#stopBtn").hidden = true;
  renderLiveUsage(null);
  $("#log").innerHTML = "";
  document.title = document.title.replace(/^⏳ (\(\d+\) )?[^·]+ · /, "");
}

export function finishJob() {
  if (state.run) jobFinished({ ok: !state.run.error, made: state.run.made, message: state.run.error });
  state.run = null;
  state.source?.close();
  state.source = null;
  state.job = null;
  state.textEntry = null;
  try { localStorage.removeItem(`gaa.job.${state.project.id}`); } catch {}
  $("#runBtn").disabled = false;
  $("#runBtn").textContent = t("run.start");
  $("#stopBtn").hidden = true;
  if (state.project) loadConversationInfo();
  loadProjectsQuiet();
}


/** Start a run; `redraws` = [{ assetId, feedback }] asks the agent to redraw those assets. */
export async function run(extraRequest, redraws) {
  if (!state.project.refs.length && !state.project.styleGuide) return toast(t("action.noStyle"));
  const request = extraRequest ?? $("#request").value.trim();
  if (!redraws?.length && !request && !state.selectedTypes.size) return toast(t("run.needInput"));
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


/** Start an action-set run for a character: one sprite sheet per action, generated by the agent. */
export async function runActionSet(assetId, actions) {
  $("#log").innerHTML = "";
  renderLiveUsage(null);
  try {
    const { jobId } = await api(`/api/projects/${state.project.id}/assets/${assetId}/action-set`, {
      method: "POST",
      body: { actions, provider: $("#providerSelect").value, continueConversation: $("#continueConv").checked, budget: readBudget() },
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

/** Budget placeholders (the server defaults) and the summary line, in the current language. */
function renderBudget() {
  const d = state.config.budget ?? {};
  $("#budgetImages").placeholder = d.maxImages ? t("run.default", { v: d.maxImages }) : t("run.defaultNone");
  $("#budgetUsd").placeholder = d.maxUsd ? t("run.default", { v: `$${d.maxUsd}` }) : t("run.defaultNone");
  const b = readBudget();
  const parts = [
    b.maxImages !== undefined ? (b.maxImages > 0 ? t("run.nImages", { n: b.maxImages }) : t("run.anyImages")) : "",
    b.maxUsd !== undefined ? (b.maxUsd > 0 ? `$${b.maxUsd}` : t("run.anyCost")) : "",
  ].filter(Boolean);
  $("#budget summary").textContent = parts.length ? t("run.budgetIs", { parts: parts.join(" · ") }) : t("run.budget");
}

function bindBudget() {
  try {
    const saved = JSON.parse(localStorage.getItem("gaa.budget") ?? "{}");
    if (saved.images !== undefined) $("#budgetImages").value = saved.images;
    if (saved.usd !== undefined) $("#budgetUsd").value = saved.usd;
  } catch {}
  $("#budget").addEventListener("input", () => {
    try { localStorage.setItem("gaa.budget", JSON.stringify({ images: $("#budgetImages").value, usd: $("#budgetUsd").value })); } catch {}
    renderBudget();
  });
  renderBudget();
}

/**
 * A project's saved run choices, cleaned up: only asset types that still exist and a provider that is
 * still usable (otherwise none, so the default applies). `raw` is the stored JSON or null.
 */
export function runPrefs(raw, assetTypes, usableProviders) {
  let saved = null;
  try { saved = JSON.parse(raw ?? "null"); } catch {}
  const types = Array.isArray(saved?.types) ? saved.types.filter((type) => assetTypes.includes(type)) : [];
  const provider = usableProviders.includes(saved?.provider) ? saved.provider : null;
  return { types, provider };
}

/** Asset-type chips, provider picker and run controls. */
export function bindRun() {
  bindBudget();
  document.addEventListener("gaa:project-switch", (e) => {
    if (state.job && state.run?.projectId === e.detail.from && e.detail.from !== e.detail.to) detachJob();
  });
  bindNotify();
  const chips = $("#typeChips");
  const ps = $("#providerSelect");
  const renderControls = () => {
    chips.innerHTML = Object.entries(state.config.assetTypes)
      .map(([k, v]) => `<button class="chip ${state.selectedTypes.has(k) ? "on" : ""}" data-type="${k}">${esc(typeLabel(k, v))}</button>`)
      .join("");
    const picked = ps.value;
    ps.innerHTML = state.config.providers
      .map((p) => `<option value="${p.id}" ${p.available ? "" : "disabled"}>${esc(has(`provider.${p.id}`) ? t(`provider.${p.id}`) : p.label)}${p.available ? "" : esc(t("run.unconfigured"))}</option>`)
      .join("");
    ps.value = picked || state.config.providers.find((p) => p.available)?.id;
    $("#runBtn").textContent = t(state.job ? "run.running" : "run.start");
    renderBudget();
  };
  renderControls();
  document.addEventListener("gaa:lang", renderControls);

  // Each project remembers its asset types and image model.
  const prefsKey = (id) => `gaa.run.${id}`;
  const savePrefs = () => {
    if (!state.project) return;
    try { localStorage.setItem(prefsKey(state.project.id), JSON.stringify({ types: [...state.selectedTypes], provider: ps.value })); } catch {}
  };
  document.addEventListener("gaa:project-switch", (e) => {
    let raw = null;
    try { raw = localStorage.getItem(prefsKey(e.detail.to)); } catch {}
    const usable = state.config.providers.filter((p) => p.available).map((p) => p.id);
    const prefs = runPrefs(raw, Object.keys(state.config.assetTypes), usable);
    state.selectedTypes = new Set(prefs.types);
    if (prefs.provider) ps.value = prefs.provider;
    renderControls();
  });
  ps.addEventListener("change", savePrefs);
  if (state.config.demo) logEntry("status", esc(t("run.demo")));

  chips.addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    const type = b.dataset.type;
    state.selectedTypes.has(type) ? state.selectedTypes.delete(type) : state.selectedTypes.add(type);
    b.classList.toggle("on");
    savePrefs();
  });

  $("#runBtn").addEventListener("click", () => run());
  $("#usageBar").addEventListener("click", (e) => e.target.closest("[data-usage-open]") && openUsageDialog(state.project.id));
  $("#usageBtn").addEventListener("click", () => openUsageDialog(state.project.id));
  bindUsageDialog(() => state.project.id);
  $("#stopBtn").addEventListener("click", () => state.job && api(`/api/jobs/${state.job}/stop`, { method: "POST" }));
  $("#request").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); });
  $("#showThinking").addEventListener("change", (e) => $("#log").classList.toggle("hide-thinking", !e.target.checked));
}
