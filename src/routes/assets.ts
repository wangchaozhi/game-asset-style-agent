import { Router } from "express";
import multer from "multer";
import { isAssetType } from "../domain/assetTypes.js";
import { toPng } from "../image/io.js";
import { setNineSlice, sliceAssetFrames } from "../ops/assetOps.js";
import { analyzePalette } from "../image/palette.js";
import { loadProject, moveToTrash, newId, removeAssetFiles, restoreFromTrash, takeForPurge, updateProject, writeProjectFile } from "../store/index.js";
import type { Asset } from "../store/types.js";
import { hasTag, normalizeTags } from "../domain/tags.js";
import { replaceableVersions } from "../domain/versions.js";
import { findAsset, pid } from "./util.js";

// Asset library routes: review and edits, batch actions, trash, import, version cleanup.
export const assetsRouter = Router();

const STATUSES = ["approved", "rejected", "pending_review"];

const REVIEW_ACTIONS = { approve: "approved", reject: "rejected", pending: "pending_review" } as const;
const BATCH_ACTIONS = ["approve", "reject", "pending", "delete", "restore", "purge", "tag", "untag", "rename"] as const;
type BatchAction = (typeof BATCH_ACTIONS)[number];

/**
 * Apply one action to many assets: approve / reject / pending (review), delete (to the trash),
 * restore (from the trash), purge (permanently, from the library or the trash),
 * tag / untag (add or remove `tags`), rename (`prefix` + number from `start`, in the given order).
 */
assetsRouter.post("/api/projects/:id/assets/batch", async (req, res) => {
  const action = req.body?.action as BatchAction;
  const ids: unknown = req.body?.ids;
  if (!BATCH_ACTIONS.includes(action)) return void res.status(400).json({ error: "无效的批量操作" });
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || !ids.every((x) => typeof x === "string")) {
    return void res.status(400).json({ error: "请提供要操作的素材 id 列表" });
  }
  const wanted = new Set(ids as string[]);
  const tags = normalizeTags(req.body?.tags);
  if ((action === "tag" || action === "untag") && !tags.length) return void res.status(400).json({ error: "请提供标签" });
  const prefix = typeof req.body?.prefix === "string" ? req.body.prefix.trim().slice(0, 60) : "";
  if (action === "rename" && !prefix) return void res.status(400).json({ error: "请提供名称前缀" });
  const start = req.body?.start === undefined ? 1 : Number(req.body.start);
  if (action === "rename" && !(Number.isInteger(start) && start >= 0 && start <= 9999)) return void res.status(400).json({ error: "起始序号需为 0-9999 的整数" });
  let affected = 0;
  let purged: string[] = [];
  const project = await updateProject(pid(req), (p) => {
    if (action === "delete") affected = moveToTrash(p, wanted);
    else if (action === "restore") affected = restoreFromTrash(p, wanted);
    else if (action === "purge") affected = (purged = takeForPurge(p, wanted)).length;
    else if (action === "rename") {
      // Numbered in the order the ids were given (the library's order), zero-padded to the widest number.
      const order = (ids as string[]).filter((id, i, all) => all.indexOf(id) === i);
      const width = Math.max(2, String(start + order.length - 1).length);
      let n = start;
      for (const id of order) {
        const a = p.assets.find((x) => x.id === id);
        if (!a) continue;
        a.name = `${prefix}${String(n++).padStart(width, "0")}`;
        affected++;
      }
    } else if (action === "tag" || action === "untag") {
      for (const a of p.assets) {
        if (!wanted.has(a.id)) continue;
        const next =
          action === "tag" ? normalizeTags([...(a.tags ?? []), ...tags]) : (a.tags ?? []).filter((t) => !hasTag(tags, t));
        if (next.length) a.tags = next;
        else delete a.tags;
        affected++;
      }
    } else {
      for (const a of p.assets) {
        if (!wanted.has(a.id)) continue;
        a.status = REVIEW_ACTIONS[action as keyof typeof REVIEW_ACTIONS];
        a.reviewer = "user";
        affected++;
      }
    }
  });
  if (purged.length) await removeAssetFiles(project.id, purged);
  res.json({ affected, project });
});

/** Empty the trash: permanently delete everything in it. */
assetsRouter.post("/api/projects/:id/trash/empty", async (req, res) => {
  let purged: string[] = [];
  const project = await updateProject(pid(req), (p) => void (purged = takeForPurge(p, new Set((p.trash ?? []).map((a) => a.id)))));
  if (purged.length) await removeAssetFiles(project.id, purged);
  res.json({ affected: purged.length, project });
});

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(png|jpeg|webp|gif)$/.test(file.mimetype)),
});

/** Multipart file names arrive as latin1; re-read them as UTF-8 (Chinese names stay readable). */
const fileName = (raw: string) => {
  const utf8 = Buffer.from(raw, "latin1").toString("utf8");
  const name = (utf8.includes("\uFFFD") ? raw : utf8).replace(/\.[a-z0-9]+$/i, "").trim();
  return name.slice(0, 80) || "导入的素材";
};

/**
 * Import the user's own images as assets (multipart "images", up to 20; fields: assetType, frames for sprite sheets).
 * They count as approved by the user, so every post-process and export applies to them.
 */
assetsRouter.post("/api/projects/:id/assets/import", importUpload.array("images", 20), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const assetType = String(req.body?.assetType ?? "");
  if (!isAssetType(assetType)) return void res.status(400).json({ error: "请选择素材类型" });
  if (!files.length) return void res.status(400).json({ error: "没有可用的图片（支持 png/jpg/webp/gif）" });
  const frames = req.body?.frames ? Number(req.body.frames) : undefined;
  if (frames !== undefined && !(Number.isInteger(frames) && frames >= 1 && frames <= 32)) return void res.status(400).json({ error: "帧数需在 1-32 之间" });
  const project = await loadProject(pid(req));
  const hexes = project.styleGuide?.palette.map((p) => p.hex) ?? [];
  const created: Asset[] = [];
  for (const f of files) {
    const id = newId("ast");
    const file = `assets/${id}.png`;
    const png = await toPng(f.buffer);
    await writeProjectFile(project.id, file, png);
    const asset: Asset = {
      id,
      name: fileName(f.originalname),
      assetType,
      prompt: "",
      file,
      mime: "image/png",
      status: "approved",
      reviewer: "user",
      notes: "导入的素材",
      runId: "import",
      provider: "import",
      createdAt: new Date().toISOString(),
    };
    if (assetType === "sprite_sheet") Object.assign(asset, await sliceAssetFrames(project.id, asset, png, frames));
    if (hexes.length) {
      const r = await analyzePalette(png, hexes);
      asset.palette = { coverage: r.coverage, meanDeltaE: r.meanDeltaE, offPalette: r.offPalette };
    }
    created.push(asset);
  }
  const p = await updateProject(project.id, (p) => void p.assets.push(...created));
  res.json({ imported: created.map((a) => a.id), project: p });
});

/**
 * Move old versions that have an approved newer version to the trash (restorable). ?dryRun=1 only
 * reports which ones; returns { ids, affected, project? }.
 */
assetsRouter.post("/api/projects/:id/cleanup-versions", async (req, res) => {
  if (req.query.dryRun) {
    const ids = replaceableVersions((await loadProject(pid(req))).assets);
    return void res.json({ ids, affected: 0 });
  }
  let ids: string[] = [];
  let affected = 0;
  const project = await updateProject(pid(req), (p) => {
    ids = replaceableVersions(p.assets);
    affected = moveToTrash(p, new Set(ids));
  });
  res.json({ ids, affected, project });
});

/** Manual review and edits: any of status, notes, name, tags, nineSlice (ui only; null clears). */
assetsRouter.patch("/api/projects/:id/assets/:assetId", async (req, res) => {
  const { status, notes, name, tags, nineSlice } = req.body ?? {};
  if (status !== undefined && !STATUSES.includes(status)) return void res.status(400).json({ error: "无效的状态" });
  if (name !== undefined && (typeof name !== "string" || !name.trim())) return void res.status(400).json({ error: "名称不能为空" });
  if (tags !== undefined && !Array.isArray(tags)) return void res.status(400).json({ error: "tags 需为字符串数组" });
  if (status === undefined && name === undefined && tags === undefined && nineSlice === undefined && typeof notes !== "string") {
    return void res.status(400).json({ error: "没有要修改的内容" });
  }
  if (nineSlice !== undefined) {
    const found = await findAsset(req, res);
    if (!found) return;
    const r = await setNineSlice(found.project, found.asset, nineSlice);
    if (typeof r === "string") return void res.status(400).json({ error: r });
  }
  let asset: Asset | undefined;
  await updateProject(pid(req), (p) => {
    asset = p.assets.find((a) => a.id === req.params.assetId);
    if (!asset) return;
    if (status !== undefined) {
      asset.status = status;
      asset.reviewer = "user";
    }
    if (typeof notes === "string") {
      asset.notes = notes.slice(0, 2000);
      asset.reviewer = "user";
    }
    if (typeof name === "string") asset.name = name.trim().slice(0, 80);
    if (tags !== undefined) {
      const clean = normalizeTags(tags);
      if (clean.length) asset.tags = clean;
      else delete asset.tags;
    }
  });
  if (!asset) return void res.status(404).json({ error: "素材不存在" });
  res.json(asset);
});

/** Move an asset to the trash; ?permanent=1 deletes it and its files right away. */
assetsRouter.delete("/api/projects/:id/assets/:assetId", async (req, res) => {
  const ids = new Set([String(req.params.assetId)]);
  let purged: string[] = [];
  const project = await updateProject(pid(req), (p) => {
    if (req.query.permanent) purged = takeForPurge(p, ids);
    else moveToTrash(p, ids);
  });
  if (purged.length) await removeAssetFiles(project.id, purged);
  res.json(project);
});
