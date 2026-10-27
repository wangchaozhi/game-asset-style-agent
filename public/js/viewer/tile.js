// Tiles: 3×3 seam check and one-click seamless version.
import { $, api } from "../lib.js";
import { fileUrl, state } from "../state.js";
import { onSubmit } from "./common.js";
import { t } from "../i18n.js";

export function html(a) {
  if (a.assetType !== "tile") return "";
  return `<div class="tile-check">
    <div class="sizes-head"><b>${t("tile.title")}</b><span class="seam-result muted">${t("common.checking")}</span></div>
    <div class="tile-grid" style="background-image:url('${fileUrl(a.file)}?t=${Date.now()}')"></div>
    <form class="seamless-form" data-seamless="${a.id}">
      <label>${t("tile.overlap")} <select name="overlap"><option value="0.1">10%</option><option value="0.15" selected>15%</option><option value="0.25">25%</option></select></label>
      <button class="btn ghost" type="submit">${t("tile.submit")}</button>
    </form>
  </div>`;
}

export async function load(a) {
  if (a.assetType !== "tile") return;
  const el = $("#viewerMeta .seam-result");
  try {
    const r = await api(`/api/projects/${state.project.id}/assets/${a.id}/seams`);
    if (!el.isConnected) return;
    const bad = [!r.horizontalOk && t("tile.lr"), !r.verticalOk && t("tile.tb")].filter(Boolean).join(t("tile.and"));
    el.className = `seam-result ${r.seamless ? "ok" : "bad"}`;
    el.textContent = r.seamless
      ? t("tile.ok", { h: r.horizontalDiff, v: r.verticalDiff })
      : t("tile.bad", { edges: bad, h: r.horizontalDiff, v: r.verticalDiff, base: r.baseline });
  } catch (err) {
    el.textContent = err.message;
  }
}

export function bind(root, ctx) {
  onSubmit(root, "form[data-seamless]", async (form, fd) => {
    const asset = await api(`/api/projects/${state.project.id}/assets/${form.dataset.seamless}/make-seamless`, {
      method: "POST",
      body: { overlap: Number(fd.get("overlap")) },
    });
    ctx.show(asset, t("tile.done"));
  });
}
