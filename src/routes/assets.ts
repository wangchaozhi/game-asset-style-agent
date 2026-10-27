import { Router } from "express";
import multer from "multer";
import { isAssetType, isOpaqueType } from "../domain/assetTypes.js";
import { toPng } from "../image/io.js";
import {
  alignedVersion, cutoutAsset, jitterOf, paletteSnapVersion, parseAlignMode, seamlessVersion, outlineVersion, recolorVariant, seamsOf, setNineSlice, sliceAssetFrames,
} from "../ops/assetOps.js";
import { analyzePalette } from "../image/palette.js";
import { isPixelArt, parseSize, resizeAsset } from "../image/sizes.js";
import { tilePreview } from "../image/tiles.js";
import { loadProject, moveToTrash, newId, readProjectFile, removeAssetFiles, restoreFromTrash, takeForPurge, updateProject, writeProjectFile } from "../store/index.js";
import type { Asset } from "../store/types.js";
import { hasTag, normalizeTags } from "../domain/tags.js";
import { detectNineSlice } from "../image/nineSlice.js";
import { dominantColors } from "../image/recolor.js";
import { measureConsistency } from "../ops/consistency.js";
import { attachment, findAsset, pid } from "./util.js";

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

/** At most this many assets per batch post-process request. */
const MAX_BATCH_PROCESS = 30;

/**
 * Post-process many assets at once: { op: "outline" | "cutout" | "snap", ids, …the op's options }.
 * Assets the op doesn't apply to are skipped with a reason; outline and snap make new versions, cutout works in place.
 */
assetsRouter.post("/api/projects/:id/assets/batch-process", async (req, res) => {
  const { op, ids } = req.body ?? {};
  if (!["outline", "cutout", "snap"].includes(op)) return void res.status(400).json({ error: "op 需为 outline / cutout / snap" });
  if (!Array.isArray(ids) || !ids.length) return void res.status(400).json({ error: "请提供要处理的素材 id 列表" });
  if (ids.length > MAX_BATCH_PROCESS) return void res.status(400).json({ error: `一次最多处理 ${MAX_BATCH_PROCESS} 个素材` });
  const project = await loadProject(pid(req));
  if (op === "snap" && !project.styleGuide?.palette.length) return void res.status(400).json({ error: "项目还没有风格指南色板" });
  const done: { id: string; result: string }[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of new Set(ids.map(String))) {
    const asset = project.assets.find((a) => a.id === id);
    if (!asset) {
      skipped.push({ id, reason: "素材不存在" });
      continue;
    }
    if (op === "outline") {
      const r = await outlineVersion(project, asset, { width: Number(req.body.width ?? 2), color: req.body.color }, { by: "user" });
      if (typeof r === "string") skipped.push({ id, reason: r });
      else done.push({ id, result: r.id });
    } else if (op === "cutout") {
      if (isOpaqueType(asset.assetType)) skipped.push({ id, reason: "背景和瓦片铺满画面，不需要去背景" });
      else done.push({ id, result: (await cutoutAsset(project, asset, { tolerance: req.body.tolerance })).id });
    } else {
      const dither = req.body.dither === "ordered" ? "ordered" : "none";
      done.push({ id, result: (await paletteSnapVersion(project, asset, dither, { by: "user" })).asset.id });
    }
  }
  res.json({ done, skipped, project: await loadProject(project.id) });
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

/** Re-slice a sprite sheet with a given frame count / fps. */
assetsRouter.post("/api/projects/:id/assets/:assetId/slice", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  const { project, asset } = found;
  const frames = req.body?.frames ? Number(req.body.frames) : undefined;
  // Without fps the sheet keeps its current rate.
  const fps = req.body?.fps !== undefined ? Number(req.body.fps) : (asset.fps ?? 8);
  if (frames !== undefined && !(frames >= 1 && frames <= 32)) return void res.status(400).json({ error: "帧数需在 1-32 之间" });
  if (!Number.isInteger(fps) || fps < 1 || fps > 30) return void res.status(400).json({ error: "帧率需为 1-30 的整数" });
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

/** Which assets drift furthest from the project's style (see measureConsistency); ?tag= narrows it to one group. */
assetsRouter.get("/api/projects/:id/consistency", async (req, res) => {
  const tag = typeof req.query.tag === "string" && req.query.tag ? req.query.tag : undefined;
  const report = await measureConsistency(await loadProject(pid(req)), { tag });
  if (!report) return void res.status(400).json({ error: "项目还没有风格指南色板" });
  res.json(report);
});

/** The asset's main colours, to pick swap sources from. */
assetsRouter.get("/api/projects/:id/assets/:assetId/colors", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  res.json({ colors: await dominantColors(await readProjectFile(found.project.id, found.asset.file)) });
});

/** Colour-swap variant as a new sibling asset: { swaps: [{ from, to }], threshold?: 5-60, name? }. */
assetsRouter.post("/api/projects/:id/assets/:assetId/recolor", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  const r = await recolorVariant(found.project, found.asset, req.body ?? {}, { by: "user" });
  if (typeof r === "string") return void res.status(400).json({ error: r });
  res.json(r);
});

/** Outer outline as a new version: { width: 1-16, color?: "#rrggbb" } (default colour: darkest palette colour). */
assetsRouter.post("/api/projects/:id/assets/:assetId/outline", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  const { width, color } = req.body ?? {};
  const r = await outlineVersion(found.project, found.asset, { width: Number(width ?? 2), color }, { by: "user" });
  if (typeof r === "string") return void res.status(400).json({ error: r });
  res.json(r);
});

/** Snap colours to the style palette; the result is a new version. Body: { dither: "none" | "ordered" }. */
assetsRouter.post("/api/projects/:id/assets/:assetId/snap-palette", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  if (!found.project.styleGuide?.palette.length) return void res.status(400).json({ error: "项目还没有风格指南色板" });
  const dither = req.body?.dither === "ordered" ? "ordered" : "none";
  res.json(await paletteSnapVersion(found.project, found.asset, dither, { by: "user" }));
});
