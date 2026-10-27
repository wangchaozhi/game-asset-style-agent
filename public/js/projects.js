// Project switching, the conversation bar and the full re-render.
import { $, api, esc, toast } from "./lib.js";
import { state } from "./state.js";
import { renderRefs } from "./refs.js";
import { renderStyle } from "./styleGuide.js";
import { renderAssets } from "./assets.js";

export async function loadProjects(selectId) {
  const list = await api("/api/projects");
  const sel = $("#projectSelect");
  if (!list.length) {
    const p = await api("/api/projects", { method: "POST", body: { name: "我的第一个项目" } });
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
  const recent = info.runs.slice(-3).map((r) => `<li>${esc(r.request || "（按所选类型生成）")}</li>`).join("");
  bar.innerHTML = `<div class="conv-head"><span>对话已进行 <b>${info.runs.length}</b> 轮 · ${(info.bytes / 1048576).toFixed(1)} MB</span>
    <button class="btn link" id="newConv">开启新对话</button></div><ol start="${Math.max(1, info.runs.length - 2)}">${recent}</ol>`;
}

export function renderAll() {
  loadConversationInfo();
  $("#exportApproved").href = `/api/projects/${state.project.id}/export.zip`;
  $("#backupProject").href = `/api/projects/${state.project.id}/backup.zip`;
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
    const list = await api("/api/projects");
    form.elements.styleFrom.innerHTML = `<option value="">从零开始（上传新的参考图）</option>${list
      .map((p) => `<option value="${esc(p.id)}">复用「${esc(p.name)}」的风格</option>`)
      .join("")}`;
    $("#newProjectDialog").showModal();
    form.elements.name.select();
  });
  $("#newProjectForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = { name: String(fd.get("name")).trim() || "新项目", ...(fd.get("styleFrom") ? { styleFrom: fd.get("styleFrom") } : {}) };
    try {
      const p = await api("/api/projects", { method: "POST", body });
      $("#newProjectDialog").close();
      await loadProjects(p.id);
      if (body.styleFrom) toast(p.styleGuide ? "已复用风格指南与参考图" : "已复制参考图（源项目还没有风格指南）");
    } catch (err) {
      toast(err.message);
    }
  });
  $("#deleteProject").addEventListener("click", async () => {
    if (!confirm(`删除项目「${state.project.name}」及其全部素材？此操作不可撤销。`)) return;
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
    toast("正在导入…");
    try {
      const { project, skipped } = await api("/api/projects/import", { method: "POST", body: fd });
      await loadProjects(project.id);
      toast(skipped.length ? `已导入「${project.name}」，跳过：${skipped.slice(0, 3).join("、")}${skipped.length > 3 ? " 等" : ""}` : `已导入「${project.name}」`);
    } catch (err) {
      toast(err.message);
    }
  });
  $("#convBar").addEventListener("click", async (e) => {
    if (e.target.id !== "newConv") return;
    if (!confirm("清空与 Agent 的对话记忆？风格指南和已生成的素材都会保留。")) return;
    await api(`/api/projects/${state.project.id}/conversation`, { method: "DELETE" });
    loadConversationInfo();
    toast("已开启新对话");
  });
}
