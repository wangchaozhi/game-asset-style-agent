// Palette check against the style guide.
import { $, api, esc } from "../lib.js";
import { state } from "../state.js";
import { onSubmit, pct } from "./common.js";
import { t } from "../i18n.js";

export const html = (a) =>
  state.project.styleGuide
    ? `<div class="palette-check"><div class="sizes-head"><b>${t("palette.title")}</b><span class="pal-result muted">${t("common.checking")}</span></div>
        <form class="snap-form" data-snap="${a.id}" hidden>
          <select name="dither" aria-label="${t("palette.dither")}"><option value="none">${t("palette.hard")}</option><option value="ordered">${t("palette.ordered")}</option></select>
          <button class="btn ghost" type="submit" title="${t("palette.snapTitle")}">${t("palette.snap")}</button>
        </form>
      </div>`
    : "";

export function bind(root, ctx) {
  onSubmit(root, "form[data-snap]", async (form, fd) => {
    const { asset, before, after } = await api(`/api/projects/${state.project.id}/assets/${form.dataset.snap}/snap-palette`, {
      method: "POST",
      body: { dither: fd.get("dither") },
    });
    ctx.show(asset, t("palette.snapped", { before: pct(before.coverage), after: pct(after.coverage) }));
  });
}

/** Share of pixels on-palette, per-colour usage bar, and the main off-palette colours. */
export async function load(a) {
  if (!state.project.styleGuide) return;
  const box = $("#viewerMeta .palette-check");
  const label = box?.querySelector(".pal-result");
  try {
    const r = await api(`/api/projects/${state.project.id}/assets/${a.id}/palette`);
    if (!box?.isConnected) return;
    const level = r.coverage >= 0.8 ? "ok" : r.coverage >= 0.55 ? "warn" : "bad";
    label.className = `pal-result ${level}`;
    label.textContent = t("palette.result", { coverage: pct(r.coverage), de: r.meanDeltaE });
    const offShare = Math.max(0, 1 - r.coverage);
    const segs = r.usage
      .filter((u) => u.share > 0)
      .map((u) => `<i style="flex:${u.share};background:${esc(u.hex)}" title="${esc(u.hex)} · ${pct(u.share)}"></i>`)
      .join("");
    box.insertAdjacentHTML(
      "beforeend",
      `<div class="pal-bar" title="${t("palette.barTitle")}">${segs}</div>
      ${
        r.offPalette.length
          ? `<div class="pal-off"><span class="muted">${t("palette.off")}</span>${r.offPalette
              .map((o) => `<span class="pal-chip"><i style="background:${esc(o.hex)}"></i>${esc(o.hex)} ${pct(o.share)}</span>`)
              .join("")}</div>`
          : `<div class="muted pal-off">${t("palette.noOff")}${offShare > 0.02 ? t("palette.scattered") : ""}</div>`
      }`,
    );
    // Offer snapping only when something is actually off-palette.
    const form = box.querySelector(".snap-form");
    if (r.coverage < 0.99) {
      box.append(form);
      form.hidden = false;
    }
  } catch (err) {
    if (label) label.textContent = err.message;
  }
}
