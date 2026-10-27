// UI 9-slice: set the margins on the image, preview stretched sizes, save for export.
import { $, api, toast } from "../lib.js";
import { fileUrl, state } from "../state.js";
import { onSubmit } from "./common.js";

const SIDES = [["left", "左"], ["top", "上"], ["right", "右"], ["bottom", "下"]];
/** Preview boxes as multiples of the (scaled) image size. */
const PREVIEWS = [["加宽", 2.2, 1], ["加高", 1, 1.8], ["放大", 1.8, 1.5]];
/** Longest side of the scaled image in the previews, px. */
const PREVIEW_BASE = 100;

/** Natural size of the image in the viewer, set by load(). */
let size = null;

export function html(a) {
  if (a.assetType !== "ui") return "";
  const url = fileUrl(a.file);
  return `<div class="nine">
    <div class="sizes-head"><b>九宫格（9-slice）</b><span class="nine-status muted">${a.nineSlice ? "已设置，导出时附带边距" : "未设置"}</span></div>
    <div class="nine-src checker"><img src="${url}" alt="九宫格边距示意" />
      ${SIDES.map(([s]) => `<i class="nine-line ${s}" aria-hidden="true"></i>`).join("")}</div>
    <form class="nine-form" data-nine="${a.id}">
      ${SIDES.map(([s, label]) => `<label>${label} <input name="${s}" type="number" min="0" step="1" required /></label>`).join("")}
      <button class="btn ghost" type="submit">保存边距</button>
      ${a.nineSlice ? `<button class="btn link" type="button" data-nine-clear="${a.id}">清除</button>` : ""}
    </form>
    <p class="nine-error" role="alert" hidden></p>
    <div class="nine-previews">${PREVIEWS.map(([label]) => `<figure><div class="nine-box checker"></div><figcaption class="muted">${label}</figcaption></figure>`).join("")}</div>
  </div>`;
}

export function load(a) {
  if (a.assetType !== "ui") return;
  size = null;
  const img = new Image();
  img.onload = () => {
    const form = $("#viewerMeta .nine-form");
    if (!form?.isConnected || form.dataset.nine !== a.id) return;
    size = { w: img.naturalWidth, h: img.naturalHeight };
    // Unset: start from a quarter of each side, a common panel border.
    const m = a.nineSlice ?? { left: Math.round(size.w / 4), top: Math.round(size.h / 4), right: Math.round(size.w / 4), bottom: Math.round(size.h / 4) };
    for (const [s] of SIDES) {
      form.elements[s].value = m[s];
      form.elements[s].max = (s === "left" || s === "right" ? size.w : size.h) - 1;
    }
    update(form, fileUrl(a.file));
  };
  img.src = fileUrl(a.file);
}

/** Margins from the form, or an error message. */
function read(form) {
  const m = Object.fromEntries(SIDES.map(([s]) => [s, Number(form.elements[s].value)]));
  if (SIDES.some(([s]) => !Number.isInteger(m[s]) || m[s] < 0)) return "边距需为非负整数";
  if (m.left + m.right >= size.w) return `左右边距之和需小于宽度 ${size.w}px`;
  if (m.top + m.bottom >= size.h) return `上下边距之和需小于高度 ${size.h}px`;
  return m;
}

/** Move the guide lines and redraw the stretched previews. */
function update(form, url) {
  const root = form.closest(".nine");
  const m = read(form);
  const error = root.querySelector(".nine-error");
  error.hidden = typeof m !== "string";
  error.textContent = typeof m === "string" ? m : "";
  if (typeof m === "string") return;
  const line = (s) => root.querySelector(`.nine-line.${s}`);
  line("left").style.left = `${(m.left / size.w) * 100}%`;
  line("right").style.right = `${(m.right / size.w) * 100}%`;
  line("top").style.top = `${(m.top / size.h) * 100}%`;
  line("bottom").style.bottom = `${(m.bottom / size.h) * 100}%`;
  const k = Math.min(1, PREVIEW_BASE / size.w, PREVIEW_BASE / size.h);
  for (const [i, box] of root.querySelectorAll(".nine-box").entries()) {
    const [, fx, fy] = PREVIEWS[i];
    Object.assign(box.style, {
      width: `${Math.max(size.w * k * fx, (m.left + m.right) * k + 2)}px`,
      height: `${Math.max(size.h * k * fy, (m.top + m.bottom) * k + 2)}px`,
      borderWidth: `${m.top * k}px ${m.right * k}px ${m.bottom * k}px ${m.left * k}px`,
      borderImageSource: `url("${url}")`,
      borderImageSlice: `${m.top} ${m.right} ${m.bottom} ${m.left} fill`,
      imageRendering: state.pixelKernel ? "pixelated" : "auto",
    });
  }
}

export function bind(root, ctx) {
  root.addEventListener("input", (e) => {
    const form = e.target.closest(".nine-form");
    if (!form || !size) return;
    const a = state.project.assets.find((x) => x.id === form.dataset.nine);
    if (a) update(form, fileUrl(a.file));
  });
  onSubmit(root, "form[data-nine]", async (form) => {
    if (!size) return;
    const m = read(form);
    if (typeof m === "string") throw new Error(m);
    const asset = await api(`/api/projects/${state.project.id}/assets/${form.dataset.nine}`, { method: "PATCH", body: { nineSlice: m } });
    ctx.show(asset, "九宫格边距已保存");
  });
  root.addEventListener("click", async (e) => {
    const id = e.target.dataset?.nineClear;
    if (!id) return;
    try {
      const asset = await api(`/api/projects/${state.project.id}/assets/${id}`, { method: "PATCH", body: { nineSlice: null } });
      ctx.show(asset, "已清除九宫格边距");
    } catch (err) {
      toast(err.message);
    }
  });
}
