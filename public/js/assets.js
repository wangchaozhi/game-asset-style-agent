// Asset library grid, filters and multi-select.
import { $, esc } from "./lib.js";
import { fileUrl, state } from "./state.js";

const LABEL = { approved: "✓ 通过", rejected: "✗ 驳回", pending_review: "… 审核中" };

const matchesQuery = (a, q) =>
  !q || [a.name, a.notes, a.prompt, a.id].some((v) => String(v ?? "").toLowerCase().includes(q));

/** Assets currently visible under the status / type filters and search, newest first. */
export const visibleAssets = () => {
  const q = state.query.trim().toLowerCase();
  return state.project.assets
    .filter((a) => (state.filter === "all" || a.status === state.filter) && (!state.typeFilter || a.assetType === state.typeFilter) && matchesQuery(a, q))
    .slice()
    .reverse();
};

/** Type dropdown lists only types present in the project, with counts. */
function renderTypeFilter() {
  const sel = $("#typeFilter");
  const counts = {};
  for (const a of state.project.assets) counts[a.assetType] = (counts[a.assetType] ?? 0) + 1;
  if (state.typeFilter && !counts[state.typeFilter]) state.typeFilter = "";
  sel.innerHTML =
    `<option value="">全部类型（${state.project.assets.length}）</option>` +
    Object.entries(counts)
      .map(([t, n]) => `<option value="${esc(t)}">${esc(state.config.assetTypes[t] ?? t)}（${n}）</option>`)
      .join("");
  sel.value = state.typeFilter;
}

export function renderAssets(newId) {
  const all = state.project.assets;
  // Drop selections that no longer exist (deleted elsewhere, project switched).
  for (const id of state.selected) if (!all.some((a) => a.id === id)) state.selected.delete(id);
  renderTypeFilter();
  const shown = visibleAssets();
  $("#assetCount").textContent = all.length ? `${all.filter((a) => a.status === "approved").length}/${all.length}` : "";
  const filtered = shown.length !== all.length;
  $("#assetSearch").closest(".asset-search").dataset.shown = filtered ? `显示 ${shown.length} / ${all.length}` : "";
  const typeName = (t) => state.config.assetTypes[t] ?? t;
  const grid = $("#assets");
  grid.classList.toggle("selecting", state.selecting);
  grid.innerHTML = shown.length
    ? shown
        .map(
          (a) => `<div class="card ${a.status} ${a.id === newId ? "new" : ""} ${state.selected.has(a.id) ? "selected" : ""}" data-asset="${a.id}">
            <span class="tick" aria-hidden="true"></span>
            <div class="checker"><img loading="lazy" src="${fileUrl(a.gif ?? a.file)}" alt="${esc(a.name)}" /></div>
            <div class="meta"><span class="name">${esc(a.name)}</span>
              <span class="sub"><span>${esc(typeName(a.assetType))}</span><span class="badge ${a.status}">${LABEL[a.status]}${a.score ? ` ${a.score}/10` : ""}</span></span>
            </div></div>`,
        )
        .join("")
    : `<p class="empty">${all.length ? "没有符合筛选的素材" : "生成的素材会出现在这里"}</p>`;
  renderBatchBar();
}

export function upsertAsset(asset) {
  const list = state.project.assets;
  const i = list.findIndex((a) => a.id === asset.id);
  if (i >= 0) list[i] = asset;
  else list.push(asset);
  renderAssets(i >= 0 ? undefined : asset.id);
}

export function setSelecting(on) {
  state.selecting = on;
  state.selected.clear();
  state.lastSelected = null;
  $("#selectToggle").textContent = on ? "完成" : "选择";
  $("#selectToggle").classList.toggle("on", on);
  renderAssets();
}

function renderBatchBar() {
  const bar = $("#batchBar");
  bar.hidden = !state.selecting;
  if (!state.selecting) return;
  const n = state.selected.size;
  bar.querySelector(".batch-count").textContent = n ? `已选 ${n} 个` : "点击素材进行选择（Shift 连选）";
  bar.querySelectorAll("[data-batch]").forEach((b) => {
    if (b.dataset.batch !== "all" && b.dataset.batch !== "none") b.disabled = !n;
  });
}

/** Toggle one card; with shift, extend from the last clicked card across the visible order. */
function toggleSelection(id, range) {
  const order = visibleAssets().map((a) => a.id);
  if (range && state.lastSelected && order.includes(state.lastSelected)) {
    const [a, b] = [order.indexOf(state.lastSelected), order.indexOf(id)].sort((x, y) => x - y);
    for (const x of order.slice(a, b + 1)) state.selected.add(x);
  } else if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  state.lastSelected = id;
  renderAssets();
}

export function bindAssets({ onOpen }) {
  $("#filters").addEventListener("click", (e) => {
    const f = e.target.dataset?.filter;
    if (!f) return;
    state.filter = f;
    document.querySelectorAll("#filters button").forEach((b) => b.classList.toggle("on", b.dataset.filter === f));
    renderAssets();
  });
  $("#assetSearch").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderAssets();
  });
  $("#typeFilter").addEventListener("change", (e) => {
    state.typeFilter = e.target.value;
    renderAssets();
  });
  $("#assets").addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    if (state.selecting) toggleSelection(card.dataset.asset, e.shiftKey);
    else onOpen(card.dataset.asset);
  });
  $("#selectToggle").addEventListener("click", () => setSelecting(!state.selecting));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.selecting && !document.querySelector("dialog[open]")) setSelecting(false);
  });
}
