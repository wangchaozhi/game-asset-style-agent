// Game sizes: preset downloads with hover preview, custom size, pixel-art kernel toggle.
import { $, toast } from "../lib.js";
import { state } from "../state.js";

export function html(a) {
  const presets = state.config.sizePresets[a.assetType] ?? [];
  const base = `/api/projects/${state.project.id}/assets/${a.id}/sized.png`;
  return `<div class="sizes">
    <div class="sizes-head"><b>游戏尺寸</b>
      <label class="toggle"><input type="checkbox" id="pixelKernel" ${state.pixelKernel ? "checked" : ""} /> 像素风（最近邻）</label></div>
    <div class="size-row">${presets
      .map((s) => `<a class="size-chip" data-size="${s}" href="${base}?size=${s}&kernel=${state.pixelKernel ? "nearest" : "smooth"}&download=1">${s}</a>`)
      .join("")}
      <input class="size-custom" placeholder="自定义 48 / 300x200" data-base="${base}" /></div>
    <div class="size-preview checker" hidden><img alt="缩放预览" /></div>
  </div>`;
}

export function bind(root, ctx) {
  root.addEventListener("change", (e) => {
    if (e.target.id !== "pixelKernel") return;
    state.pixelKernel = e.target.checked;
    ctx.reopen();
  });
  root.addEventListener("mouseover", (e) => {
    const chip = e.target.closest(".size-chip");
    if (!chip) return;
    const box = $("#viewerMeta .size-preview");
    box.hidden = false;
    const img = box.querySelector("img");
    // Show small sizes enlarged so pixel crispness can be judged.
    img.onload = () => (img.style.width = `${Math.min(img.naturalWidth * (img.naturalWidth <= 64 ? 4 : 1), 280)}px`);
    img.src = chip.href.replace("&download=1", "");
  });
  root.addEventListener("keydown", (e) => {
    if (!e.target.classList.contains("size-custom") || e.key !== "Enter") return;
    e.preventDefault();
    const v = e.target.value.trim().toLowerCase().replace("×", "x");
    if (!/^\d{1,4}(x\d{1,4})?$/.test(v)) return toast("格式：48 或 300x200");
    location.href = `${e.target.dataset.base}?size=${v}&kernel=${state.pixelKernel ? "nearest" : "smooth"}&download=1`;
  });
}
