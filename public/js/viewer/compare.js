// Version compare: before/after slider and side-by-side views.
import { $, esc } from "../lib.js";
import { fileUrl, state } from "../state.js";
import { t } from "../i18n.js";

const verdictText = (a) =>
  `${t(`compare.${a.status}`)}${a.score ? ` · ${a.score}/10` : ""}`;

/** Swap the image pane for a before/after view of two versions. mode: "slider" | "side". */
export function openCompare(beforeId, afterId, mode = "slider") {
  const before = state.project.assets.find((x) => x.id === beforeId);
  const after = state.project.assets.find((x) => x.id === afterId);
  if (!before || !after) return;
  const pane = $("#viewerCompare");
  $("#viewerImgWrap").hidden = true;
  $("#zoomBar").hidden = true;
  pane.hidden = false;
  pane.dataset.pair = `${beforeId}:${afterId}`;
  const label = (a, tag) => `<span class="cmp-label"><b>${tag}</b> ${esc(verdictText(a))}</span>`;
  pane.innerHTML = `
    <div class="cmp-bar">
      <span class="cmp-modes">
        <button class="btn link ${mode === "slider" ? "on" : ""}" data-cmp-mode="slider">${t("compare.slider")}</button>
        <button class="btn link ${mode === "side" ? "on" : ""}" data-cmp-mode="side">${t("compare.side")}</button>
      </span>
      <button class="btn link" data-cmp-close>${t("compare.exit")}</button>
    </div>
    ${
      mode === "side"
        ? `<div class="cmp-side">
            <figure class="checker"><img src="${fileUrl(before.file)}" alt="${t("compare.before")}" />${label(before, t("compare.before"))}</figure>
            <figure class="checker"><img src="${fileUrl(after.file)}" alt="${t("compare.afterAlt")}" />${label(after, t("compare.after"))}</figure>
          </div>`
        : `<div class="cmp-slider checker" style="--pos:50%">
            <img src="${fileUrl(before.file)}" alt="${t("compare.before")}" />
            <img class="cmp-after" src="${fileUrl(after.file)}" alt="${t("compare.afterAlt")}" />
            <span class="cmp-handle" aria-hidden="true"></span>
            ${label(before, t("compare.before")).replace("cmp-label", "cmp-label left")}
            ${label(after, t("compare.after")).replace("cmp-label", "cmp-label right")}
            <input class="cmp-range" type="range" min="0" max="100" value="50" aria-label="${t("compare.position")}" />
          </div>`
    }
    ${before.notes || after.notes ? `<div class="cmp-notes">${before.notes ? `<p><b>${t("compare.before")}: </b>${esc(before.notes)}</p>` : ""}${after.notes ? `<p><b>${t("compare.after")}: </b>${esc(after.notes)}</p>` : ""}</div>` : ""}`;
}

/** Swap the image pane for the asset next to one of the project's reference images. */
export function openRefCompare(refId, assetId) {
  const i = state.project.refs.findIndex((r) => r.id === refId);
  const ref = state.project.refs[i];
  const a = state.project.assets.find((x) => x.id === assetId);
  if (!ref || !a) return;
  const pane = $("#viewerCompare");
  $("#viewerImgWrap").hidden = true;
  $("#zoomBar").hidden = true;
  pane.hidden = false;
  delete pane.dataset.pair;
  pane.innerHTML = `
    <div class="cmp-bar"><span class="muted">${esc(t("refCompare.hint"))}</span><button class="btn link" data-cmp-close>${t("compare.exit")}</button></div>
    <div class="cmp-side">
      <figure class="checker"><img src="${fileUrl(ref.file)}" alt="${esc(t("refCompare.ref", { n: i + 1 }))}" /><span class="cmp-label"><b>${esc(t("refCompare.ref", { n: i + 1 }))}</b></span></figure>
      <figure class="checker"><img src="${fileUrl(a.file)}" alt="${esc(a.name)}" /><span class="cmp-label"><b>${esc(a.name)}</b> ${esc(verdictText(a))}</span></figure>
    </div>
    ${ref.note ? `<div class="cmp-notes"><p><b>${esc(t("refCompare.note"))}: </b>${esc(ref.note)}</p></div>` : ""}`;
}

export function closeCompare() {
  const pane = $("#viewerCompare");
  if (!pane) return;
  pane.hidden = true;
  pane.innerHTML = "";
  $("#viewerImgWrap").hidden = false;
  $("#zoomBar").hidden = false;
}

export function bindCompare() {
  const pane = $("#viewerCompare");
  pane.addEventListener("input", (e) => {
    if (e.target.classList.contains("cmp-range")) e.target.parentElement.style.setProperty("--pos", `${e.target.value}%`);
  });
  pane.addEventListener("click", (e) => {
    const [beforeId, afterId] = (pane.dataset.pair ?? "").split(":");
    if (e.target.closest("[data-cmp-close]")) closeCompare();
    const mode = e.target.closest("[data-cmp-mode]")?.dataset.cmpMode;
    if (mode) openCompare(beforeId, afterId, mode);
  });
}
