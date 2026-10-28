// Reference check: put the asset next to any of the project's reference images.
import { esc } from "../lib.js";
import { state, thumbUrl } from "../state.js";
import { openRefCompare } from "./compare.js";
import { t } from "../i18n.js";

export function html(a) {
  const refs = state.project.refs ?? [];
  if (!refs.length) return "";
  return `<div class="ref-compare">
    <div class="sizes-head"><b>${t("refCompare.title")}</b><span class="muted">${t("refCompare.pick")}</span></div>
    <div class="similar-list">${refs
      .map((r, i) => {
        const label = t("refCompare.ref", { n: i + 1 }) + (r.note ? ` · ${r.note}` : "");
        return `<button type="button" class="similar-item checker" data-ref-compare="${r.id}" data-asset-id="${a.id}" title="${esc(label)}" aria-label="${esc(label)}">
          <img src="${thumbUrl(r.file, 160)}" alt="" /><span>${i + 1}</span></button>`;
      })
      .join("")}</div>
  </div>`;
}

export function bind(root) {
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ref-compare]");
    if (b) openRefCompare(b.dataset.refCompare, b.dataset.assetId);
  });
}
