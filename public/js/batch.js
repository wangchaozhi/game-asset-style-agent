// Batch actions on the selected assets: review, delete, export, post-process.
import { $, api, esc, toast } from "./lib.js";
import { fileUrl, state } from "./state.js";
import { renderAssets, setSelecting, visibleAssets } from "./assets.js";
import { loadProjectsQuiet } from "./projects.js";
import { run } from "./run.js";

const VERB = { approve: "通过", reject: "驳回", pending: "设为待审核", delete: "移到回收站", restore: "恢复", purge: "彻底删除", tag: "添加标签到", untag: "移除标签自", rename: "改名" };
const splitTags = (s) => s.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean);
const REMOVES = new Set(["delete", "restore", "purge"]);

async function apply(action) {
  // Library order, so a rename numbers the assets the way they are shown.
  const shown = visibleAssets().map((a) => a.id).filter((id) => state.selected.has(id));
  const ids = [...shown, ...[...state.selected].filter((id) => !shown.includes(id))];
  if (!ids.length) return;
  let tags;
  let rename;
  if (action === "rename") {
    const prefix = prompt(`把所选 ${ids.length} 个素材按顺序改名为「前缀 + 序号」，例如 coin_ → coin_01、coin_02…\n名称前缀：`, "");
    if (!prefix?.trim()) return;
    rename = { prefix: prefix.trim(), start: 1 };
  }
  if (action === "tag" || action === "untag") {
    const input = prompt(action === "tag" ? "要添加的标签（多个用逗号或空格分隔）" : "要移除的标签（多个用逗号或空格分隔）", "");
    if (!input) return;
    tags = splitTags(input);
    if (!tags.length) return;
  }
  if (action === "purge" && !confirm(`彻底删除所选的 ${ids.length} 个素材及其文件？此操作不可撤销。`)) return;
  try {
    const { affected, project } = await api(`/api/projects/${state.project.id}/assets/batch`, { method: "POST", body: { action, ids, ...(tags ? { tags } : {}), ...(rename ?? {}) } });
    state.project = project;
    if (REMOVES.has(action)) state.selected.clear();
    renderAssets();
    if (REMOVES.has(action)) loadProjectsQuiet();
    toast(`已${VERB[action]} ${affected} 个素材`);
  } catch (e) {
    toast(e.message);
  }
}

const PROCESS = { outline: "加描边", cutout: "去背景", snap: "吸附色板" };

/** Run one post-process over the selection; outline and snap add new versions, cutout works in place. */
async function postProcess(op) {
  const ids = [...state.selected];
  if (!ids.length) return;
  if (ids.length > 30) return toast("一次最多处理 30 个素材，请减少选择");
  toast(`正在${PROCESS[op]}（${ids.length} 个）…`);
  try {
    const { done, skipped, project } = await api(`/api/projects/${state.project.id}/assets/batch-process`, { method: "POST", body: { op, ids } });
    state.project = project;
    renderAssets();
    const reasons = [...new Set(skipped.map((s) => s.reason))].join("；");
    toast(`已${PROCESS[op]} ${done.length} 个${skipped.length ? `，跳过 ${skipped.length} 个（${reasons}）` : ""}`);
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

/** Show 2-6 selected assets side by side at the same scale. */
function compareSelected() {
  const picked = visibleAssets().filter((a) => state.selected.has(a.id));
  if (picked.length < 2 || picked.length > 6) return toast("请选择 2-6 个素材进行比较");
  $("#sideGrid").innerHTML = picked
    .map(
      (a) => `<figure><button type="button" data-side-open="${a.id}" title="打开查看器"><img src="${fileUrl(a.file)}" alt="${esc(a.name)}" /></button>
        <figcaption>${esc(a.name)}<span class="muted">${esc(state.config.assetTypes[a.assetType] ?? a.assetType)}</span></figcaption></figure>`,
    )
    .join("");
  $("#sideGrid").style.setProperty("--cols", String(Math.min(picked.length, 3)));
  $("#compareDialog").showModal();
}

/** Move old versions that an approved newer version replaces to the trash, after showing how many. */
async function cleanupVersions() {
  const base = `/api/projects/${state.project.id}/cleanup-versions`;
  try {
    const { ids } = await api(`${base}?dryRun=1`, { method: "POST" });
    if (!ids.length) return toast("没有可清理的旧版本（只清理已有通过新版本的）");
    if (!confirm(`把 ${ids.length} 个已有通过新版本的旧版本移到回收站？${state.config.trashDays ?? 7} 天内可恢复。`)) return;
    const { affected, project } = await api(base, { method: "POST" });
    state.project = project;
    state.selected.clear();
    renderAssets();
    loadProjectsQuiet();
    toast(`已把 ${affected} 个旧版本移到回收站`);
  } catch (e) {
    toast(e.message);
  }
}

export function bindBatch({ onOpen }) {
  $("#cleanupVersions").addEventListener("click", cleanupVersions);
  $("#sideGrid").addEventListener("click", (e) => {
    const id = e.target.closest("[data-side-open]")?.dataset.sideOpen;
    if (!id) return;
    $("#compareDialog").close();
    onOpen(id);
  });
  $("#compareDialog").addEventListener("change", (e) => {
    if (e.target.name === "sideBg") $("#sideGrid").className = `side-grid bg-${e.target.value}`;
  });
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
    else if (action === "compare") compareSelected();
    else if (action === "redraw") redrawSelected();
    else if (action.startsWith("process:")) postProcess(action.slice(8));
    else apply(action);
  });
}
