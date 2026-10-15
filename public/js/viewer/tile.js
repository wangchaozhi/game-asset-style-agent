// Tiles: 3×3 seam check and one-click seamless version.
import { $, api } from "../lib.js";
import { fileUrl, state } from "../state.js";
import { onSubmit } from "./common.js";

export function html(a) {
  if (a.assetType !== "tile") return "";
  return `<div class="tile-check">
    <div class="sizes-head"><b>无缝平铺检查</b><span class="seam-result muted">检测中…</span></div>
    <div class="tile-grid" style="background-image:url('${fileUrl(a.file)}?t=${Date.now()}')"></div>
    <form class="seamless-form" data-seamless="${a.id}">
      <label>边缘融合 <select name="overlap"><option value="0.1">10%</option><option value="0.15" selected>15%</option><option value="0.25">25%</option></select></label>
      <button class="btn ghost" type="submit">一键无缝化（生成新版本）</button>
    </form>
  </div>`;
}

export async function load(a) {
  if (a.assetType !== "tile") return;
  const el = $("#viewerMeta .seam-result");
  try {
    const r = await api(`/api/projects/${state.project.id}/assets/${a.id}/seams`);
    if (!el.isConnected) return;
    const bad = [!r.horizontalOk && "左右", !r.verticalOk && "上下"].filter(Boolean).join("、");
    el.className = `seam-result ${r.seamless ? "ok" : "bad"}`;
    el.textContent = r.seamless
      ? `✓ 可无缝平铺（左右差 ${r.horizontalDiff}，上下差 ${r.verticalDiff}）`
      : `✗ ${bad}边缘有接缝（左右差 ${r.horizontalDiff}，上下差 ${r.verticalDiff}，基线 ${r.baseline}）`;
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
    ctx.show(asset, "已生成无缝版本，可「对比上一版本」查看差异");
  });
}
