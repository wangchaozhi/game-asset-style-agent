// Colour-swap variants: pick new colours for the asset's main colours, save as a new sibling asset.
import { $, api, esc } from "../lib.js";
import { state } from "../state.js";
import { onSubmit, pct } from "./common.js";
import { t } from "../i18n.js";

export function html(a) {
  if (a.assetType === "background") return "";
  return `<div class="recolor">
    <div class="sizes-head"><b>${t("mark.variantTitle")}</b><span class="muted recolor-hint">${t("recolor.loading")}</span></div>
    <form class="recolor-form" data-recolor="${a.id}">
      <div class="recolor-rows"></div>
      <div class="recolor-opts">
        <label>${t("newProject.name")} <input name="name" value="${esc(t("recolor.defaultName", { name: a.name }))}" maxlength="80" /></label>
        <label>${t("recolor.tolerance")} <select name="threshold"><option value="12">12</option><option value="20" selected>20</option><option value="30">30</option><option value="45">45</option></select></label>
        <button class="btn ghost" type="submit">${t("recolor.submit")}</button>
      </div>
    </form>
  </div>`;
}

export async function load(a) {
  if (a.assetType === "background") return;
  const form = $("#viewerMeta .recolor-form");
  const hint = $("#viewerMeta .recolor-hint");
  try {
    const { colors } = await api(`/api/projects/${state.project.id}/assets/${a.id}/colors`);
    if (!form?.isConnected) return;
    hint.textContent = t("recolor.hint");
    form.querySelector(".recolor-rows").innerHTML = colors
      .map(
        (c) => `<label class="recolor-row" title="${t("recolor.share", { share: pct(c.share) })}">
          <i class="swatch" style="background:${esc(c.hex)}"></i><span>${esc(c.hex)}</span> →
          <input type="color" data-from="${esc(c.hex)}" value="${esc(c.hex)}" aria-label="${t("recolor.replace", { hex: esc(c.hex) })}" /></label>`,
      )
      .join("");
  } catch (err) {
    if (hint) hint.textContent = err.message;
  }
}

export function bind(root, ctx) {
  onSubmit(root, "form[data-recolor]", async (form, fd) => {
    const swaps = [...form.querySelectorAll("input[data-from]")]
      .filter((i) => i.value.toLowerCase() !== i.dataset.from.toLowerCase())
      .map((i) => ({ from: i.dataset.from, to: i.value }));
    if (!swaps.length) throw new Error(t("recolor.none"));
    const asset = await api(`/api/projects/${state.project.id}/assets/${form.dataset.recolor}/recolor`, {
      method: "POST",
      body: { swaps, threshold: Number(fd.get("threshold")), name: fd.get("name") },
    });
    ctx.show(asset, t("recolor.done", { name: asset.name }));
  });
}
