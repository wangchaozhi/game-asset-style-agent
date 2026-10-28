import { Router } from "express";
import { toCsv } from "../export/csv.js";
import { jitterOf, parseAlignMode, seamsOf } from "../ops/assetOps.js";
import { analyzePalette } from "../image/palette.js";
import { isPixelArt, parseSize, resizeAsset } from "../image/sizes.js";
import { tilePreview } from "../image/tiles.js";
import { loadProject, readProjectFile } from "../store/index.js";
import { detectNineSlice } from "../image/nineSlice.js";
import { colorShare, dominantColors } from "../image/recolor.js";
import { measureConsistency } from "../ops/consistency.js";
import { similarAssets } from "../ops/similar.js";
import { attachment, findAsset, pid } from "./util.js";
import { assetTypeLabel, msg } from "../i18n.js";

// Read-only checks and previews of assets: nothing here writes to the project.
export const analysisRouter = Router();

/** Assets that look nearly the same as this one (perceptual hash), closest first; its own versions are marked related. */
analysisRouter.get("/api/projects/:id/assets/:assetId/similar", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  res.json({ items: await similarAssets(found.project, found.asset) });
});

analysisRouter.get("/api/projects/:id/assets/:assetId/seams", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  res.json(await seamsOf(found.project, found.asset));
});

/** Suggested 9-slice margins for a UI asset (null when no stretchable band is found). */
analysisRouter.get("/api/projects/:id/assets/:assetId/nine-slice", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  if (found.asset.assetType !== "ui") return void res.status(400).json({ error: msg("err.nineUiOnly") });
  res.json({ suggestion: await detectNineSlice(await readProjectFile(found.project.id, found.asset.file)) });
});

analysisRouter.get("/api/projects/:id/assets/:assetId/tiled.png", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  const n = Number(req.query.n ?? 3);
  if (!Number.isInteger(n) || n < 2 || n > 6) return void res.status(400).json({ error: msg("err.tileCount") });
  res.setHeader("Content-Type", "image/png");
  res.send(await tilePreview(await readProjectFile(found.project.id, found.asset.file), n));
});

analysisRouter.get("/api/projects/:id/assets/:assetId/sized.png", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  const { project, asset } = found;
  const size = parseSize(String(req.query.size ?? ""));
  if (!size) return void res.status(400).json({ error: msg("err.sizeFormat") });
  const pixel = req.query.kernel ? req.query.kernel === "nearest" : isPixelArt(project.styleGuide);
  const png = await resizeAsset(await readProjectFile(project.id, asset.file), {
    ...size, assetType: asset.assetType, pixel, frames: asset.frames?.length,
  });
  res.setHeader("Content-Type", "image/png");
  if (req.query.download) res.setHeader("Content-Disposition", attachment("asset.png", `${asset.name}@${req.query.size}.png`));
  res.send(png);
});

/** Fresh palette check against the current style guide (it may have been edited since generation). */
analysisRouter.get("/api/projects/:id/assets/:assetId/palette", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  const palette = found.project.styleGuide?.palette.map((p) => p.hex) ?? [];
  if (!palette.length) return void res.status(400).json({ error: msg("err.noPalette") });
  const threshold = Math.max(2, Math.min(60, Number(req.query.threshold ?? 20)));
  res.json(await analyzePalette(await readProjectFile(found.project.id, found.asset.file), palette, { threshold }));
});

/** How much the content wanders between frames (px). */
analysisRouter.get("/api/projects/:id/assets/:assetId/jitter", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  if (found.asset.assetType !== "sprite_sheet") return void res.status(400).json({ error: msg("err.jitterSheetOnly") });
  res.json(await jitterOf(found.project, found.asset, parseAlignMode(req.query.mode)));
});

/** Which assets drift furthest from the project's style (see measureConsistency); ?tag= narrows it to one group. */
analysisRouter.get("/api/projects/:id/consistency", async (req, res) => {
  const tag = typeof req.query.tag === "string" && req.query.tag ? req.query.tag : undefined;
  const report = await measureConsistency(await loadProject(pid(req)), { tag });
  if (!report) return void res.status(400).json({ error: msg("err.noPalette") });
  res.json(report);
});

/** The consistency report as CSV for a spreadsheet: ranked rows with measurements and reasons; ?tag= as above. */
analysisRouter.get("/api/projects/:id/consistency.csv", async (req, res) => {
  const tag = typeof req.query.tag === "string" && req.query.tag ? req.query.tag : undefined;
  const project = await loadProject(pid(req));
  const report = await measureConsistency(project, { tag });
  if (!report) return void res.status(400).json({ error: msg("err.noPalette") });
  const byId = new Map(project.assets.map((a) => [a.id, a]));
  const rows: unknown[][] = [msg("csv.header").split("|")];
  for (const [i, item] of report.items.entries()) {
    const a = byId.get(item.id)!;
    rows.push([i + 1, a.id, a.name, assetTypeLabel(a.assetType), msg(`status.${a.status}`), `${Math.round(item.coverage * 100)}%`, item.meanDeltaE, item.drift, item.reasons.join(msg("csv.reasonSep"))]);
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", attachment("consistency.csv", `${project.name}${tag ? `_${tag}` : ""}_${msg("csv.fileSuffix")}.csv`));
  res.send(toCsv(rows));
});

/**
 * Assets that use a colour: ?hex=%23rrggbb&threshold=20 (ΔE, 5-60). Current assets (not superseded) whose share
 * of visible pixels near the colour is at least `min` (default 0.02), most first.
 */
analysisRouter.get("/api/projects/:id/assets-by-color", async (req, res) => {
  const hex = String(req.query.hex ?? "");
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return void res.status(400).json({ error: msg("err.hex") });
  const threshold = req.query.threshold === undefined ? 20 : Number(req.query.threshold);
  if (!Number.isFinite(threshold) || threshold < 5 || threshold > 60) return void res.status(400).json({ error: msg("err.threshold") });
  const min = req.query.min === undefined ? 0.02 : Number(req.query.min);
  if (!Number.isFinite(min) || min < 0 || min > 1) return void res.status(400).json({ error: msg("err.min") });
  const project = await loadProject(pid(req));
  const superseded = new Set(project.assets.map((a) => a.parentId).filter(Boolean));
  const current = project.assets.filter((a) => !superseded.has(a.id)).slice(-300);
  const shares = await Promise.all(
    current.map(async (a) => ({ id: a.id, share: await colorShare(await readProjectFile(project.id, a.file), hex, threshold) })),
  );
  res.json({ hex: hex.toLowerCase(), threshold, items: shares.filter((s) => s.share >= min).sort((a, b) => b.share - a.share) });
});

/** The asset's main colours, to pick swap sources from. */
analysisRouter.get("/api/projects/:id/assets/:assetId/colors", async (req, res) => {
  const found = await findAsset(req, res);
  if (!found) return;
  res.json({ colors: await dominantColors(await readProjectFile(found.project.id, found.asset.file)) });
});
