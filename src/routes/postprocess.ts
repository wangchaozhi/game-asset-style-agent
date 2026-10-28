import { Router } from "express";
import { isOpaqueType } from "../domain/assetTypes.js";
import { alignedVersion, cutoutAsset, paletteSnapVersion, parseAlignMode, seamlessVersion, outlineVersion, recolorVariant, sliceAssetFrames } from "../ops/assetOps.js";
import { loadProject, readProjectFile, updateProject } from "../store/index.js";
import { findAsset, pid } from "./util.js";
import { msg } from "../i18n.js";

// Post-processing routes: everything that makes or changes an asset image.
export const postprocessRouter = Router();

/** At most this many assets per batch post-process request. */
const MAX_BATCH_PROCESS = 30;

/**
 * Post-process many assets at once: { op: "outline" | "cutout" | "snap", ids, …the op's options }.
 * Assets the op doesn't apply to are skipped with a reason; outline and snap make new versions, cutout works in place.
 */
postprocessRouter.post("/api/projects/:id/assets/batch-process", async (req, res) => {
  const { op, ids } = req.body ?? {};
  if (!["outline", "cutout", "snap"].includes(op)) return void res.status(400).json({ error: msg("err.badOp") });
  if (!Array.isArray(ids) || !ids.length) return void res.status(400).json({ error: msg("err.needIds") });
  if (ids.length > MAX_BATCH_PROCESS) return void res.status(400).json({ error: msg("err.maxBatch", { n: MAX_BATCH_PROCESS }) });
  const project = await loadProject(pid(req));
  if (op === "snap" && !project.styleGuide?.palette.length) return void res.status(400).json({ error: msg("err.noPalette") });
  const done: { id: string; result: string }[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of new Set(ids.map(String))) {
    const asset = project.assets.find((a) => a.id === id);
    if (!asset) {
      skipped.push({ id, reason: msg("skip.missing") });
      continue;
    }
    if (op === "outline") {
      const r = await outlineVersion(project, asset, { width: Number(req.body.width ?? 2), color: req.body.color }, { by: "user" });
      if (typeof r === "string") skipped.push({ id, reason: r });
      else done.push({ id, result: r.id });
    } else if (op === "cutout") {
      if (isOpaqueType(asset.assetType)) skipped.push({ id, reason: msg("skip.opaqueCutout") });
      else done.push({ id, result: (await cutoutAsset(project, asset, { tolerance: req.body.tolerance })).id });
    } else {
      const dither = req.body.dither === "ordered" ? "ordered" : "none";
      done.push({ id, result: (await paletteSnapVersion(project, asset, dither, { by: "user" })).asset.id });
    }
  }
  res.json({ done, skipped, project: await loadProject(project.id) });
});

/** Re-slice a sprite sheet with a given frame count / fps. */
postprocessRouter.post("/api/projects/:id/assets/:assetId/slice", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  const { project, asset } = found;
  const frames = req.body?.frames ? Number(req.body.frames) : undefined;
  // Without fps the sheet keeps its current rate.
  const fps = req.body?.fps !== undefined ? Number(req.body.fps) : (asset.fps ?? 8);
  if (frames !== undefined && !(frames >= 1 && frames <= 32)) return void res.status(400).json({ error: msg("err.frames") });
  if (!Number.isInteger(fps) || fps < 1 || fps > 30) return void res.status(400).json({ error: msg("err.fps") });
  const sliced = await sliceAssetFrames(project.id, asset, await readProjectFile(project.id, asset.file), frames, fps);
  const p = await updateProject(project.id, (p) => {
    const a = p.assets.find((x) => x.id === asset.id);
    if (a) Object.assign(a, sliced);
  });
  res.json(p.assets.find((a) => a.id === asset.id));
});

/** Cut out (or restore) the background; the untouched model output is kept as originalFile. */
postprocessRouter.post("/api/projects/:id/assets/:assetId/cutout", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  res.json(await cutoutAsset(found.project, found.asset, { tolerance: req.body?.tolerance, restore: !!req.body?.restore }));
});

/** Make a tile seamless. The result is a new version (pending review) linked to the original. */
postprocessRouter.post("/api/projects/:id/assets/:assetId/make-seamless", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  const overlap = Number(req.body?.overlap ?? 0.15);
  if (!(overlap >= 0.04 && overlap <= 0.4)) return void res.status(400).json({ error: msg("err.overlap") });
  res.json((await seamlessVersion(found.project, found.asset, overlap, { by: "user" })).asset);
});

/** Align frames on a shared anchor; the result is a new version linked to the original. */
postprocessRouter.post("/api/projects/:id/assets/:assetId/align-frames", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  if (found.asset.assetType !== "sprite_sheet") return void res.status(400).json({ error: msg("err.alignSheetOnly") });
  res.json(await alignedVersion(found.project, found.asset, parseAlignMode(req.body?.mode), { by: "user" }));
});

/** Colour-swap variant as a new sibling asset: { swaps: [{ from, to }], threshold?: 5-60, name? }. */
postprocessRouter.post("/api/projects/:id/assets/:assetId/recolor", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  const r = await recolorVariant(found.project, found.asset, req.body ?? {}, { by: "user" });
  if (typeof r === "string") return void res.status(400).json({ error: r });
  res.json(r);
});

/** Outer outline as a new version: { width: 1-16, color?: "#rrggbb" } (default colour: darkest palette colour). */
postprocessRouter.post("/api/projects/:id/assets/:assetId/outline", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  const { width, color } = req.body ?? {};
  const r = await outlineVersion(found.project, found.asset, { width: Number(width ?? 2), color }, { by: "user" });
  if (typeof r === "string") return void res.status(400).json({ error: r });
  res.json(r);
});

/** Snap colours to the style palette; the result is a new version. Body: { dither: "none" | "ordered" }. */
postprocessRouter.post("/api/projects/:id/assets/:assetId/snap-palette", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  if (!found.project.styleGuide?.palette.length) return void res.status(400).json({ error: msg("err.noPalette") });
  const dither = req.body?.dither === "ordered" ? "ordered" : "none";
  res.json(await paletteSnapVersion(found.project, found.asset, dither, { by: "user" }));
});
