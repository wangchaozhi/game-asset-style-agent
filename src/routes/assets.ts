import { Router } from "express";
import {
  alignedVersion, cutoutAsset, jitterOf, paletteSnapVersion, parseAlignMode, seamlessVersion, seamsOf, sliceAssetFrames,
} from "../ops/assetOps.js";
import { analyzePalette } from "../image/palette.js";
import { isPixelArt, parseSize, resizeAsset } from "../image/sizes.js";
import { tilePreview } from "../image/tiles.js";
import { moveToTrash, readProjectFile, removeAssetFiles, restoreFromTrash, takeForPurge, updateProject } from "../store/index.js";
import type { Asset } from "../store/types.js";
import { hasTag, normalizeTags } from "../domain/tags.js";
import { type NineSlice, parseNineSlice } from "../domain/nineSlice.js";
import { imageSize } from "../image/io.js";
import { detectNineSlice } from "../image/nineSlice.js";
import { attachment, findAsset, pid } from "./util.js";

export const assetsRouter = Router();

const STATUSES = ["approved", "rejected", "pending_review"];

const REVIEW_ACTIONS = { approve: "approved", reject: "rejected", pending: "pending_review" } as const;
const BATCH_ACTIONS = ["approve", "reject", "pending", "delete", "restore", "purge", "tag", "untag"] as const;
type BatchAction = (typeof BATCH_ACTIONS)[number];

/**
 * Apply one action to many assets: approve / reject / pending (review), delete (to the trash),
 * restore (from the trash), purge (permanently, from the library or the trash),
 * tag / untag (add or remove `tags`).
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
  let affected = 0;
  let purged: string[] = [];
  const project = await updateProject(pid(req), (p) => {
    if (action === "delete") affected = moveToTrash(p, wanted);
    else if (action === "restore") affected = restoreFromTrash(p, wanted);
    else if (action === "purge") affected = (purged = takeForPurge(p, wanted)).length;
    else if (action === "tag" || action === "untag") {
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

/** Manual review and edits: any of status, notes, name, tags, nineSlice (ui only; null clears). */
assetsRouter.patch("/api/projects/:id/assets/:assetId", async (req, res) => {
  const { status, notes, name, tags, nineSlice } = req.body ?? {};
  if (status !== undefined && !STATUSES.includes(status)) return void res.status(400).json({ error: "无效的状态" });
  if (name !== undefined && (typeof name !== "string" || !name.trim())) return void res.status(400).json({ error: "名称不能为空" });
  if (tags !== undefined && !Array.isArray(tags)) return void res.status(400).json({ error: "tags 需为字符串数组" });
  if (status === undefined && name === undefined && tags === undefined && nineSlice === undefined && typeof notes !== "string") {
    return void res.status(400).json({ error: "没有要修改的内容" });
  }
  let slice: NineSlice | null | undefined;
  if (nineSlice !== undefined) {
    const found = await findAsset(req, res);
    if (!found) return;
    if (found.asset.assetType !== "ui") return void res.status(400).json({ error: "只有 UI 素材可以设置九宫格" });
    if (nineSlice !== null) {
      const { width, height } = await imageSize(await readProjectFile(found.project.id, found.asset.file));
      const parsed = parseNineSlice(nineSlice, width, height);
      if (typeof parsed === "string") return void res.status(400).json({ error: parsed });
      slice = parsed;
    } else slice = null;
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
    if (slice) asset.nineSlice = slice;
    else if (slice === null) delete asset.nineSlice;
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
  res.json(await cutoutAsset(found.project, found.asset, { tolerance: req.body?.tolerance, restore: !!req.body?.restore }));
});

assetsRouter.get("/api/projects/:id/assets/:assetId/seams", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  res.json(await seamsOf(found.project, found.asset));
});

/** Suggested 9-slice margins for a UI asset (null when no stretchable band is found). */
assetsRouter.get("/api/projects/:id/assets/:assetId/nine-slice", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  if (found.asset.assetType !== "ui") return void res.status(400).json({ error: "只有 UI 素材可以设置九宫格" });
  res.json({ suggestion: await detectNineSlice(await readProjectFile(found.project.id, found.asset.file)) });
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
  const overlap = Number(req.body?.overlap ?? 0.15);
  if (!(overlap >= 0.04 && overlap <= 0.4)) return void res.status(400).json({ error: "融合比例需在 0.04-0.4 之间" });
  res.json((await seamlessVersion(found.project, found.asset, overlap, { by: "user" })).asset);
});

/** How much the content wanders between frames (px). */
assetsRouter.get("/api/projects/:id/assets/:assetId/jitter", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  if (found.asset.assetType !== "sprite_sheet") return void res.status(400).json({ error: "只有精灵表可以检测帧抖动" });
  res.json(await jitterOf(found.project, found.asset, parseAlignMode(req.query.mode)));
});

/** Align frames on a shared anchor; the result is a new version linked to the original. */
assetsRouter.post("/api/projects/:id/assets/:assetId/align-frames", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  if (found.asset.assetType !== "sprite_sheet") return void res.status(400).json({ error: "只有精灵表可以对齐帧" });
  res.json(await alignedVersion(found.project, found.asset, parseAlignMode(req.body?.mode), { by: "user" }));
});

/** Snap colours to the style palette; the result is a new version. Body: { dither: "none" | "ordered" }. */
assetsRouter.post("/api/projects/:id/assets/:assetId/snap-palette", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  if (!found.project.styleGuide?.palette.length) return void res.status(400).json({ error: "项目还没有风格指南色板" });
  const dither = req.body?.dither === "ordered" ? "ordered" : "none";
  res.json(await paletteSnapVersion(found.project, found.asset, dither, { by: "user" }));
});
