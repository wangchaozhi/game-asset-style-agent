// Colour-swap variants: pick new colours for the asset's main colours, save as a new sibling asset.
import { $, api, esc } from "../lib.js";
import { state } from "../state.js";
import { onSubmit, pct } from "./common.js";

export function html(a) {
  if (a.assetType === "background") return "";
  return `<div class="recolor">
    <div class="sizes-head"><b>换色变体</b><span class="muted recolor-hint">加载颜色中…</span></div>
    <form class="recolor-form" data-recolor="${a.id}">
      <div class="recolor-rows"></div>
      <div class="recolor-opts">
        <label>名称 <input name="name" value="${esc(a.name)}（变体）" maxlength="80" /></label>
        <label>容差 <select name="threshold"><option value="12">12</option><option value="20" selected>20</option><option value="30">30</option><option value="45">45</option></select></label>
        <button class="btn ghost" type="submit">生成变体</button>
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
    hint.textContent = "改掉想换的颜色，明暗层次会保留";
    form.querySelector(".recolor-rows").innerHTML = colors
      .map(
        (c) => `<label class="recolor-row" title="占 ${pct(c.share)}">
          <i class="swatch" style="background:${esc(c.hex)}"></i><span>${esc(c.hex)}</span> →
          <input type="color" data-from="${esc(c.hex)}" value="${esc(c.hex)}" aria-label="把 ${esc(c.hex)} 换成" /></label>`,
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
    if (!swaps.length) throw new Error("先改掉至少一种颜色");
    const asset = await api(`/api/projects/${state.project.id}/assets/${form.dataset.recolor}/recolor`, {
      method: "POST",
      body: { swaps, threshold: Number(fd.get("threshold")), name: fd.get("name") },
    });
    ctx.show(asset, `已生成变体「${asset.name}」`);
  });
}
