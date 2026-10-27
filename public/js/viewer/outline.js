// Outer outline as a new version: width and colour (defaults to the darkest palette colour).
import { api } from "../lib.js";
import { state } from "../state.js";
import { onSubmit } from "./common.js";

const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};

/** Same default as the server: the darkest style-palette colour. */
const darkest = () => {
  const hexes = (state.project.styleGuide?.palette ?? []).map((p) => p.hex).filter((h) => /^#[0-9a-f]{6}$/i.test(h));
  return hexes.length ? hexes.reduce((a, b) => (lum(b) < lum(a) ? b : a)) : "#1a1a1a";
};

export function html(a) {
  if (a.assetType === "background" || a.assetType === "tile") return "";
  return `<form class="outline-form" data-outline="${a.id}">
      <label>描边 <select name="width" aria-label="描边宽度">${[1, 2, 3, 4, 6, 8].map((w) => `<option value="${w}" ${w === 2 ? "selected" : ""}>${w}px</option>`).join("")}</select></label>
      <label>颜色 <input name="color" type="color" value="${darkest()}" aria-label="描边颜色" /></label>
      <button class="btn ghost" type="submit">加描边（生成新版本）</button>
    </form>`;
}

export function bind(root, ctx) {
  onSubmit(root, "form[data-outline]", async (form, fd) => {
    const asset = await api(`/api/projects/${state.project.id}/assets/${form.dataset.outline}/outline`, {
      method: "POST",
      body: { width: Number(fd.get("width")), color: fd.get("color") },
    });
    ctx.show(asset, "已加描边，可「对比上一版本」查看差异");
  });
}
