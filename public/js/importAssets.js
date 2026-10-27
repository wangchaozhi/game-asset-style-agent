// Import the user's own images as assets.
import { $, api, esc, toast } from "./lib.js";
import { state } from "./state.js";
import { renderAssets } from "./assets.js";
import { t, typeLabel } from "./i18n.js";

function open() {
  const form = $("#importForm");
  const types = Object.entries(state.config.assetTypes);
  form.elements.assetType.innerHTML = types.map(([k, label]) => `<option value="${k}">${esc(typeLabel(k, label))}</option>`).join("");
  form.reset();
  sync();
  $("#importDialog").showModal();
}

function sync() {
  const form = $("#importForm");
  form.querySelector("[data-sheet]").hidden = form.elements.assetType.value !== "sprite_sheet";
  const n = form.elements.images.files.length;
  $("#importCount").textContent = n ? t("import.count", { n }) + (n > 20 ? t("import.max") : "") : "";
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
      toast(t("import.done", { n: r.imported.length }));
    } catch (err) {
      toast(err.message);
    } finally {
      button.disabled = false;
    }
  });
}
