// Image zoom in the viewer: fit or a whole-number scale with crisp pixels, plus an optional pixel grid.
import { $ } from "../lib.js";
import { t } from "../i18n.js";

/** 0 = fit the pane; otherwise screen pixels per image pixel. */
export const LEVELS = [0, 1, 2, 4, 8, 16];
/** The grid only helps once a pixel is big enough to see its edges. */
export const GRID_FROM = 4;

/** The level one step in or out from `level` (dir +1 / -1), clamped to LEVELS. */
export function nextZoom(level, dir) {
  const i = Math.max(0, LEVELS.indexOf(level));
  return LEVELS[Math.min(LEVELS.length - 1, Math.max(0, i + dir))];
}

let level = 0;
let grid = false;

/** Size the image for the current level and show or hide the grid; keeps the level across assets. */
export function apply() {
  const wrap = $("#viewerImgWrap");
  const img = $("#viewerImg");
  const gridEl = $("#pixelGrid");
  wrap.classList.toggle("zoomed", level > 0);
  img.style.width = level && img.naturalWidth ? `${img.naturalWidth * level}px` : "";
  img.classList.toggle("crisp", level >= 2);
  gridEl.hidden = !(grid && level >= GRID_FROM);
  gridEl.style.backgroundSize = `${level}px ${level}px`;
  for (const b of document.querySelectorAll("#zoomBar [data-zoom]")) b.classList.toggle("on", Number(b.dataset.zoom) === level);
  const g = $("#zoomBar [data-grid]");
  g.classList.toggle("on", grid);
  g.title = t(level < GRID_FROM ? "zoom.gridNeedsZoom" : "zoom.gridTitle", { n: GRID_FROM });
  // Keep the centre of the image in view; most assets are centred on their canvas.
  wrap.scrollLeft = (wrap.scrollWidth - wrap.clientWidth) / 2;
  wrap.scrollTop = (wrap.scrollHeight - wrap.clientHeight) / 2;
}

export const setZoom = (next) => {
  level = next;
  apply();
};
export const zoomBy = (dir) => setZoom(nextZoom(level, dir));
export const toggleGrid = () => {
  // Turning the grid on from a small zoom jumps to where it is visible.
  grid = !grid;
  if (grid && level < GRID_FROM) level = GRID_FROM;
  apply();
};

export function bindZoom() {
  $("#zoomBar").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.grid !== undefined) toggleGrid();
    else setZoom(Number(b.dataset.zoom));
  });
  // A new image keeps the level but needs its own size.
  $("#viewerImg").addEventListener("load", apply);
}
