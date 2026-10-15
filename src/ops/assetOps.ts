import fs from "node:fs/promises";
import path from "node:path";
import { removeBackground } from "../image/background.js";
import { analyzePalette, snapToPalette } from "../image/palette.js";
import { isPixelArt } from "../image/sizes.js";
import { type AlignMode, type Jitter, alignFrames, detectFrameCount, joinFrames, measureJitter, sliceSheet } from "../image/spriteSheet.js";
import { analyzeSeams, makeSeamless, type SeamReport } from "../image/tiles.js";
import { newId, projectDir, readProjectFile, updateProject, writeProjectFile } from "../store/index.js";
import type { Asset, Project } from "../store/types.js";

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
  };
  if (extra) Object.assign(created, await extra(created));
  await updateProject(project.id, (p) => void p.assets.push(created));
  return created;
}

/** Make a tile seamless as a new version. */
export async function seamlessVersion(project: Project, asset: Asset, overlap: number, actor: Actor) {
  const before = await seamsOf(project, asset);
  const png = await makeSeamless(await readProjectFile(project.id, asset.file), { overlap, pixel: isPixelArt(project.styleGuide) });
  const after = await analyzeSeams(png);
  const created = await newVersion(project, asset, png, `由「${asset.name}」无缝化处理（边缘融合 ${Math.round(overlap * 100)}%）`, actor);
  return { asset: created, before, after };
}

/** Align a sprite sheet's frames on a shared anchor as a new version. */
export async function alignedVersion(project: Project, asset: Asset, mode: AlignMode, actor: Actor) {
  const frames = await sheetFrames(project.id, asset);
  const before = await measureJitter(frames, mode);
  const aligned = await alignFrames(frames, mode);
  const after = await measureJitter(aligned, mode);
  const sheet = await joinFrames(aligned);
  const notes = `由「${asset.name}」对齐帧（${mode === "bottom" ? "底边居中" : "中心"}）：水平抖动 ${before.horizontal}→${after.horizontal}px，${mode === "bottom" ? "底边" : "垂直"} ${before.vertical}→${after.vertical}px`;
  const created = await newVersion(project, asset, sheet, notes, actor, (a) => sliceAssetFrames(project.id, a, sheet, aligned.length, asset.fps ?? 8));
  return { asset: created, before, after };
}

/** Snap an asset's colours to the style palette as a new version; reports palette coverage before/after. */
export async function paletteSnapVersion(project: Project, asset: Asset, dither: "none" | "ordered", actor: Actor) {
  const hexes = project.styleGuide?.palette.map((p) => p.hex) ?? [];
  if (!hexes.length) throw new Error("项目还没有风格指南色板");
  const src = await readProjectFile(project.id, asset.file);
  const png = await snapToPalette(src, hexes, { dither });
  const [before, after] = await Promise.all([analyzePalette(src, hexes), analyzePalette(png, hexes)]);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const notes = `由「${asset.name}」吸附到色板（${dither === "ordered" ? "有序抖动" : "不抖动"}）：色板内像素 ${pct(before.coverage)}→${pct(after.coverage)}`;
  const palette = { coverage: after.coverage, meanDeltaE: after.meanDeltaE, offPalette: after.offPalette };
  const created = await newVersion(project, asset, png, notes, actor, async (a) => ({
    palette,
    // Sprite sheets keep their frame count.
    ...(asset.frames?.length ? await sliceAssetFrames(project.id, a, png, asset.frames.length, asset.fps ?? 8) : {}),
  }));
  return { asset: created, before, after };
}
