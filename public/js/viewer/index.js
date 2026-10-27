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

/** Rendered in this order below the review box; each may render nothing for a given asset. */
const SECTIONS = [actionSet, sprite, tile, nineSlice, palette, sizes, cutout, outline, recolor, promptSection, history];

function versionLinks(a) {
  const parent = a.parentId && state.project.assets.find((x) => x.id === a.parentId);
  const children = state.project.assets.filter((x) => x.parentId === a.id);
  const original = a.variantOf && state.project.assets.find((x) => x.id === a.variantOf);
  const variants = state.project.assets.filter((x) => x.variantOf === a.id);
  if (!parent && !children.length && !original && !variants.length) return "";
  return `<div class="versions">${parent ? `<button class="btn link" data-open="${parent.id}">← 上一版本</button>` : ""}
    ${children.map((c, i) => `<button class="btn link" data-open="${c.id}">新版本 ${i + 1} →</button>`).join("")}
    ${original ? `<button class="btn link" data-open="${original.id}">← 原素材</button>` : ""}
    ${variants.map((v) => `<button class="btn link" data-open="${v.id}">变体：${esc(v.name)}</button>`).join("")}
    ${parent ? `<button class="btn link" data-compare="${parent.id}:${a.id}">对比上一版本</button>` : ""}</div>`;
}

export function openViewer(id) {
  const a = state.project.assets.find((x) => x.id === id);
  if (!a) return;
  $("#viewerImg").src = fileUrl(a.file);
  state.viewing = id;
  closeCompare();
  $("#viewerMeta").innerHTML = `
    <h3 class="viewer-title">${esc(a.name)} <button class="btn link rename" data-rename="${a.id}" title="改名" aria-label="改名">✎</button></h3>
    <div class="muted">${esc(state.config.assetTypes[a.assetType] ?? a.assetType)} · ${esc(a.provider)} · ${new Date(a.createdAt).toLocaleString()}</div>
    <div class="muted file-size" aria-live="polite"></div>
    ${a.notes ? `<div><b>${a.reviewer === "user" ? "我的意见" : "Agent 审核"}：</b>${esc(a.notes)}${a.score && a.reviewer !== "user" ? `（一致性 ${a.score}/10）` : ""}</div>` : ""}
    <div class="viewer-tags">${(a.tags ?? []).map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}
      <button class="btn link" data-edit-tags="${a.id}">${a.tags?.length ? "编辑标签" : "+ 标签"}</button></div>
    ${versionLinks(a)}
    <div class="review">
      <div class="verdict">
        <button class="btn ghost ${a.status === "approved" ? "on-ok" : ""}" data-verdict="approved">✓ 通过</button>
        <button class="btn ghost ${a.status === "rejected" ? "on-bad" : ""}" data-verdict="rejected">✗ 驳回</button>
      </div>
      <textarea id="feedback" rows="2" placeholder="修改意见，例如：剑身改成蓝色，描边再粗一点"></textarea>
      <button class="btn primary" data-redraw="${a.id}">按意见重画</button>
    </div>
    ${SECTIONS.map((s) => s.html(a)).join("")}
    <div class="actions">
      <a class="btn primary" href="${fileUrl(a.file)}" download="${esc(a.name)}.${a.file.split(".").pop()}">下载</a>
      <button class="btn ghost" data-variant="${a.id}">基于此图继续生成</button>
      <button class="btn ghost danger" data-del-asset="${a.id}" title="移到回收站">删除</button>
    </div>
    <p class="muted shortcuts"><kbd>←</kbd> <kbd>→</kbd> 切换 · <kbd>A</kbd> 通过 · <kbd>R</kbd> 驳回 · <kbd>Esc</kbd> 关闭</p>`;
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
  if (frameCount) parts.push(`每帧 ${Math.floor(w / frameCount)}×${h}`);
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
  toast(verdict === "approved" ? "已标记为通过" : "已标记为驳回");
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
      const input = prompt("标签（多个用逗号或空格分隔，留空清除）", (a?.tags ?? []).join(", "));
      if (input === null) return;
      try {
        const tags = input.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean);
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
      const name = prompt("素材名称", a?.name ?? "");
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
      if (state.job) return toast("已有任务在运行，请稍候");
      const feedback = $("#feedback").value.trim();
      if (!feedback) return toast("请先写下修改意见");
      $("#viewer").close();
      return run("", [{ assetId: ds.redraw, feedback }]);
    }
    if (ds.delAsset) {
      state.project = await api(`/api/projects/${state.project.id}/assets/${ds.delAsset}`, { method: "DELETE" });
      $("#viewer").close();
      renderAssets();
      toast(`已移到回收站，${state.config.trashDays ?? 7} 天内可恢复`);
    } else if (ds.variant) {
      const a = state.project.assets.find((x) => x.id === ds.variant);
      $("#viewer").close();
      $("#request").value = `以素材 ${a.id}（${a.name}）为一致性参考，`;
      $("#request").focus();
    }
  });
}

export function bindViewer() {
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
