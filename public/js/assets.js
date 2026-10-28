// Asset library grid, filters and multi-select.
import { $, api, esc, toast } from "./lib.js";
import { state, thumbUrl } from "./state.js";
import { t, typeLabel } from "./i18n.js";

const matchesQuery = (a, q) =>
  !q || [a.name, a.notes, a.prompt, a.id, ...(a.tags ?? [])].some((v) => String(v ?? "").toLowerCase().includes(q));

const hasTag = (a, tag) => !tag || (a.tags ?? []).some((x) => x.toLowerCase() === tag.toLowerCase());

/** Assets currently visible under the status / type filters and search, newest first. */
export const inTrash = () => state.filter === "trash";

export const visibleAssets = () => {
  const q = state.query.trim().toLowerCase();
  if (inTrash()) {
    return (state.project.trash ?? [])
      .filter((a) => (!state.typeFilter || a.assetType === state.typeFilter) && hasTag(a, state.tagFilter) && matchesQuery(a, q))
      .slice()
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }
  const shares = state.colorFilter?.shares;
  const list = state.project.assets.filter(
    (a) =>
      (state.filter === "all" || a.status === state.filter) &&
      (!state.typeFilter || a.assetType === state.typeFilter) &&
      hasTag(a, state.tagFilter) &&
      (!shares || shares.has(a.id)) &&
      matchesQuery(a, q),
  );
  // A colour search lists the assets that use the colour most first; otherwise newest first.
  return shares ? list.sort((a, b) => shares.get(b.id) - shares.get(a.id)) : list.slice().reverse();
};

/** Type dropdown lists only types present in the project, with counts. */
function renderTypeFilter() {
  const sel = $("#typeFilter");
  const counts = {};
  for (const a of state.project.assets) counts[a.assetType] = (counts[a.assetType] ?? 0) + 1;
  if (state.typeFilter && !counts[state.typeFilter]) state.typeFilter = "";
  sel.innerHTML =
    `<option value="">${esc(t("filter.allTypes", { n: state.project.assets.length }))}</option>` +
    Object.entries(counts)
      .map(([type, n]) => `<option value="${esc(type)}">${esc(t("common.count", { label: typeLabel(type, state.config.assetTypes[type]), n }))}</option>`)
      .join("");
  sel.value = state.typeFilter;
  renderTagFilter();
}

/** Tag dropdown appears once any asset has a tag. */
function renderTagFilter() {
  const sel = $("#tagFilter");
  const counts = new Map();
  for (const a of state.project.assets) for (const tag of a.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  if (state.tagFilter && !counts.has(state.tagFilter)) state.tagFilter = "";
  sel.hidden = !counts.size;
  sel.innerHTML =
    `<option value="">${esc(t("filter.allTags"))}</option>` +
    [...counts].sort((x, y) => x[0].localeCompare(y[0])).map(([tag, n]) => `<option value="${esc(tag)}">${esc(t("common.count", { label: `#${tag}`, n }))}</option>`).join("");
  sel.value = state.tagFilter;
}

/** Cards rendered per page of the library. */
const PAGE = 60;

/**
 * Where a key press moves focus in a grid of `total` cards laid out `cols` wide; null for other keys.
 * Left / right wrap across rows; up / down move a whole row and stop at the edges.
 */
export function gridMove(index, key, cols, total) {
  const to = {
    ArrowLeft: index - 1,
    ArrowRight: index + 1,
    ArrowUp: index - cols,
    ArrowDown: index + cols,
    Home: 0,
    End: total - 1,
  }[key];
  if (to === undefined) return null;
  return to < 0 || to >= total ? index : to;
}

/** Cards per row, from where they actually landed. */
const columns = (cards) => {
  const top = cards[0]?.offsetTop;
  const n = cards.findIndex((c) => c.offsetTop !== top);
  return n === -1 ? cards.length : n;
};
let limit = PAGE;
let pageKey = "";
/** Loads the next page when the "more" button scrolls into view; created on first use. */
let moreObserver = null;
const observeMore = (el) => {
  moreObserver ??= new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) showMore();
  });
  moreObserver.observe(el);
};

function showMore() {
  moreObserver?.disconnect();
  limit += PAGE;
  renderAssets();
}

export function renderAssets(newId) {
  const all = state.project.assets;
  // Drop selections that are not on screen any more (deleted, restored, project switched).
  const pool = inTrash() ? (state.project.trash ?? []) : all;
  for (const id of state.selected) if (!pool.some((a) => a.id === id)) state.selected.delete(id);
  const trashCount = state.project.trash?.length ?? 0;
  $("#trashFilter").textContent = trashCount ? t("filter.trashN", { n: trashCount }) : t("filter.trash");
  renderTypeFilter();
  const shown = visibleAssets();
  $("#assetCount").textContent = all.length ? `${all.filter((a) => a.status === "approved").length}/${all.length}` : "";
  const filtered = shown.length !== all.length;
  $("#assetSearch").closest(".asset-search").dataset.shown = filtered ? t("lib.shown", { shown: shown.length, total: all.length }) : "";
  const typeName = (type) => typeLabel(type, state.config.assetTypes[type]);
  const grid = $("#assets");
  grid.classList.toggle("selecting", state.selecting || inTrash());
  const days = state.config.trashDays ?? 7;
  const left = (a) => Math.max(0, Math.ceil(days - (Date.now() - Date.parse(a.deletedAt)) / 86_400_000));
  // Assets with a newer version (a redraw or post-processed copy) are marked as superseded.
  const superseded = new Set(state.project.assets.map((a) => a.parentId).filter(Boolean));
  /** Corner chips on the thumbnail: what kind of asset this is beyond its type. */
  const marks = (a) =>
    [
      a.frames?.length && `<span class="mark" title="${esc(t("mark.framesTitle", { n: a.frames.length }))}">${esc(t("mark.frames", { n: a.frames.length }))}</span>`,
      a.nineSlice && `<span class="mark" title="${esc(t("mark.nineSliceTitle"))}">${esc(t("mark.nineSlice"))}</span>`,
      state.colorFilter?.shares.has(a.id) && `<span class="mark" title="${esc(t("mark.colorTitle", { hex: state.colorFilter.hex }))}">${Math.round(state.colorFilter.shares.get(a.id) * 100)}%</span>`,
      a.variantOf && `<span class="mark" title="${esc(t("mark.variantTitle"))}">${esc(t("mark.variant"))}</span>`,
      !a.deletedAt && superseded.has(a.id) && `<span class="mark old" title="${esc(t("mark.oldTitle"))}">${esc(t("mark.old"))}</span>`,
    ].filter(Boolean).join("");
  // Big libraries render in pages; the count survives re-renders until the filters change.
  const key = [state.project.id, state.filter, state.typeFilter, state.tagFilter, state.query, state.colorFilter?.hex ?? ""].join("|");
  if (key !== pageKey) [pageKey, limit] = [key, PAGE];
  // One card is in the tab order (roving focus); arrow keys move between them.
  const focusId = shown.slice(0, limit).some((a) => a.id === state.focusAsset) ? state.focusAsset : shown[0]?.id;
  const hadFocus = document.activeElement?.closest?.("#assets .card")?.dataset.asset;
  const selectable = state.selecting || inTrash();
  const card = (a) => `<div class="card ${a.status} ${a.id === newId ? "new" : ""} ${state.selected.has(a.id) ? "selected" : ""}" data-asset="${a.id}"
            role="button" tabindex="${a.id === focusId ? 0 : -1}" aria-label="${esc(a.name)}"${selectable ? ` aria-pressed="${state.selected.has(a.id)}"` : ""}>
            <span class="tick" aria-hidden="true"></span>
            <div class="checker"><img loading="lazy" decoding="async" src="${thumbUrl(a.gif ?? a.file)}" alt="${esc(a.name)}" /><span class="marks">${marks(a)}</span></div>
            <div class="meta"><span class="name">${esc(a.name)}</span>
              ${a.tags?.length ? `<span class="tags">${a.tags.map((tag) => `<span class="tag">#${esc(tag)}</span>`).join("")}</span>` : ""}
              <span class="sub"><span>${esc(typeName(a.assetType))}</span>${
                a.deletedAt
                  ? `<span class="badge trashed" title="${esc(t("lib.deletedAt", { when: new Date(a.deletedAt).toLocaleString() }))}">${esc(t("lib.purgeIn", { n: left(a) }))}</span>`
                  : `<span class="badge ${a.status}">${esc(t(`badge.${a.status}`))}${a.score ? ` ${a.score}/10` : ""}</span>`
              }</span>
            </div></div>`;
  const more = shown.length - limit;
  grid.innerHTML = shown.length
    ? shown.slice(0, limit).map(card).join("") +
      (more > 0 ? `<button type="button" class="btn ghost more" id="assetsMore">${esc(t("lib.more", { n: more }))}</button>` : "")
    : `<p class="empty">${esc(t(inTrash() ? "lib.emptyTrash" : all.length ? "lib.noMatch" : "lib.empty"))}</p>`;
  if (hadFocus) grid.querySelector(`.card[data-asset="${CSS.escape(hadFocus)}"]`)?.focus();
  const sentinel = $("#assetsMore");
  if (sentinel) observeMore(sentinel);
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
  $("#selectToggle").textContent = t(on ? "filter.done" : "filter.select");
  $("#selectToggle").classList.toggle("on", on);
  renderAssets();
}

function renderBatchBar() {
  const bar = $("#batchBar");
  const trash = inTrash();
  $("#selectToggle").textContent = t(state.selecting ? "filter.done" : "filter.select");
  bar.hidden = !state.selecting && !trash;
  if (bar.hidden) return;
  bar.classList.toggle("in-trash", trash);
  const n = state.selected.size;
  bar.querySelector(".batch-count").textContent = n
    ? t("batch.count", { n })
    : trash
      ? t("batch.trashHint", { n: state.config.trashDays ?? 7 })
      : t("batch.hint");
  bar.querySelectorAll("[data-batch]").forEach((b) => {
    if (b.dataset.batch === "empty") b.disabled = !(state.project.trash?.length);
    else if (b.dataset.batch !== "all" && b.dataset.batch !== "none") b.disabled = !n;
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
    if ((f === "trash") !== inTrash()) state.selected.clear();
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
  $("#colorFilter").addEventListener("change", async (e) => {
    try {
      const r = await api(`/api/projects/${state.project.id}/assets-by-color?hex=${encodeURIComponent(e.target.value)}`);
      state.colorFilter = { hex: r.hex, shares: new Map(r.items.map((i) => [i.id, i.share])) };
      $("#colorFilterClear").hidden = false;
      renderAssets();
      toast(r.items.length ? t("filter.colorFound", { n: r.items.length, hex: r.hex }) : t("filter.colorNone", { hex: r.hex }));
    } catch (err) {
      toast(err.message);
    }
  });
  $("#colorFilterClear").addEventListener("click", () => {
    state.colorFilter = null;
    $("#colorFilterClear").hidden = true;
    renderAssets();
  });
  $("#tagFilter").addEventListener("change", (e) => {
    state.tagFilter = e.target.value;
    renderAssets();
  });
  $("#assets").addEventListener("click", (e) => {
    if (e.target.id === "assetsMore") return showMore();
    const card = e.target.closest(".card");
    if (!card) return;
    state.focusAsset = card.dataset.asset;
    if (state.selecting || inTrash()) toggleSelection(card.dataset.asset, e.shiftKey);
    else onOpen(card.dataset.asset);
  });
  $("#assets").addEventListener("keydown", (e) => {
    const card = e.target.closest?.(".card");
    if (!card || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      card.click();
      return;
    }
    const cards = [...$("#assets").querySelectorAll(".card")];
    const to = gridMove(cards.indexOf(card), e.key, columns(cards), cards.length);
    if (to === null) return;
    e.preventDefault();
    cards[to].focus();
  });
  // Keep the roving tab stop on whichever card has focus.
  $("#assets").addEventListener("focusin", (e) => {
    const card = e.target.closest?.(".card");
    if (!card) return;
    state.focusAsset = card.dataset.asset;
    for (const c of $("#assets").querySelectorAll('.card[tabindex="0"]')) if (c !== card) c.tabIndex = -1;
    card.tabIndex = 0;
  });
  $("#selectToggle").addEventListener("click", () => setSelecting(!state.selecting));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.selecting && !document.querySelector("dialog[open]")) setSelecting(false);
  });
}
