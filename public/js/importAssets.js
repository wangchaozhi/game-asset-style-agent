// Import the user's own images as assets.
import { $, api, esc, toast } from "./lib.js";
import { state } from "./state.js";
import { renderAssets } from "./assets.js";

function open() {
  const form = $("#importForm");
  const types = Object.entries(state.config.assetTypes);
  form.elements.assetType.innerHTML = types.map(([k, label]) => `<option value="${k}">${esc(label)}</option>`).join("");
  form.reset();
  sync();
  $("#importDialog").showModal();
}

function sync() {
  const form = $("#importForm");
  form.querySelector("[data-sheet]").hidden = form.elements.assetType.value !== "sprite_sheet";
  const n = form.elements.images.files.length;
  $("#importCount").textContent = n ? `已选 ${n} 张${n > 20 ? "，一次最多 20 张" : ""}` : "";
}

export function bindImport() {
  $("#importBtn").addEventListener("click", open);
  $("#importForm").addEventListener("change", sync);
  $("#importForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    if (form.elements.assetType.value !== "sprite_sheet" || !form.elements.frames.value) fd.delete("frames");
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const r = await api(`/api/projects/${state.project.id}/assets/import`, { method: "POST", body: fd });
      state.project = r.project;
      renderAssets();
      $("#importDialog").close();
      toast(`已导入 ${r.imported.length} 个素材`);
    } catch (err) {
      toast(err.message);
    } finally {
      button.disabled = false;
    }
  });
}
