// Consistency overview: assets ranked by drift from the project's style, with batch redraw.
import { $, api, esc, toast } from "./lib.js";
import { state, thumbUrl } from "./state.js";
import { run } from "./run.js";
import { getLang, t, typeLabel } from "./i18n.js";

/** At most this many assets per redraw run, as in the library's batch redraw. */
const MAX_REDRAW = 10;

let report = null;

/** Redraw feedback for a drifting asset: its reasons, then the nudge back to the style. */
export const feedbackOf = (item) => t("drift.feedback", { reasons: item.reasons.join(t("drift.sep")) });

/** CSV of the report in view: same tag scope, in the interface language. */
function csvUrl() {
  const q = new URLSearchParams({ lang: getLang() });
  if ($("#consistencyTag").value) q.set("tag", $("#consistencyTag").value);
  return `/api/projects/${state.project.id}/consistency.csv?${q}`;
}

function render() {
  const body = $("#consistencyBody");
  const pct = (x) => `${Math.round(x * 100)}%`;
  const byId = new Map(state.project.assets.map((a) => [a.id, a]));
  const rows = report.items.filter((i) => byId.has(i.id));
  const drifting = rows.filter((i) => i.reasons.length);
  body.innerHTML = `<p class="muted">${t($("#consistencyTag").value ? "drift.medianGroup" : "drift.medianProject", { coverage: pct(report.medianCoverage), de: Math.round(report.medianDeltaE * 10) / 10 })}
      ${drifting.length ? t("drift.found", { n: drifting.length, max: MAX_REDRAW }) : t("drift.none")}</p>
    <ol class="drift-list">${rows
      .map((i, n) => {
        const a = byId.get(i.id);
        const checked = i.reasons.length && drifting.indexOf(i) < MAX_REDRAW;
        return `<li class="drift-row ${i.reasons.length ? "off" : ""}">
          <input type="checkbox" data-drift="${i.id}" ${checked ? "checked" : ""} aria-label="${t("drift.pick", { name: esc(a.name) })}" />
          <button class="drift-thumb checker" data-open-asset="${i.id}" title="${t("drift.open")}"><img loading="lazy" src="${thumbUrl(a.gif ?? a.file, 160)}" alt="" /></button>
          <div class="drift-info"><b>${n + 1}. ${esc(a.name)}</b>
            <span class="muted">${esc(typeLabel(a.assetType, state.config.assetTypes[a.assetType]))} · ${t("drift.row", { coverage: pct(i.coverage), de: i.meanDeltaE, drift: i.drift })}</span>
            ${i.reasons.length ? `<span class="drift-reasons">${i.reasons.map(esc).join("；")}</span>` : ""}</div>
        </li>`;
      })
      .join("")}</ol>
    <div class="export-go"><span class="muted" id="driftPicked"></span><span class="drift-actions"><a class="btn ghost" id="driftCsv" download href="${csvUrl()}">${t("drift.csv")}</a><button class="btn primary" id="driftRedraw">${t("drift.redraw")}</button></span></div>`;
  updatePicked();
}

function picked() {
  return [...$("#consistencyBody").querySelectorAll("input[data-drift]:checked")].map((el) => report.items.find((i) => i.id === el.dataset.drift));
}

function updatePicked() {
  const n = picked().length;
  $("#driftPicked").textContent = n ? t("batch.count", { n }) : t("drift.nonePicked");
  $("#driftRedraw").disabled = !n || n > MAX_REDRAW;
  if (n > MAX_REDRAW) $("#driftPicked").textContent = t("drift.tooMany", { n, max: MAX_REDRAW });
}

/** Fill the tag picker; hidden when the project has no tags. */
function renderScope() {
  const tags = [...new Set(state.project.assets.flatMap((a) => a.tags ?? []))].sort();
  const sel = $("#consistencyTag");
  const keep = tags.includes(sel.value) ? sel.value : "";
  sel.innerHTML = `<option value="">${t("export.all")}</option>${tags.map((tag) => `<option value="${esc(tag)}">#${esc(tag)}${t("drift.group")}</option>`).join("")}`;
  sel.value = keep;
  sel.closest("label").hidden = !tags.length;
}

async function load() {
  const tag = $("#consistencyTag").value;
  $("#consistencyBody").innerHTML = `<p class="muted">${t("drift.measuring")}</p>`;
  try {
    report = await api(`/api/projects/${state.project.id}/consistency${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`);
    render();
  } catch (err) {
    $("#consistencyBody").innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

function open() {
  renderScope();
  $("#consistencyDialog").showModal();
  load();
}

export function bindConsistency({ onOpen }) {
  $("#consistencyBtn").addEventListener("click", open);
  $("#consistencyTag").addEventListener("change", load);
  const body = $("#consistencyBody");
  body.addEventListener("change", (e) => e.target.dataset.drift && updatePicked());
  body.addEventListener("click", (e) => {
    const thumb = e.target.closest("[data-open-asset]");
    if (thumb) {
      $("#consistencyDialog").close();
      return onOpen(thumb.dataset.openAsset);
    }
    if (e.target.id !== "driftRedraw") return;
    if (state.job) return toast(t("viewer.busy"));
    const items = picked();
    $("#consistencyDialog").close();
    // Assets without a measured reason still get a nudge back to the style.
    run("", items.map((i) => ({ assetId: i.id, feedback: i.reasons.length ? feedbackOf(i) : t("drift.generic") })));
  });
}
