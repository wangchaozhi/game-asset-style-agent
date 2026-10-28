import { normalizeTags } from "../domain/tags.js";
import { shrink } from "../image/io.js";
import { isOpaque, removeBackground } from "../image/background.js";
import { analyzePalette } from "../image/palette.js";
import type { ImageInput, ImageProvider } from "../providers/types.js";
import { extFor, loadProject, newId, readProjectFile, updateProject, writeProjectFile } from "../store/index.js";
import type { Asset, Project } from "../store/types.js";
import { sliceAssetFrames } from "../ops/assetOps.js";
import { addImageCall } from "../usage/record.js";
import { BudgetExceededError, budgetBlock } from "./budget.js";
import { type Job, emit, reportUsage } from "./events.js";
import type { GenerateInput } from "./schemas.js";
import { msg } from "../i18n.js";

export async function refImages(project: Project): Promise<ImageInput[]> {
  return Promise.all(project.refs.map(async (r) => ({ data: await readProjectFile(project.id, r.file), mime: r.mime })));
}

/** Call the image model, post-process the result and add it to the project as a pending asset. */
export async function generateAsset(
  job: Job,
  provider: ImageProvider,
  input: GenerateInput,
): Promise<{ asset: Asset; image: ImageInput }> {
  // Check and reserve synchronously: parallel tool calls all reach this point before any finishes.
  const blocked = budgetBlock(job.budget, job.usage, job.imagesInFlight ?? 0);
  if (blocked) {
    if (!job.budgetNoticed) emit(job, { type: "status", text: msg("run.budgetBlocked", { reason: blocked }) });
    job.budgetNoticed = true;
    throw new BudgetExceededError(blocked);
  }
  job.imagesInFlight = (job.imagesInFlight ?? 0) + 1;
  try {
    return await generateReserved(job, provider, input);
  } finally {
    job.imagesInFlight--;
  }
}

async function generateReserved(job: Job, provider: ImageProvider, input: GenerateInput): Promise<{ asset: Asset; image: ImageInput }> {
  const project = await loadProject(job.projectId);
  // Parallel generations share one decode + downscale of each reference.
  const cache = (job.refCache ??= new Map());
  const refs = await Promise.all(
    project.refs.map((r) => {
      let p = cache.get(r.file);
      if (!p) {
        p = readProjectFile(project.id, r.file).then((data) => shrink({ data, mime: r.mime }, 1024));
        cache.set(r.file, p);
      }
      return p;
    }),
  );
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
        onRetry: ({ attempt, delayMs, reason }) =>
          emit(job, { type: "status", text: msg(reason.includes("429") ? "run.retryLimited" : "run.retryError", { name: input.name, reason, s: Math.ceil(delayMs / 1000), n: attempt }) }),
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
  // A redraw keeps its predecessor's tags (tags given now are added) and frame rate.
  const predecessor = input.replaces_asset_id ? project.assets.find((a) => a.id === input.replaces_asset_id) : undefined;
  const inherited = predecessor?.tags;
  const tags = normalizeTags([...(inherited ?? []), ...(input.tags ?? [])]);
  if (tags.length) asset.tags = tags;
  if (input.asset_type === "sprite_sheet") {
    Object.assign(asset, await sliceAssetFrames(project.id, asset, img.data, input.frames, input.fps ?? predecessor?.fps ?? 8).catch(() => ({})));
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
