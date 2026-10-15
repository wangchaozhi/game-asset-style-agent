// Style reference images: list, upload (picker / drag-drop / paste), remove.
import { $, api, esc, toast } from "./lib.js";
import { fileUrl, state } from "./state.js";

export function renderRefs() {
  const refs = state.project.refs;
  $("#refs").innerHTML = refs
    .map((r) => `<div class="ref"><img src="${fileUrl(r.file)}" alt="${esc(r.originalName)}" /><button data-ref="${r.id}" title="移除">×</button></div>`)
    .join("");
}

export async function uploadRefs(files) {
  const imgs = [...files].filter((f) => f.type.startsWith("image/"));
  if (!imgs.length) return;
  const fd = new FormData();
  imgs.slice(0, 8).forEach((f) => fd.append("images", f));
  toast("上传中…");
  try {
    state.project = await api(`/api/projects/${state.project.id}/refs`, { method: "POST", body: fd });
    renderRefs();
    toast(`已添加 ${imgs.length} 张参考图`);
  } catch (e) {
    toast(e.message);
  }
}


export function bindRefs() {
  const dz = $("#dropzone");
  $("#refInput").addEventListener("change", (e) => { uploadRefs(e.target.files); e.target.value = ""; });
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("over"));
  dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("over"); uploadRefs(e.dataTransfer.files); });
  document.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length && !e.target.closest?.("textarea")) uploadRefs(files);
  });
  $("#refs").addEventListener("click", async (e) => {
    const id = e.target.dataset?.ref;
    if (!id) return;
    state.project = await api(`/api/projects/${state.project.id}/refs/${id}`, { method: "DELETE" });
    renderRefs();
  });

}
