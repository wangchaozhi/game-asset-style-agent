import sharp from "sharp";
import { isAssetType, isOpaqueType } from "../domain/assetTypes.js";
import { getProvider } from "../providers/index.js";
import { loadProject, readProjectFile } from "../store/index.js";
import { generateAsset } from "./assets.js";
import { type Job, type RunOptions, emit } from "./events.js";
import type { GenerateInput } from "./schemas.js";

/** Aspect of an existing image, to regenerate at the same shape. */
export function aspectOf(width: number, height: number): GenerateInput["aspect"] {
  if (width > height * 1.2) return "landscape";
  if (height > width * 1.2) return "portrait";
  return "square";
}

/**
 * Regenerate one asset from a user-edited prompt, straight to the image model (no Claude call).
 * The result is a new pending version linked to the original.
 */
export async function runManual(job: Job, opts: RunOptions) {
  const m = opts.manual!;
  const provider = getProvider(opts.providerId);
  const project = await loadProject(opts.projectId);
  const old = project.assets.find((a) => a.id === m.assetId);
  if (!old) throw new Error("要重生成的素材不存在");
  if (!isAssetType(old.assetType)) throw new Error(`未知的素材类型 ${old.assetType}`);
  const meta = await sharp(await readProjectFile(project.id, old.originalFile ?? old.file)).metadata();
  const frames = old.frames?.length;
  const input: GenerateInput = {
    name: old.name,
    asset_type: old.assetType,
    prompt: m.prompt,
    // A sprite sheet's shape comes from its frame count, not the old canvas.
    aspect: frames ? "landscape" : aspectOf(meta.width ?? 1, meta.height ?? 1),
    transparent_background: !isOpaqueType(old.assetType),
    consistency_asset_ids: [old.id],
    replaces_asset_id: old.id,
    ...(frames && frames >= 2 ? { frames } : {}),
  };
  emit(job, { type: "status", text: `直接重生成「${old.name}」· 图像通道 ${provider.label} · 不调用 Claude` });
  emit(job, { type: "tool", name: "generate_image", input });
  const { asset } = await generateAsset(job, provider, input);
  emit(job, { type: "text", delta: `已生成新版本，请在素材库中审核（可「对比上一版本」）。\n` });
  return asset;
}
