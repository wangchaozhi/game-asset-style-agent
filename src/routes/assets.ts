import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { sliceAssetFrames } from "../agent/assets.js";
import { removeBackground } from "../image/background.js";
import { analyzePalette } from "../image/palette.js";
import { isPixelArt, parseSize, resizeAsset } from "../image/sizes.js";
import { analyzeSeams, makeSeamless, tilePreview } from "../image/tiles.js";
import { type AlignMode, alignFrames, joinFrames, measureJitter, sliceSheet } from "../image/spriteSheet.js";
import {
  moveToTrash, newId, projectDir, readProjectFile, removeAssetFiles, restoreFromTrash, takeForPurge, updateProject, writeProjectFile,
} from "../store/index.js";
import type { Asset } from "../store/types.js";
import { attachment, findAsset, pid } from "./util.js";

export const assetsRouter = Router();

const STATUSES = ["approved", "rejected", "pending_review"];

const REVIEW_ACTIONS = { approve: "approved", reject: "rejected", pending: "pending_review" } as const;
const BATCH_ACTIONS = ["approve", "reject", "pending", "delete", "restore", "purge"] as const;
type BatchAction = (typeof BATCH_ACTIONS)[number];

/**
 * Apply one action to many assets: approve / reject / pending (review), delete (to the trash),
 * restore (from the trash), purge (permanently, from the library or the trash).
 */
assetsRouter.post("/api/projects/:id/assets/batch", async (req, res) => {
  const action = req.body?.action as BatchAction;
  const ids: unknown = req.body?.ids;
  if (!BATCH_ACTIONS.includes(action)) return void res.status(400).json({ error: "无效的批量操作" });
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || !ids.every((x) => typeof x === "string")) {
    return void res.status(400).json({ error: "请提供要操作的素材 id 列表" });
  }
  const wanted = new Set(ids as string[]);
  let affected = 0;
  let purged: string[] = [];
  const project = await updateProject(pid(req), (p) => {
    if (action === "delete") affected = moveToTrash(p, wanted);
    else if (action === "restore") affected = restoreFromTrash(p, wanted);
    else if (action === "purge") affected = (purged = takeForPurge(p, wanted)).length;
    else {
      for (const a of p.assets) {
        if (!wanted.has(a.id)) continue;
        a.status = REVIEW_ACTIONS[action];
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

/** Manual review: set status and optional notes. */
assetsRouter.patch("/api/projects/:id/assets/:assetId", async (req, res) => {
  const status = req.body?.status;
  if (!STATUSES.includes(status)) return void res.status(400).json({ error: "无效的状态" });
  let asset: Asset | undefined;
  await updateProject(pid(req), (p) => {
    asset = p.assets.find((a) => a.id === req.params.assetId);
    if (!asset) return;
    asset.status = status;
    asset.reviewer = "user";
    if (typeof req.body?.notes === "string") asset.notes = req.body.notes.slice(0, 2000);
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

/** Re-slice a sprite sheet with a given frame count / fps. */
assetsRouter.post("/api/projects/:id/assets/:assetId/slice", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  const { project, asset } = found;
  const frames = req.body?.frames ? Number(req.body.frames) : undefined;
  const fps = req.body?.fps ? Number(req.body.fps) : 8;
  if (frames !== undefined && !(frames >= 1 && frames <= 32)) return void res.status(400).json({ error: "帧数需在 1-32 之间" });
  const sliced = await sliceAssetFrames(project.id, asset, await readProjectFile(project.id, asset.file), frames, fps);
  const p = await updateProject(project.id, (p) => {
    const a = p.assets.find((x) => x.id === asset.id);
    if (a) Object.assign(a, sliced);
  });
  res.json(p.assets.find((a) => a.id === asset.id));
});

/** Cut out (or restore) the background; the untouched model output is kept as originalFile. */
assetsRouter.post("/api/projects/:id/assets/:assetId/cutout", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  const { project, asset } = found;
  const tolerance = Math.max(1, Math.min(120, Number(req.body?.tolerance ?? 28)));
  const restore = !!req.body?.restore;
  const originalFile = asset.originalFile ?? `assets/${asset.id}_orig.${asset.file.split(".").pop()}`;
  if (!asset.originalFile) await writeProjectFile(project.id, originalFile, await readProjectFile(project.id, asset.file));
  let file = originalFile;
  if (!restore) {
    file = `assets/${asset.id}_cut${Date.now().toString(36)}.png`;
    await writeProjectFile(project.id, file, await removeBackground(await readProjectFile(project.id, originalFile), tolerance));
  }
  const sliced = asset.frames?.length
    ? await sliceAssetFrames(project.id, asset, await readProjectFile(project.id, file), asset.frames.length, asset.fps)
    : {};
  const p = await updateProject(project.id, (p) => {
    const a = p.assets.find((x) => x.id === asset.id);
    if (a) Object.assign(a, { originalFile, file, mime: restore ? asset.mime : "image/png" }, sliced);
  });
  // The previous cut-out is superseded; never touch the original model output.
  if (asset.file !== originalFile && asset.file !== file && /_cut[0-9a-z]+\.png$/.test(asset.file)) {
    await fs.rm(path.join(projectDir(project.id), asset.file), { force: true });
  }
  res.json(p.assets.find((a) => a.id === asset.id));
});

assetsRouter.get("/api/projects/:id/assets/:assetId/seams", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  res.json(await analyzeSeams(await readProjectFile(found.project.id, found.asset.file)));
});

assetsRouter.get("/api/projects/:id/assets/:assetId/tiled.png", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  const n = Number(req.query.n ?? 3);
  if (!Number.isInteger(n) || n < 2 || n > 6) return void res.status(400).json({ error: "平铺数需为 2-6 的整数" });
  res.setHeader("Content-Type", "image/png");
  res.send(await tilePreview(await readProjectFile(found.project.id, found.asset.file), n));
});

assetsRouter.get("/api/projects/:id/assets/:assetId/sized.png", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  const { project, asset } = found;
  const size = parseSize(String(req.query.size ?? ""));
  if (!size) return void res.status(400).json({ error: "尺寸格式应为 32 或 1280x720（8–4096）" });
  const pixel = req.query.kernel ? req.query.kernel === "nearest" : isPixelArt(project.styleGuide);
  const png = await resizeAsset(await readProjectFile(project.id, asset.file), {
    ...size, assetType: asset.assetType, pixel, frames: asset.frames?.length,
  });
  res.setHeader("Content-Type", "image/png");
  if (req.query.download) res.setHeader("Content-Disposition", attachment("asset.png", `${asset.name}@${req.query.size}.png`));
  res.send(png);
});

/** Fresh palette check against the current style guide (it may have been edited since generation). */
assetsRouter.get("/api/projects/:id/assets/:assetId/palette", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  const palette = found.project.styleGuide?.palette.map((p) => p.hex) ?? [];
  if (!palette.length) return void res.status(400).json({ error: "项目还没有风格指南色板" });
  const threshold = Math.max(2, Math.min(60, Number(req.query.threshold ?? 20)));
  res.json(await analyzePalette(await readProjectFile(found.project.id, found.asset.file), palette, { threshold }));
});

/** Make a tile seamless. The result is a new version (pending review) linked to the original. */
assetsRouter.post("/api/projects/:id/assets/:assetId/make-seamless", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  const { project, asset } = found;
  const overlap = Number(req.body?.overlap ?? 0.15);
  if (!(overlap >= 0.04 && overlap <= 0.4)) return void res.status(400).json({ error: "融合比例需在 0.04-0.4 之间" });
  const png = await makeSeamless(await readProjectFile(project.id, asset.file), { overlap, pixel: isPixelArt(project.styleGuide) });
  const id = newId("ast");
  const file = `assets/${id}.png`;
  await writeProjectFile(project.id, file, png);
  const created: Asset = {
    id,
    name: asset.name,
    assetType: asset.assetType,
    prompt: asset.prompt,
    file,
    mime: "image/png",
    status: "pending_review",
    notes: `由「${asset.name}」无缝化处理（边缘融合 ${Math.round(overlap * 100)}%）`,
    reviewer: "user",
    runId: asset.runId,
    provider: "postprocess",
    createdAt: new Date().toISOString(),
    parentId: asset.id,
  };
  await updateProject(project.id, (p) => void p.assets.push(created));
  res.json(created);
});

/** Frames of a sprite sheet: the sliced files if present, else an equal split (default 4). */
async function sheetFrames(projectId: string, asset: Asset): Promise<Buffer[]> {
  if (asset.frames?.length) return Promise.all(asset.frames.map((f) => readProjectFile(projectId, f)));
  return (await sliceSheet(await readProjectFile(projectId, asset.file), 4)).frames;
}

const alignMode = (v: unknown): AlignMode => (v === "center" ? "center" : "bottom");

/** How much the content wanders between frames (px). */
assetsRouter.get("/api/projects/:id/assets/:assetId/jitter", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  if (found.asset.assetType !== "sprite_sheet") return void res.status(400).json({ error: "只有精灵表可以检测帧抖动" });
  res.json(await measureJitter(await sheetFrames(found.project.id, found.asset), alignMode(req.query.mode)));
});

/** Align frames on a shared anchor; the result is a new version linked to the original. */
assetsRouter.post("/api/projects/:id/assets/:assetId/align-frames", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  const { project, asset } = found;
  if (asset.assetType !== "sprite_sheet") return void res.status(400).json({ error: "只有精灵表可以对齐帧" });
  const mode = alignMode(req.body?.mode);
  const frames = await sheetFrames(project.id, asset);
  const before = await measureJitter(frames, mode);
  const aligned = await alignFrames(frames, mode);
  const after = await measureJitter(aligned, mode);
  const id = newId("ast");
  const file = `assets/${id}.png`;
  await writeProjectFile(project.id, file, await joinFrames(aligned));
  const created: Asset = {
    id,
    name: asset.name,
    assetType: asset.assetType,
    prompt: asset.prompt,
    file,
    mime: "image/png",
    status: "pending_review",
    notes: `由「${asset.name}」对齐帧（${mode === "bottom" ? "底边居中" : "中心"}）：水平抖动 ${before.horizontal}→${after.horizontal}px，${mode === "bottom" ? "底边" : "垂直"} ${before.vertical}→${after.vertical}px`,
    reviewer: "user",
    runId: asset.runId,
    provider: "postprocess",
    createdAt: new Date().toISOString(),
    parentId: asset.id,
  };
  Object.assign(created, await sliceAssetFrames(project.id, created, await readProjectFile(project.id, file), aligned.length, asset.fps ?? 8));
  await updateProject(project.id, (p) => void p.assets.push(created));
  res.json({ asset: created, before, after });
});
