// Style reference images: list, upload (picker / drag-drop / paste), remove.
import { $, api, esc, toast } from "./lib.js";
import { state, thumbUrl } from "./state.js";
import { t } from "./i18n.js";

export function renderRefs() {
  const refs = state.project.refs;
  $("#refs").innerHTML = refs
    .map(
      (r, i) => `<figure class="ref-item">
        <div class="ref"><img src="${thumbUrl(r.file, 160)}" alt="${esc(r.originalName)}" /><span class="ref-num">${i + 1}</span><button data-ref="${r.id}" title="${t("refs.remove")}">×</button></div>
        <figcaption><button class="ref-note ${r.note ? "has" : ""}" data-note="${r.id}" title="${r.note ? esc(r.note) : t("refs.noteTitle")}">${r.note ? esc(r.note) : t("refs.addNote")}</button></figcaption>
      </figure>`,
    )
    .join("");
}

async function editNote(refId) {
  const ref = state.project.refs.find((r) => r.id === refId);
  if (!ref) return;
  const note = prompt(t("refs.notePrompt"), ref.note ?? "");
  if (note === null) return;
  try {
    state.project = await api(`/api/projects/${state.project.id}/refs/${refId}`, { method: "PATCH", body: { note } });
    renderRefs();
  } catch (e) {
    toast(e.message);
  }
}

export async function uploadRefs(files) {
  const imgs = [...files].filter((f) => f.type.startsWith("image/"));
  if (!imgs.length) return;
  const fd = new FormData();
  imgs.slice(0, 8).forEach((f) => fd.append("images", f));
  toast(t("refs.uploading"));
  try {
    state.project = await api(`/api/projects/${state.project.id}/refs`, { method: "POST", body: fd });
    renderRefs();
    toast(t("refs.added", { n: imgs.length }));
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
    const noteFor = e.target.closest("[data-note]")?.dataset.note;
    if (noteFor) return editNote(noteFor);
    const id = e.target.dataset?.ref;
    if (!id) return;
    state.project = await api(`/api/projects/${state.project.id}/refs/${id}`, { method: "DELETE" });
    renderRefs();
  });

}
