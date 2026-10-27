// Project switching, the conversation bar and the full re-render.
import { $, api, esc, toast } from "./lib.js";
import { state } from "./state.js";
import { renderRefs } from "./refs.js";
import { renderStyle } from "./styleGuide.js";
import { renderAssets } from "./assets.js";
import { has, t } from "./i18n.js";

export async function loadProjects(selectId) {
  const list = await api("/api/projects");
  const sel = $("#projectSelect");
  if (!list.length) {
    const p = await api("/api/projects", { method: "POST", body: { name: t("project.first") } });
    return loadProjects(p.id);
  }
  sel.innerHTML = list.map((p) => `<option value="${p.id}">${esc(p.name)}（${p.assets}）</option>`).join("");
  const id = selectId || localStorage.getItem("gaa.project") || list[0].id;
  sel.value = list.some((p) => p.id === id) ? id : list[0].id;
  await openProject(sel.value);
}

export async function openProject(id) {
  // Let the run module detach from a job that belongs to the project being left.
  document.dispatchEvent(new CustomEvent("gaa:project-switch", { detail: { from: state.project?.id, to: id } }));
  state.query = "";
  state.typeFilter = "";
  state.tagFilter = "";
  state.colorFilter = null;
  const clearColor = $("#colorFilterClear");
  if (clearColor) clearColor.hidden = true;
  const search = $("#assetSearch");
  if (search) search.value = "";
  try { localStorage.setItem("gaa.project", id); } catch {}
  state.project = await api(`/api/projects/${id}`);
  renderAll();
}

export async function loadConversationInfo() {
  const info = await api(`/api/projects/${state.project.id}/conversation`);
  const bar = $("#convBar");
  bar.hidden = !info.runs.length;
  if (!info.runs.length) return;
  const recent = info.runs.slice(-3).map((r) => `<li>${esc(r.request || t("usage.byTypes"))}</li>`).join("");
  bar.innerHTML = `<div class="conv-head"><span>${t("conv.rounds", { n: `<b>${info.runs.length}</b>` })} · ${(info.bytes / 1048576).toFixed(1)} MB</span>
    <button class="btn link" id="newConv">${t("conv.new")}</button></div><ol start="${Math.max(1, info.runs.length - 2)}">${recent}</ol>`;
}

export function renderAll() {
  loadConversationInfo();
  $("#exportApproved").href = `/api/projects/${state.project.id}/export.zip`;
  $("#backupProject").href = `/api/projects/${state.project.id}/backup.zip`;
  $("#styleSheetLink").href = `/api/projects/${state.project.id}/style-sheet.html`;
  state.pixelKernel = /pixel|像素|8-?bit|16-?bit/i.test(JSON.stringify(state.project.styleGuide ?? ""));
  renderRefs();
  renderStyle();
  renderAssets();
}


export async function loadProjectsQuiet() {
  const list = await api("/api/projects");
  const sel = $("#projectSelect");
  const cur = sel.value;
  sel.innerHTML = list.map((p) => `<option value="${p.id}">${esc(p.name)}（${p.assets}）</option>`).join("");
  sel.value = cur;
}


/** onSwitch runs after the user switches project (e.g. to re-attach a running job). */
export function bindProjects(onSwitch) {
  $("#projectSelect").addEventListener("change", (e) => openProject(e.target.value).then(onSwitch));
  $("#newProject").addEventListener("click", async () => {
    const form = $("#newProjectForm");
    form.reset();
    form.elements.name.value = t("newProject.default");
    const list = await api("/api/projects");
    const presets = Object.entries(state.config.stylePresets ?? {});
    form.elements.styleFrom.innerHTML = `<option value="">${t("newProject.scratch")}</option>
      ${presets.length ? `<optgroup label="${t("newProject.presets")}">${presets.map(([k, label]) => `<option value="preset:${esc(k)}">${esc(has(`preset.${k}`) ? t(`preset.${k}`) : label)}</option>`).join("")}</optgroup>` : ""}
      ${list.length ? `<optgroup label="${t("newProject.reuse")}">${list.map((p) => `<option value="${esc(p.id)}">${t("newProject.reuseOne", { name: esc(p.name) })}</option>`).join("")}</optgroup>` : ""}`;
    $("#newProjectDialog").showModal();
    form.elements.name.select();
  });
  $("#newProjectForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const from = String(fd.get("styleFrom") ?? "");
    const body = {
      name: String(fd.get("name")).trim() || t("newProject.default"),
      ...(from.startsWith("preset:") ? { preset: from.slice(7) } : from ? { styleFrom: from } : {}),
    };
    try {
      const p = await api("/api/projects", { method: "POST", body });
      $("#newProjectDialog").close();
      await loadProjects(p.id);
      if (body.styleFrom) toast(t(p.styleGuide ? "newProject.reused" : "newProject.refsOnly"));
      if (body.preset) toast(t("newProject.presetUsed"));
    } catch (err) {
      toast(err.message);
    }
  });
  $("#deleteProject").addEventListener("click", async () => {
    if (!confirm(t("project.confirmDelete", { name: state.project.name }))) return;
    try {
      await api(`/api/projects/${state.project.id}`, { method: "DELETE" });
    } catch (err) {
      return toast(err.message);
    }
    try { localStorage.removeItem("gaa.project"); } catch {}
    await loadProjects();
  });

  $("#importProject").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const fd = new FormData();
    fd.append("backup", file);
    toast(t("project.importing"));
    try {
      const { project, skipped } = await api("/api/projects/import", { method: "POST", body: fd });
      await loadProjects(project.id);
      toast(skipped.length ? t("project.importedSkipped", { name: project.name, skipped: skipped.slice(0, 3).join(t("tile.and")) + (skipped.length > 3 ? t("project.etc") : "") }) : t("project.imported", { name: project.name }));
    } catch (err) {
      toast(err.message);
    }
  });
  $("#convBar").addEventListener("click", async (e) => {
    if (e.target.id !== "newConv") return;
    if (!confirm(t("conv.confirmNew"))) return;
    await api(`/api/projects/${state.project.id}/conversation`, { method: "DELETE" });
    loadConversationInfo();
    toast(t("conv.started"));
  });
}
