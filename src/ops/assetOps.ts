import fs from "node:fs/promises";
import path from "node:path";
import { type NineSlice, fitNineSlice, parseNineSlice } from "../domain/nineSlice.js";
import { isOpaque, removeBackground } from "../image/background.js";
import { isOpaqueType } from "../domain/assetTypes.js";
import { addOutline, darkestColor } from "../image/outline.js";
import { type ColorSwap, recolor } from "../image/recolor.js";
import { imageSize } from "../image/io.js";
import { analyzePalette, snapToPalette } from "../image/palette.js";
import { isPixelArt } from "../image/sizes.js";
import { type AlignMode, type Jitter, alignFrames, detectFrameCount, joinFrames, measureJitter, sliceSheet } from "../image/spriteSheet.js";
import { analyzeSeams, makeSeamless, type SeamReport } from "../image/tiles.js";
import { newId, projectDir, readProjectFile, updateProject, writeProjectFile } from "../store/index.js";
import type { Asset, Project } from "../store/types.js";
import { msg } from "../i18n.js";

// Post-processing shared by the HTTP routes and the agent's tools.

/** Who asked for an operation: decides the reviewer label on the new version. */
export type Actor = { by: "user" } | { by: "agent"; runId: string };

/**
 * Slice a sprite sheet into frame PNGs + GIF and return the fields to merge into the asset.
 * Frame count: explicit value, else detected from transparent gaps, else 4.
 */
export async function sliceAssetFrames(
  projectId: string,
  asset: Pick<Asset, "id">,
  data: Buffer,
  frameCount?: number,
  fps = 8,
): Promise<Pick<Asset, "frames" | "gif" | "fps">> {
  const count = frameCount ?? (await detectFrameCount(data)) ?? 4;
  const sheet = await sliceSheet(data, count, fps);
  const frames = await Promise.all(
    sheet.frames.map(async (buf, i) => {
      const rel = `assets/${asset.id}_f${i}.png`;
      await writeProjectFile(projectId, rel, buf);
      return rel;
    }),
  );
  const gif = `assets/${asset.id}.gif`;
  await writeProjectFile(projectId, gif, sheet.gif);
  return { frames, gif, fps };
}

/** Frames of a sprite sheet: the sliced files if present, else an equal split (default 4). */
export async function sheetFrames(projectId: string, asset: Asset): Promise<Buffer[]> {
  if (asset.frames?.length) return Promise.all(asset.frames.map((f) => readProjectFile(projectId, f)));
  return (await sliceSheet(await readProjectFile(projectId, asset.file), 4)).frames;
}

export const parseAlignMode = (v: unknown): AlignMode => (v === "center" ? "center" : "bottom");

export const jitterOf = async (project: Project, asset: Asset, mode: AlignMode = "bottom"): Promise<Jitter> =>
  measureJitter(await sheetFrames(project.id, asset), mode);

export const seamsOf = async (project: Project, asset: Asset): Promise<SeamReport> =>
  analyzeSeams(await readProjectFile(project.id, asset.file));

/**
 * Cut out (or restore) an asset's background in place. The untouched model output is kept as
 * originalFile; a superseded cut-out file is deleted. Sprite frames are re-sliced.
 */
export async function cutoutAsset(project: Project, asset: Asset, opts: { tolerance?: number; restore?: boolean } = {}): Promise<Asset> {
  const tolerance = Math.max(1, Math.min(120, Number(opts.tolerance ?? 28)));
  const originalFile = asset.originalFile ?? `assets/${asset.id}_orig.${asset.file.split(".").pop()}`;
  if (!asset.originalFile) await writeProjectFile(project.id, originalFile, await readProjectFile(project.id, asset.file));
  let file = originalFile;
  if (!opts.restore) {
    file = `assets/${asset.id}_cut${Date.now().toString(36)}.png`;
    await writeProjectFile(project.id, file, await removeBackground(await readProjectFile(project.id, originalFile), tolerance));
  }
  const sliced = asset.frames?.length
    ? await sliceAssetFrames(project.id, asset, await readProjectFile(project.id, file), asset.frames.length, asset.fps)
    : {};
  const p = await updateProject(project.id, (p) => {
    const a = p.assets.find((x) => x.id === asset.id);
    if (a) Object.assign(a, { originalFile, file, mime: opts.restore ? asset.mime : "image/png" }, sliced);
  });
  // The previous cut-out is superseded; never touch the original model output.
  if (asset.file !== originalFile && asset.file !== file && /_cut[0-9a-z]+\.png$/.test(asset.file)) {
    await fs.rm(path.join(projectDir(project.id), asset.file), { force: true });
  }
  return p.assets.find((a) => a.id === asset.id)!;
}

/**
 * Save (or with null, clear) a UI asset's 9-slice margins, validated against its image.
 * Returns the updated asset, or an error message.
 */
export async function setNineSlice(project: Project, asset: Asset, input: unknown): Promise<Asset | string> {
  if (asset.assetType !== "ui") return msg("err.nineUiOnly");
  let slice: NineSlice | null = null;
  if (input !== null) {
    const { width, height } = await imageSize(await readProjectFile(project.id, asset.file));
    const parsed = parseNineSlice(input, width, height);
    if (typeof parsed === "string") return parsed;
    slice = parsed;
  }
  let updated: Asset | undefined;
  await updateProject(project.id, (p) => {
    updated = p.assets.find((a) => a.id === asset.id);
    if (!updated) return;
    if (slice) updated.nineSlice = slice;
    else delete updated.nineSlice;
  });
  return updated ?? msg("err.noAsset");
}

/** Save `png` as a new pending version of `asset` (parentId links them). */
async function newVersion(project: Project, asset: Asset, png: Buffer, notes: string, actor: Actor, extra?: (a: Asset) => Promise<Partial<Asset>>) {
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
    notes,
    reviewer: actor.by,
    runId: actor.by === "agent" ? actor.runId : asset.runId,
    provider: "postprocess",
    createdAt: new Date().toISOString(),
    parentId: asset.id,
    ...(asset.tags?.length ? { tags: [...asset.tags] } : {}),
  };
  // Post-processing keeps the layout, so the 9-slice margins carry over while they still fit.
  if (asset.nineSlice) {
    const { width, height } = await imageSize(png);
    const slice = fitNineSlice(asset.nineSlice, width, height);
    if (slice) created.nineSlice = slice;
  }
  if (extra) Object.assign(created, await extra(created));
  await updateProject(project.id, (p) => void p.assets.push(created));
  return created;
}

/** Make a tile seamless as a new version. */
export async function seamlessVersion(project: Project, asset: Asset, overlap: number, actor: Actor) {
  const before = await seamsOf(project, asset);
  const png = await makeSeamless(await readProjectFile(project.id, asset.file), { overlap, pixel: isPixelArt(project.styleGuide) });
  const after = await analyzeSeams(png);
  const created = await newVersion(project, asset, png, msg("note.seamless", { name: asset.name, overlap: Math.round(overlap * 100) }), actor);
  return { asset: created, before, after };
}

/** Align a sprite sheet's frames on a shared anchor as a new version. */
export async function alignedVersion(project: Project, asset: Asset, mode: AlignMode, actor: Actor) {
  const frames = await sheetFrames(project.id, asset);
  const before = await measureJitter(frames, mode);
  const aligned = await alignFrames(frames, mode);
  const after = await measureJitter(aligned, mode);
  const sheet = await joinFrames(aligned);
  const notes = msg(mode === "bottom" ? "note.alignBottom" : "note.alignCenter", {
    name: asset.name, h0: before.horizontal, h1: after.horizontal, v0: before.vertical, v1: after.vertical,
  });
  const created = await newVersion(project, asset, sheet, notes, actor, (a) => sliceAssetFrames(project.id, a, sheet, aligned.length, asset.fps ?? 8));
  return { asset: created, before, after };
}

/** Snap an asset's colours to the style palette as a new version; reports palette coverage before/after. */
export async function paletteSnapVersion(project: Project, asset: Asset, dither: "none" | "ordered", actor: Actor) {
  const hexes = project.styleGuide?.palette.map((p) => p.hex) ?? [];
  if (!hexes.length) throw new Error(msg("err.noPalette"));
  const src = await readProjectFile(project.id, asset.file);
  const png = await snapToPalette(src, hexes, { dither });
  const [before, after] = await Promise.all([analyzePalette(src, hexes), analyzePalette(png, hexes)]);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const notes = msg(dither === "ordered" ? "note.snapOrdered" : "note.snapNone", { name: asset.name, before: pct(before.coverage), after: pct(after.coverage) });
  const palette = { coverage: after.coverage, meanDeltaE: after.meanDeltaE, offPalette: after.offPalette };
  const created = await newVersion(project, asset, png, notes, actor, async (a) => ({
    palette,
    // Sprite sheets keep their frame count.
    ...(asset.frames?.length ? await sliceAssetFrames(project.id, a, png, asset.frames.length, asset.fps ?? 8) : {}),
  }));
  return { asset: created, before, after };
}

export interface OutlineOptions {
  /** px, 1-16 */
  width: number;
  /** #rrggbb; default: the darkest style-palette colour */
  color?: string;
}

/**
 * Add an outer outline as a new version. Returns an error message for assets with nothing to outline
 * (drawn edge to edge, or no transparency) or bad options.
 */
export async function outlineVersion(project: Project, asset: Asset, opts: OutlineOptions, actor: Actor): Promise<Asset | string> {
  if (isOpaqueType(asset.assetType)) return msg("err.opaqueOutline");
  if (!Number.isInteger(opts.width) || opts.width < 1 || opts.width > 16) return msg("err.outlineWidth");
  if (opts.color !== undefined && !/^#[0-9a-f]{6}$/i.test(opts.color)) return msg("err.outlineColor");
  const src = await readProjectFile(project.id, asset.file);
  if (await isOpaque(src)) return msg("err.needTransparency");
  const color = (opts.color ?? darkestColor(project.styleGuide?.palette.map((p) => p.hex) ?? [])).toLowerCase();
  const png = await addOutline(src, { width: opts.width, color, square: isPixelArt(project.styleGuide) });
  return newVersion(project, asset, png, msg("note.outline", { name: asset.name, width: opts.width, color }), actor, async (a) =>
    asset.frames?.length ? sliceAssetFrames(project.id, a, png, asset.frames.length, asset.fps ?? 8) : {},
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Colour-swap variant (e.g. an elite enemy, another outfit colour) as a new pending sibling asset:
 * `variantOf` links it instead of `parentId`, so the original isn't marked as superseded.
 * Returns an error message for bad input.
 */
export async function recolorVariant(
  project: Project,
  asset: Asset,
  input: { swaps: unknown; threshold?: unknown; name?: unknown },
  actor: Actor,
): Promise<Asset | string> {
  const swaps = input.swaps;
  if (!Array.isArray(swaps) || !swaps.length || swaps.length > 8) return msg("err.swaps");
  if (!swaps.every((s) => s && HEX.test(s.from) && HEX.test(s.to))) return msg("err.swapHex");
  const threshold = input.threshold === undefined ? 20 : Number(input.threshold);
  if (!Number.isFinite(threshold) || threshold < 5 || threshold > 60) return msg("err.threshold");
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 80) : msg("note.variantName", { name: asset.name });
  const clean = (swaps as ColorSwap[]).map((s) => ({ from: s.from.toLowerCase(), to: s.to.toLowerCase() }));
  const png = await recolor(await readProjectFile(project.id, asset.file), clean, threshold);
  const notes = msg("note.recolor", { name: asset.name, swaps: clean.map((s) => `${s.from}→${s.to}`).join(msg("note.listSep")) });
  return newVersion(project, asset, png, notes, actor, async (a) => ({
    name,
    // A sibling, not a newer version: drop the parent link newVersion sets.
    parentId: undefined,
    variantOf: asset.id,
    ...(asset.frames?.length ? await sliceAssetFrames(project.id, a, png, asset.frames.length, asset.fps ?? 8) : {}),
  }));
}
