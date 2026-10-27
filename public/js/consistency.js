// Consistency overview: assets ranked by drift from the project's style, with batch redraw.
import { $, api, esc, toast } from "./lib.js";
import { state, thumbUrl } from "./state.js";
import { run } from "./run.js";

/** At most this many assets per redraw run, as in the library's batch redraw. */
const MAX_REDRAW = 10;

let report = null;

const feedbackOf = (item) => `${item.reasons.join("；")}。请回到风格指南的色板与参考图的画风。`;

function render() {
  const body = $("#consistencyBody");
  const pct = (x) => `${Math.round(x * 100)}%`;
  const byId = new Map(state.project.assets.map((a) => [a.id, a]));
  const rows = report.items.filter((i) => byId.has(i.id));
  const drifting = rows.filter((i) => i.reasons.length);
  body.innerHTML = `<p class="muted">项目中位数：色板内 ${pct(report.medianCoverage)} · 平均色差 ΔE ${Math.round(report.medianDeltaE * 10) / 10}。
      ${drifting.length ? `${drifting.length} 个素材明显偏离，已默认勾选（最多 ${MAX_REDRAW} 个）。` : "没有明显偏离的素材。"}</p>
    <ol class="drift-list">${rows
      .map((i, n) => {
        const a = byId.get(i.id);
        const checked = i.reasons.length && drifting.indexOf(i) < MAX_REDRAW;
        return `<li class="drift-row ${i.reasons.length ? "off" : ""}">
          <input type="checkbox" data-drift="${i.id}" ${checked ? "checked" : ""} aria-label="选中 ${esc(a.name)}" />
          <button class="drift-thumb checker" data-open-asset="${i.id}" title="打开查看器"><img loading="lazy" src="${thumbUrl(a.gif ?? a.file, 160)}" alt="" /></button>
          <div class="drift-info"><b>${n + 1}. ${esc(a.name)}</b>
            <span class="muted">${esc(state.config.assetTypes[a.assetType] ?? a.assetType)} · 色板内 ${pct(i.coverage)} · ΔE ${i.meanDeltaE} · 偏离度 ${i.drift}</span>
            ${i.reasons.length ? `<span class="drift-reasons">${i.reasons.map(esc).join("；")}</span>` : ""}</div>
        </li>`;
      })
      .join("")}</ol>
    <div class="export-go"><span class="muted" id="driftPicked"></span><button class="btn primary" id="driftRedraw">按偏离原因重画所选</button></div>`;
  updatePicked();
}

function picked() {
  return [...$("#consistencyBody").querySelectorAll("input[data-drift]:checked")].map((el) => report.items.find((i) => i.id === el.dataset.drift));
}

function updatePicked() {
  const n = picked().length;
  $("#driftPicked").textContent = n ? `已选 ${n} 个` : "未选择素材";
  $("#driftRedraw").disabled = !n || n > MAX_REDRAW;
  if (n > MAX_REDRAW) $("#driftPicked").textContent = `已选 ${n} 个，一次最多 ${MAX_REDRAW} 个`;
}

async function open() {
  $("#consistencyBody").innerHTML = `<p class="muted">正在按风格色板测量每个素材…</p>`;
  $("#consistencyDialog").showModal();
  try {
    report = await api(`/api/projects/${state.project.id}/consistency`);
    render();
  } catch (err) {
    $("#consistencyBody").innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

export function bindConsistency({ onOpen }) {
  $("#consistencyBtn").addEventListener("click", open);
  const body = $("#consistencyBody");
  body.addEventListener("change", (e) => e.target.dataset.drift && updatePicked());
  body.addEventListener("click", (e) => {
    const thumb = e.target.closest("[data-open-asset]");
    if (thumb) {
      $("#consistencyDialog").close();
      return onOpen(thumb.dataset.openAsset);
    }
    if (e.target.id !== "driftRedraw") return;
    if (state.job) return toast("已有任务在运行，请稍候");
    const items = picked();
    $("#consistencyDialog").close();
    // Assets without a measured reason still get a nudge back to the style.
    run("", items.map((i) => ({ assetId: i.id, feedback: i.reasons.length ? feedbackOf(i) : "与项目其他素材的画风不太一致，请对照参考图调整。" })));
  });
}
