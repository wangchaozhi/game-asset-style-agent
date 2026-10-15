import { shrink } from "../image/io.js";
import { isOpaque, removeBackground } from "../image/background.js";
import { analyzePalette } from "../image/palette.js";
import { detectFrameCount, sliceSheet } from "../image/spriteSheet.js";
import type { ImageInput, ImageProvider } from "../providers/types.js";
import { extFor, loadProject, newId, readProjectFile, updateProject, writeProjectFile } from "../store/index.js";
import type { Asset, Project } from "../store/types.js";
import { addImageCall } from "../usage/record.js";
import { type Job, emit, reportUsage } from "./events.js";
import type { GenerateInput } from "./schemas.js";

export async function refImages(project: Project): Promise<ImageInput[]> {
  return Promise.all(project.refs.map(async (r) => ({ data: await readProjectFile(project.id, r.file), mime: r.mime })));
}

/** Call the image model, post-process the result and add it to the project as a pending asset. */
export async function generateAsset(
  job: Job,
  provider: ImageProvider,
  input: GenerateInput,
): Promise<{ asset: Asset; image: ImageInput }> {
  const project = await loadProject(job.projectId);
  const refs = await Promise.all((await refImages(project)).map((r) => shrink(r, 1024)));
  const extra = await Promise.all(
    (input.consistency_asset_ids ?? [])
      .map((id) => project.assets.find((a) => a.id === id))
      .filter((a): a is Asset => !!a)
      .map(async (a) => shrink({ data: await readProjectFile(project.id, a.file), mime: a.mime }, 1024)),
  );
  let img: ImageInput;
  try {
    img = await provider.generate(
      {
        prompt: input.prompt,
        references: [...extra, ...refs],
        aspect: input.aspect,
        transparent: input.transparent_background,
        frames: input.asset_type === "sprite_sheet" ? (input.frames ?? 4) : undefined,
      },
      job.abort.signal,
    );
  } catch (err) {
    addImageCall(job.usage, provider.id, false);
    reportUsage(job);
    throw err;
  }
  addImageCall(job.usage, provider.id, true);
  reportUsage(job);

  const id = newId("ast");
  let originalFile: string | undefined;
  // Many image models can't output alpha; cut the flat backdrop out ourselves.
  if (input.transparent_background && (await isOpaque(img.data))) {
    originalFile = `assets/${id}_orig.${extFor(img.mime)}`;
    await writeProjectFile(project.id, originalFile, img.data);
    img = { data: await removeBackground(img.data), mime: "image/png" };
  }
  const file = `assets/${id}.${extFor(img.mime)}`;
  await writeProjectFile(project.id, file, img.data);
  const asset: Asset = {
    id,
    name: input.name,
    assetType: input.asset_type,
    prompt: input.prompt,
    file,
    mime: img.mime,
    status: "pending_review",
    runId: job.id,
    provider: provider.id,
    createdAt: new Date().toISOString(),
    originalFile,
    parentId: input.replaces_asset_id,
  };
  if (input.asset_type === "sprite_sheet") {
    Object.assign(asset, await sliceAssetFrames(project.id, asset, img.data, input.frames).catch(() => ({})));
  }
  if (project.styleGuide?.palette.length) {
    const r = await analyzePalette(img.data, project.styleGuide.palette.map((p) => p.hex)).catch(() => null);
    if (r) asset.palette = { coverage: r.coverage, meanDeltaE: r.meanDeltaE, offPalette: r.offPalette };
  }
  await updateProject(project.id, (p) => {
    p.assets.push(asset);
  });
  emit(job, { type: "asset", asset });
  return { asset, image: img };
}

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
