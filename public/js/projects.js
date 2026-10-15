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
  $("#exportAll").href = `/api/projects/${state.project.id}/export.zip?status=all`;
  $("#exportSized").href = `/api/projects/${state.project.id}/export.zip?sizes=1`;
  $("#exportAtlas").href = `/api/projects/${state.project.id}/export-atlas.zip`;
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
    const name = prompt("项目名称", "新项目");
    if (name === null) return;
    const p = await api("/api/projects", { method: "POST", body: { name } });
    await loadProjects(p.id);
  });
  $("#deleteProject").addEventListener("click", async () => {
    if (!confirm(`删除项目「${state.project.name}」及其全部素材？此操作不可撤销。`)) return;
    await api(`/api/projects/${state.project.id}`, { method: "DELETE" });
    try { localStorage.removeItem("gaa.project"); } catch {}
    await loadProjects();
  });

  $("#convBar").addEventListener("click", async (e) => {
    if (e.target.id !== "newConv") return;
    if (!confirm("清空与 Agent 的对话记忆？风格指南和已生成的素材都会保留。")) return;
    await api(`/api/projects/${state.project.id}/conversation`, { method: "DELETE" });
    loadConversationInfo();
    toast("已开启新对话");
  });
}
