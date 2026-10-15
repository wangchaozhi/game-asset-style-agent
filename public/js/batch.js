// Batch actions on the selected assets: review, delete, export.
import { $, api, toast } from "./lib.js";
import { state } from "./state.js";
import { renderAssets, setSelecting, visibleAssets } from "./assets.js";
import { loadProjectsQuiet } from "./projects.js";

const VERB = { approve: "通过", reject: "驳回", pending: "设为待审核", delete: "移到回收站", restore: "恢复", purge: "彻底删除" };
const REMOVES = new Set(["delete", "restore", "purge"]);

async function apply(action) {
  const ids = [...state.selected];
  if (!ids.length) return;
  if (action === "purge" && !confirm(`彻底删除所选的 ${ids.length} 个素材及其文件？此操作不可撤销。`)) return;
  try {
    const { affected, project } = await api(`/api/projects/${state.project.id}/assets/batch`, { method: "POST", body: { action, ids } });
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
    else apply(action);
  });
}
