// UI 9-slice: set the margins on the image, preview stretched sizes, save for export.
import { $, api, toast } from "../lib.js";
import { fileUrl, state } from "../state.js";
import { onSubmit } from "./common.js";
import { t } from "../i18n.js";

const SIDES = ["left", "top", "right", "bottom"];
/** Preview boxes as multiples of the (scaled) image size. */
const PREVIEWS = [["wider", 2.2, 1], ["taller", 1, 1.8], ["bigger", 1.8, 1.5]];
/** Longest side of the scaled image in the previews, px. */
const PREVIEW_BASE = 100;

/** Natural size of the image in the viewer, set by load(). */
let size = null;

export function html(a) {
  if (a.assetType !== "ui") return "";
  const url = fileUrl(a.file);
  return `<div class="nine">
    <div class="sizes-head"><b>${t("nine.title")}</b><span class="nine-status muted">${t(a.nineSlice ? "nine.set" : "nine.unset")}</span></div>
    <div class="nine-src checker"><img src="${url}" alt="${t("nine.alt")}" />
      ${SIDES.map((s) => `<i class="nine-line ${s}" aria-hidden="true"></i>`).join("")}</div>
    <form class="nine-form" data-nine="${a.id}">
      ${SIDES.map((s) => `<label>${t(`nine.${s}`)} <input name="${s}" type="number" min="0" step="1" required /></label>`).join("")}
      <button class="btn ghost" type="submit">${t("nine.save")}</button>
      <button class="btn link" type="button" data-nine-detect="${a.id}">${t("nine.detect")}</button>
      ${a.nineSlice ? `<button class="btn link" type="button" data-nine-clear="${a.id}">${t("nine.clear")}</button>` : ""}
    </form>
    <p class="nine-error" role="alert" hidden></p>
    <div class="nine-previews">${PREVIEWS.map(([label]) => `<figure><div class="nine-box checker"></div><figcaption class="muted">${t(`nine.${label}`)}</figcaption></figure>`).join("")}</div>
  </div>`;
}

export function load(a) {
  if (a.assetType !== "ui") return;
  size = null;
  const img = new Image();
  img.onload = async () => {
    const form = $("#viewerMeta .nine-form");
    if (!form?.isConnected || form.dataset.nine !== a.id) return;
    size = { w: img.naturalWidth, h: img.naturalHeight };
    // Unset: start from the detected band, else a quarter of each side (a common panel border).
    const suggestion = a.nineSlice ? null : await detect(a.id).catch(() => null);
    if (!form.isConnected) return;
    if (suggestion) form.closest(".nine").querySelector(".nine-status").textContent = t("nine.suggested");
    const quarter = { left: Math.round(size.w / 4), top: Math.round(size.h / 4), right: Math.round(size.w / 4), bottom: Math.round(size.h / 4) };
    for (const s of SIDES) form.elements[s].max = (s === "left" || s === "right" ? size.w : size.h) - 1;
    fill(form, a, a.nineSlice ?? suggestion ?? quarter);
  };
  img.src = fileUrl(a.file);
}

const detect = async (id) => (await api(`/api/projects/${state.project.id}/assets/${id}/nine-slice`)).suggestion;

function fill(form, a, m) {
  for (const s of SIDES) form.elements[s].value = m[s];
  update(form, fileUrl(a.file));
}

/** Margins from the form, or an error message. */
function read(form) {
  const m = Object.fromEntries(SIDES.map((s) => [s, Number(form.elements[s].value)]));
  if (SIDES.some((s) => !Number.isInteger(m[s]) || m[s] < 0)) return t("nine.badInt");
  if (m.left + m.right >= size.w) return t("nine.tooWide", { n: size.w });
  if (m.top + m.bottom >= size.h) return t("nine.tooTall", { n: size.h });
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
    ctx.show(asset, t("nine.saved"));
  });
  root.addEventListener("click", async (e) => {
    const detectId = e.target.dataset?.nineDetect;
    if (detectId && size) {
      try {
        const m = await detect(detectId);
        if (!m) return toast(t("nine.notFound"));
        fill(e.target.closest(".nine-form"), state.project.assets.find((x) => x.id === detectId), m);
        toast(t("nine.filled"));
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    const id = e.target.dataset?.nineClear;
    if (!id) return;
    try {
      const asset = await api(`/api/projects/${state.project.id}/assets/${id}`, { method: "PATCH", body: { nineSlice: null } });
      ctx.show(asset, t("nine.cleared"));
    } catch (err) {
      toast(err.message);
    }
  });
}
