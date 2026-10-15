// Background removal with an adjustable tolerance, and restoring the model's original output.
import { api, toast } from "../lib.js";
import { state } from "../state.js";
import { onSubmit } from "./common.js";

export const html = (a) => `<form class="cutout-form" data-cutout="${a.id}">
      <label>去背景容差 <input name="tolerance" type="range" min="4" max="100" value="28" /><output>28</output></label>
      <button class="btn ghost" type="submit">${a.originalFile ? "重新抠图" : "去除背景"}</button>
      ${a.originalFile ? `<button class="btn ghost" type="button" data-restore="${a.id}">恢复原图</button>` : ""}
    </form>`;

export function bind(root, ctx) {
  const cutout = async (id, body) => {
    const asset = await api(`/api/projects/${state.project.id}/assets/${id}/cutout`, { method: "POST", body });
    ctx.show(asset, body.restore ? "已恢复原图" : "背景已去除");
  };
  onSubmit(root, "form[data-cutout]", (form, fd) => cutout(form.dataset.cutout, { tolerance: Number(fd.get("tolerance")) }));
  root.addEventListener("input", (e) => {
    if (e.target.name === "tolerance") e.target.nextElementSibling.value = e.target.value;
  });
  root.addEventListener("click", (e) => {
    const id = e.target.dataset?.restore;
    if (id) cutout(id, { restore: true }).catch((err) => toast(err.message));
  });
}
