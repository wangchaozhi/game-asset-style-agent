// Batch actions on the selected assets: review, delete, export.
import { $, api, toast } from "./lib.js";
import { state } from "./state.js";
import { renderAssets, setSelecting, visibleAssets } from "./assets.js";
import { loadProjectsQuiet } from "./projects.js";
import { run } from "./run.js";

const VERB = { approve: "通过", reject: "驳回", pending: "设为待审核", delete: "移到回收站", restore: "恢复", purge: "彻底删除", tag: "添加标签到", untag: "移除标签自" };
const splitTags = (s) => s.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean);
const REMOVES = new Set(["delete", "restore", "purge"]);

async function apply(action) {
  const ids = [...state.selected];
  if (!ids.length) return;
  let tags;
  if (action === "tag" || action === "untag") {
    const input = prompt(action === "tag" ? "要添加的标签（多个用逗号或空格分隔）" : "要移除的标签（多个用逗号或空格分隔）", "");
    if (!input) return;
    tags = splitTags(input);
    if (!tags.length) return;
  }
  if (action === "purge" && !confirm(`彻底删除所选的 ${ids.length} 个素材及其文件？此操作不可撤销。`)) return;
  try {
    const { affected, project } = await api(`/api/projects/${state.project.id}/assets/batch`, { method: "POST", body: { action, ids, ...(tags ? { tags } : {}) } });
    state.project = project;
    if (REMOVES.has(action)) state.selected.clear();
    renderAssets();
    if (REMOVES.has(action)) loadProjectsQuiet();
    toast(`已${VERB[action]} ${affected} 个素材`);
  } catch (e) {
    toast(e.message);
  }
}

function download(path) {
  const ids = [...state.selected];
  if (!ids.length) return;
  location.href = `/api/projects/${state.project.id}/${path}?ids=${ids.map(encodeURIComponent).join(",")}`;
}

/**
 * What to tell the agent to fix: the user's own note, or the reason for a rejection.
 * An approval note ("looks great") is not feedback.
 */
const feedbackOf = (a) => (a.notes && (a.reviewer === "user" || a.status === "rejected") ? a.notes : "");

/** Hand the selected assets to the agent for redrawing, each with its review note as feedback. */
function redrawSelected() {
  const picked = state.project.assets.filter((a) => state.selected.has(a.id));
  if (!picked.length) return;
  if (picked.length > 10) return toast("一次最多重画 10 个素材，请减少选择");
  if (state.job) return toast("已有任务在运行，请稍候");
  const missing = picked.filter((a) => !feedbackOf(a)).length;
  if (missing && !confirm(`${missing} 个素材没有审核意见，Agent 会自行判断哪里跑偏。继续？`)) return;
  setSelecting(false);
  run("", picked.map((a) => ({ assetId: a.id, feedback: feedbackOf(a) })));
}

async function emptyTrash() {
  const n = state.project.trash?.length ?? 0;
  if (!n || !confirm(`彻底删除回收站中的 ${n} 个素材及其文件？此操作不可撤销。`)) return;
  try {
    const { affected, project } = await api(`/api/projects/${state.project.id}/trash/empty`, { method: "POST" });
    state.project = project;
    state.selected.clear();
    renderAssets();
    toast(`已清空回收站（${affected} 个）`);
  } catch (e) {
    toast(e.message);
  }
}

export function bindBatch() {
  $("#batchBar").addEventListener("click", (e) => {
    const action = e.target.closest("[data-batch]")?.dataset.batch;
    if (!action) return;
    if (action === "all") {
      for (const a of visibleAssets()) state.selected.add(a.id);
      renderAssets();
    } else if (action === "none") {
      state.selected.clear();
      renderAssets();
    } else if (action === "zip") download("export.zip");
    else if (action === "atlas") download("export-atlas.zip");
    else if (action === "exit") setSelecting(false);
    else if (action === "empty") emptyTrash();
    else if (action === "redraw") redrawSelected();
    else apply(action);
  });
}
