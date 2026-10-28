// Batch actions on the selected assets: review, delete, export, post-process.
import { $, api, esc, toast } from "./lib.js";
import { fileUrl, state } from "./state.js";
import { renderAssets, setSelecting, visibleAssets } from "./assets.js";
import { loadProjectsQuiet } from "./projects.js";
import { run } from "./run.js";
import { t } from "./i18n.js";

const splitTags = (s) => s.split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean);
const REMOVES = new Set(["delete", "restore", "purge"]);
/** Batch edits that /assets/revert can put back from a snapshot; delete and restore undo each other. */
const EDITS = new Set(["approve", "reject", "pending", "tag", "untag", "rename"]);
const OPPOSITE = { delete: "restore", restore: "delete" };

/** What an undo needs from each asset before a batch edit. */
export const snapshot = (assets, ids) =>
  assets.filter((a) => ids.includes(a.id)).map((a) => ({ id: a.id, status: a.status, reviewer: a.reviewer, tags: a.tags ?? [], name: a.name }));

/** Put back the last batch action: a snapshot for edits, the opposite action for delete / restore. */
async function undo(action, ids, before) {
  try {
    const { project } = EDITS.has(action)
      ? await api(`/api/projects/${state.project.id}/assets/revert`, { method: "POST", body: { items: before } })
      : await api(`/api/projects/${state.project.id}/assets/batch`, { method: "POST", body: { action: OPPOSITE[action], ids } });
    state.project = project;
    renderAssets();
    if (REMOVES.has(action)) loadProjectsQuiet();
    toast(t("batch.undone"));
  } catch (e) {
    toast(e.message);
  }
}

/** Run a batch action on the selection, or on `only` (e.g. one card from its menu). */
export async function apply(action, only) {
  // Library order, so a rename numbers the assets the way they are shown.
  const shown = visibleAssets().map((a) => a.id).filter((id) => state.selected.has(id));
  const ids = only ?? [...shown, ...[...state.selected].filter((id) => !shown.includes(id))];
  if (!ids.length) return;
  let tags;
  let rename;
  if (action === "rename") {
    const prefix = prompt(t("batch.renamePrompt", { n: ids.length }), "");
    if (!prefix?.trim()) return;
    rename = { prefix: prefix.trim(), start: 1 };
  }
  if (action === "tag" || action === "untag") {
    const input = prompt(t(action === "tag" ? "batch.tagPrompt" : "batch.untagPrompt"), "");
    if (!input) return;
    tags = splitTags(input);
    if (!tags.length) return;
  }
  if (action === "purge" && !confirm(t("batch.confirmPurge", { n: ids.length }))) return;
  const before = EDITS.has(action) ? snapshot(state.project.assets, ids) : null;
  const projectId = state.project.id;
  try {
    const { affected, project } = await api(`/api/projects/${state.project.id}/assets/batch`, { method: "POST", body: { action, ids, ...(tags ? { tags } : {}), ...(rename ?? {}) } });
    state.project = project;
    if (REMOVES.has(action)) for (const id of ids) state.selected.delete(id);
    renderAssets();
    if (REMOVES.has(action)) loadProjectsQuiet();
    const canUndo = affected && (before || OPPOSITE[action]);
    // The undo button only applies while the same project is open.
    toast(
      t(`batch.did.${action}`, { n: affected }),
      canUndo ? { label: t("batch.undo"), run: () => state.project.id === projectId && undo(action, ids, before) } : undefined,
    );
  } catch (e) {
    toast(e.message);
  }
}


/** Run one post-process over the selection; outline and snap add new versions, cutout works in place. */
async function postProcess(op) {
  const ids = [...state.selected];
  if (!ids.length) return;
  if (ids.length > 30) return toast(t("batch.max30"));
  toast(t(`batch.doing.${op}`, { n: ids.length }));
  const projectId = state.project.id;
  const before = new Map(state.project.assets.map((a) => [a.id, a]));
  try {
    const { done, skipped, project } = await api(`/api/projects/${projectId}/assets/batch-process`, { method: "POST", body: { op, ids } });
    state.project = project;
    renderAssets();
    const reasons = [...new Set(skipped.map((s) => s.reason))].join(t("drift.sep"));
    const takeBack = processUndo(op, done, before);
    toast(
      t(`batch.done.${op}`, { n: done.length }) + (skipped.length ? t("batch.skipped", { n: skipped.length, reasons }) : ""),
      takeBack ? { label: t("batch.undo"), run: () => state.project.id === projectId && takeBack() } : undefined,
    );
  } catch (e) {
    toast(e.message);
  }
}

/**
 * How to take back a batch post-process, or null when it can't be: outline and snap made new
 * versions, which go to the trash; a cut-out is undone by restoring the original, which only gives
 * the previous image back when the asset hadn't been cut out before.
 */
export function processUndo(op, done, before) {
  if (!done.length) return null;
  if (op === "outline" || op === "snap") {
    const made = done.map((d) => d.result);
    return () => finishUndo(api(`/api/projects/${state.project.id}/assets/batch`, { method: "POST", body: { action: "delete", ids: made } }).then((r) => r.project));
  }
  if (op === "cutout" && done.every((d) => { const a = before.get(d.id); return a && (!a.originalFile || a.file === a.originalFile); })) {
    return () =>
      finishUndo(
        Promise.all(done.map((d) => api(`/api/projects/${state.project.id}/assets/${d.id}/cutout`, { method: "POST", body: { restore: true } }))).then(() =>
          api(`/api/projects/${state.project.id}`),
        ),
      );
  }
  return null;
}

async function finishUndo(projectPromise) {
  try {
    state.project = await projectPromise;
    renderAssets();
    loadProjectsQuiet();
    toast(t("batch.undone"));
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
  if (picked.length > 10) return toast(t("batch.max10"));
  if (state.job) return toast(t("viewer.busy"));
  const missing = picked.filter((a) => !feedbackOf(a)).length;
  if (missing && !confirm(t("batch.confirmNoNotes", { n: missing }))) return;
  setSelecting(false);
  run("", picked.map((a) => ({ assetId: a.id, feedback: feedbackOf(a) })));
}

async function emptyTrash() {
  const n = state.project.trash?.length ?? 0;
  if (!n || !confirm(t("batch.confirmEmpty", { n }))) return;
  try {
    const { affected, project } = await api(`/api/projects/${state.project.id}/trash/empty`, { method: "POST" });
    state.project = project;
    state.selected.clear();
    renderAssets();
    toast(t("batch.emptied", { n: affected }));
  } catch (e) {
    toast(e.message);
  }
}

/** Show 2-6 selected assets side by side at the same scale. */
function compareSelected() {
  const picked = visibleAssets().filter((a) => state.selected.has(a.id));
  if (picked.length < 2 || picked.length > 6) return toast(t("batch.compareRange"));
  $("#sideGrid").innerHTML = picked
    .map(
      (a) => `<figure><button type="button" data-side-open="${a.id}" title="${t("drift.open")}"><img src="${fileUrl(a.file)}" alt="${esc(a.name)}" /></button>
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
    if (!ids.length) return toast(t("batch.noOld"));
    if (!confirm(t("batch.confirmCleanup", { n: ids.length, days: state.config.trashDays ?? 7 }))) return;
    const { affected, project } = await api(base, { method: "POST" });
    state.project = project;
    state.selected.clear();
    renderAssets();
    loadProjectsQuiet();
    toast(t("batch.cleaned", { n: affected }));
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
