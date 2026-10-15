// Palette check against the style guide.
import { $, api, esc } from "../lib.js";
import { state } from "../state.js";
import { onSubmit, pct } from "./common.js";

export const html = (a) =>
  state.project.styleGuide
    ? `<div class="palette-check"><div class="sizes-head"><b>色板一致性</b><span class="pal-result muted">检测中…</span></div>
        <form class="snap-form" data-snap="${a.id}" hidden>
          <select name="dither" aria-label="抖动方式"><option value="none">硬吸附（像素风 / 平涂）</option><option value="ordered">有序抖动（保留渐变感）</option></select>
          <button class="btn ghost" type="submit" title="把每个像素换成最接近的色板颜色，生成新版本">吸附到色板（生成新版本）</button>
        </form>
      </div>`
    : "";

export function bind(root, ctx) {
  onSubmit(root, "form[data-snap]", async (form, fd) => {
    const { asset, before, after } = await api(`/api/projects/${state.project.id}/assets/${form.dataset.snap}/snap-palette`, {
      method: "POST",
      body: { dither: fd.get("dither") },
    });
    ctx.show(asset, `已吸附：色板内像素 ${pct(before.coverage)} → ${pct(after.coverage)}`);
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
    label.textContent = `${pct(r.coverage)} 在色板内 · 平均色差 ΔE ${r.meanDeltaE}`;
    const offShare = Math.max(0, 1 - r.coverage);
    const segs = r.usage
      .filter((u) => u.share > 0)
      .map((u) => `<i style="flex:${u.share};background:${esc(u.hex)}" title="${esc(u.hex)} · ${pct(u.share)}"></i>`)
      .join("");
    box.insertAdjacentHTML(
      "beforeend",
      `<div class="pal-bar" title="每段宽度 = 最接近该色板颜色的像素占比">${segs}</div>
      ${
        r.offPalette.length
          ? `<div class="pal-off"><span class="muted">色板外：</span>${r.offPalette
              .map((o) => `<span class="pal-chip"><i style="background:${esc(o.hex)}"></i>${esc(o.hex)} ${pct(o.share)}</span>`)
              .join("")}</div>`
          : `<div class="muted pal-off">没有明显的色板外颜色${offShare > 0.02 ? "（零散的过渡色）" : ""}</div>`
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
