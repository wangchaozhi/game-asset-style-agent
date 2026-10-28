// Asset viewer dialog: header, review / redraw, version links, actions and keyboard shortcuts.
// Type-specific tools live in the section modules next to this file.
import { $, api, esc, toast } from "../lib.js";
import { fileUrl, state } from "../state.js";
import { renderAssets, upsertAsset, visibleAssets } from "../assets.js";
import { run } from "../run.js";
import { bindCompare, closeCompare, openCompare } from "./compare.js";
import * as sprite from "./sprite.js";
import * as tile from "./tile.js";
import * as nineSlice from "./nineSlice.js";
import * as palette from "./palette.js";
import * as sizes from "./sizes.js";
import * as cutout from "./cutout.js";
import * as outline from "./outline.js";
import * as recolor from "./recolor.js";
import * as actionSet from "./actionSet.js";
import * as history from "./history.js";
import * as promptSection from "./prompt.js";
import { t, typeLabel } from "../i18n.js";
import { bindZoom, setZoom, toggleGrid, zoomBy } from "./zoom.js";

/** Rendered in this order below the review box; each may render nothing for a given asset. */
const SECTIONS = [actionSet, sprite, tile, nineSlice, palette, sizes, cutout, outline, recolor, promptSection, history];

function versionLinks(a) {
  const parent = a.parentId && state.project.assets.find((x) => x.id === a.parentId);
  const children = state.project.assets.filter((x) => x.parentId === a.id);
  const original = a.variantOf && state.project.assets.find((x) => x.id === a.variantOf);
  const variants = state.project.assets.filter((x) => x.variantOf === a.id);
  if (!parent && !children.length && !original && !variants.length) return "";
  return `<div class="versions">${parent ? `<button class="btn link" data-open="${parent.id}">← ${t("viewer.prev")}</button>` : ""}
    ${children.map((c, i) => `<button class="btn link" data-open="${c.id}">${t("viewer.newer", { n: i + 1 })} →</button>`).join("")}
    ${original ? `<button class="btn link" data-open="${original.id}">← ${t("viewer.original")}</button>` : ""}
    ${variants.map((v) => `<button class="btn link" data-open="${v.id}">${t("viewer.variant", { name: esc(v.name) })}</button>`).join("")}
    ${parent ? `<button class="btn link" data-compare="${parent.id}:${a.id}">${t("viewer.compare")}</button>` : ""}</div>`;
}

export function openViewer(id) {
  const a = state.project.assets.find((x) => x.id === id);
  if (!a) return;
  $("#viewerImg").src = fileUrl(a.file);
  state.viewing = id;
  closeCompare();
  $("#viewerMeta").innerHTML = `
    <h3 class="viewer-title">${esc(a.name)} <button class="btn link rename" data-rename="${a.id}" title="${t("viewer.rename")}" aria-label="${t("viewer.rename")}">✎</button></h3>
    <div class="muted">${esc(typeLabel(a.assetType, state.config.assetTypes[a.assetType]))} · ${esc(a.provider)} · ${new Date(a.createdAt).toLocaleString()}</div>
    <div class="muted file-size" aria-live="polite"></div>
    ${a.notes ? `<div><b>${t(a.reviewer === "user" ? "viewer.myNotes" : "viewer.agentNotes")}: </b>${esc(a.notes)}${a.score && a.reviewer !== "user" ? t("viewer.score", { n: a.score }) : ""}</div>` : ""}
    <div class="viewer-tags">${(a.tags ?? []).map((tag) => `<span class="tag">#${esc(tag)}</span>`).join("")}
      <button class="btn link" data-edit-tags="${a.id}">${t(a.tags?.length ? "viewer.editTags" : "viewer.addTag")}</button></div>
    ${versionLinks(a)}
    <div class="review">
      <div class="verdict">
        <button class="btn ghost ${a.status === "approved" ? "on-ok" : ""}" data-verdict="approved">${t("badge.approved")}</button>
        <button class="btn ghost ${a.status === "rejected" ? "on-bad" : ""}" data-verdict="rejected">${t("badge.rejected")}</button>
      </div>
      <textarea id="feedback" rows="2" placeholder="${t("viewer.feedback")}"></textarea>
      <button class="btn primary" data-redraw="${a.id}">${t("batch.redraw")}</button>
    </div>
    ${SECTIONS.map((s) => s.html(a)).join("")}
    <div class="actions">
      <a class="btn primary" href="${fileUrl(a.file)}" download="${esc(a.name)}.${a.file.split(".").pop()}">${t("viewer.download")}</a>
      <button class="btn ghost" data-variant="${a.id}">${t("viewer.continueFrom")}</button>
      <button class="btn ghost danger" data-del-asset="${a.id}" title="${t("viewer.deleteTitle")}">${t("batch.delete")}</button>
    </div>
    <p class="muted shortcuts"><kbd>←</kbd> <kbd>→</kbd> ${t("viewer.keyStep")} · <kbd>A</kbd> ${t("keys.approve")} · <kbd>R</kbd> ${t("keys.reject")} · <kbd>[</kbd> <kbd>]</kbd> ${t("viewer.keyVersion")} · <kbd>Esc</kbd> ${t("viewer.keyClose")} · <kbd>?</kbd> ${t("viewer.keyAll")}</p>`;
  $("#viewer").showModal();
  for (const s of SECTIONS) s.load?.(a);
  showSize(a);
}

const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Pixel size (and per-frame size for sprite sheets) plus file size, to judge export weight. */
async function showSize(a) {
  const img = $("#viewerImg");
  if (!img.complete || !img.naturalWidth) await new Promise((r) => img.addEventListener("load", r, { once: true }));
  const el = $("#viewerMeta .file-size");
  if (!el?.isConnected || state.viewing !== a.id) return;
  const { naturalWidth: w, naturalHeight: h } = img;
  const frameCount = a.frames?.length;
  const parts = [`${w}×${h} px`];
  if (frameCount) parts.push(t("viewer.perFrame", { size: `${Math.floor(w / frameCount)}×${h}` }));
  try {
    const res = await fetch(fileUrl(a.file), { method: "HEAD" });
    const bytes = Number(res.headers.get("content-length"));
    if (bytes) parts.push(fmtBytes(bytes));
  } catch {}
  if (el.isConnected && state.viewing === a.id) el.textContent = parts.join(" · ");
}

/** Set a verdict for the asset in the viewer (keeps any feedback typed so far as the note). */
async function setVerdict(id, verdict) {
  const notes = $("#feedback")?.value.trim();
  const asset = await api(`/api/projects/${state.project.id}/assets/${id}`, {
    method: "PATCH",
    body: notes ? { status: verdict, notes } : { status: verdict },
  });
  upsertAsset(asset);
  openViewer(asset.id);
  toast(t(verdict === "approved" ? "viewer.markedApproved" : "viewer.markedRejected"));
}

/** Step to the previous / next asset in the library's current order and filters. */
function step(delta) {
  const list = visibleAssets();
  const next = list[list.findIndex((a) => a.id === state.viewing) + delta];
  if (next) openViewer(next.id);
}

function bindShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (!$("#viewer").open || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
    const key = e.key.toLowerCase();
    if (key === "arrowleft") step(-1);
    else if (key === "arrowright") step(1);
    else if (key === "[" || key === "]") {
      // Older / newer version of the same asset (its versions and colour variants, by time).
      const a = state.project.assets.find((x) => x.id === state.viewing);
      const other = a && history.stepVersion(a, key === "]" ? 1 : -1);
      if (other) openViewer(other.id);
      else toast(t(key === "]" ? "viewer.newest" : "viewer.oldest"));
    }
    else if (key === "+" || key === "=") zoomBy(1);
    else if (key === "-") zoomBy(-1);
    else if (key === "0") setZoom(0);
    else if (key === "g") toggleGrid();
    else if (key === "," || key === ".") {
      if (!sprite.stepFrame(key === "," ? -1 : 1)) return;
    }
    else if (key === "a") setVerdict(state.viewing, "approved").catch((err) => toast(err.message));
    else if (key === "r") setVerdict(state.viewing, "rejected").catch((err) => toast(err.message));
    else return;
    e.preventDefault();
  });
}

/** Actions in the header, review box and footer. */
function bindCore(root) {
  root.addEventListener("click", async (e) => {
    const ds = e.target.dataset ?? {};
    if (ds.open) return openViewer(ds.open);
    if (ds.editTags) {
      const a = state.project.assets.find((x) => x.id === ds.editTags);
      const input = prompt(t("viewer.tagsPrompt"), (a?.tags ?? []).join(", "));
      if (input === null) return;
      try {
        const tags = input.split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean);
        const asset = await api(`/api/projects/${state.project.id}/assets/${ds.editTags}`, { method: "PATCH", body: { tags } });
        upsertAsset(asset);
        openViewer(asset.id);
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    if (ds.rename) {
      const a = state.project.assets.find((x) => x.id === ds.rename);
      const name = prompt(t("viewer.namePrompt"), a?.name ?? "");
      if (!name?.trim() || name.trim() === a?.name) return;
      try {
        const asset = await api(`/api/projects/${state.project.id}/assets/${ds.rename}`, { method: "PATCH", body: { name } });
        upsertAsset(asset);
        openViewer(asset.id);
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    if (ds.compare) {
      const [beforeId, afterId] = ds.compare.split(":");
      return openCompare(beforeId, afterId);
    }
    if (ds.verdict) return setVerdict(state.viewing, ds.verdict).catch((err) => toast(err.message));
    if (ds.redraw) {
      if (state.job) return toast(t("viewer.busy"));
      const feedback = $("#feedback").value.trim();
      if (!feedback) return toast(t("viewer.feedbackFirst"));
      $("#viewer").close();
      return run("", [{ assetId: ds.redraw, feedback }]);
    }
    if (ds.delAsset) {
      state.project = await api(`/api/projects/${state.project.id}/assets/${ds.delAsset}`, { method: "DELETE" });
      $("#viewer").close();
      renderAssets();
      toast(t("viewer.trashed", { n: state.config.trashDays ?? 7 }));
    } else if (ds.variant) {
      const a = state.project.assets.find((x) => x.id === ds.variant);
      $("#viewer").close();
      $("#request").value = t("viewer.continuePrompt", { id: a.id, name: a.name });
      $("#request").focus();
    }
  });
}

export function bindViewer() {
  bindZoom();
  const root = $("#viewerMeta");
  /** What sections call after changing an asset: update the library and show the result. */
  const ctx = {
    show(asset, message) {
      upsertAsset(asset);
      openViewer(asset.id);
      if (message) toast(message);
    },
    reopen: () => openViewer(state.viewing),
  };
  bindShortcuts();
  bindCompare();
  $("#viewer").addEventListener("close", closeCompare);
  bindCore(root);
  for (const s of SECTIONS) s.bind?.(root, ctx);
}
