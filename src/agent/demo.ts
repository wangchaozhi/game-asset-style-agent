import sharp from "sharp";
import { ASSET_TYPES, type AssetType, isAssetType, isOpaqueType } from "../domain/assetTypes.js";
import { getProvider } from "../providers/index.js";
import { loadConversation, loadProject, readProjectFile, saveConversation, updateProject } from "../store/index.js";
import type { StyleGuide } from "../store/types.js";
import { generateAsset } from "./assets.js";
import { BudgetExceededError } from "./budget.js";
import { type Job, type RunOptions, emit, requestLabel } from "./events.js";
import type { GenerateInput } from "./schemas.js";

// Demo mode: a scripted run with no Claude call, for trying the UI without an API key.

const hex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

/** A placeholder style guide built from the reference image's dominant colour. */
export function demoStyleGuide(d: { r: number; g: number; b: number }): StyleGuide {
  const palette = [
    { hex: hex(d.r, d.g, d.b), role: "主色" },
    { hex: hex(d.r * 0.6, d.g * 0.6, d.b * 0.6), role: "暗部" },
    { hex: hex(255 - d.r, 255 - d.g, 255 - d.b), role: "强调色" },
  ];
  return {
    summary: "演示风格指南（从参考图主色自动提取）",
    palette,
    rendering: "flat vector",
    line_and_edges: "bold dark outline",
    lighting_and_shading: "two-tone cel shading",
    perspective: "front view",
    proportions: "chunky",
    texture_and_detail: "low detail",
    mood: "playful",
    avoid: ["photorealism"],
    prompt_prefix: `Flat vector game art, bold outline, palette ${palette.map((p) => p.hex).join(" ")}.`,
  };
}

const aspectFor = (t: string) => (t === "background" ? ("landscape" as const) : ("square" as const));

/** Demo runs keep a text-only transcript so the conversation UI can be exercised without Claude. */
async function recordDemoTurn(projectId: string, opts: RunOptions, reply: string) {
  const prev = opts.continueConversation ? await loadConversation(projectId) : null;
  const request = requestLabel(opts);
  await saveConversation(projectId, {
    messages: [...(prev?.messages ?? []), { role: "user", content: request }, { role: "assistant", content: reply }],
    runs: [...(prev?.runs ?? []), { request, at: new Date().toISOString() }],
  });
}

export async function runDemo(job: Job, opts: RunOptions) {
  const provider = getProvider(opts.providerId);
  const project = await loadProject(opts.projectId);
  if (!project.refs.length) throw new Error("请先上传至少一张风格参考图");
  emit(job, { type: "status", text: `演示模式（AGENT_MODE=demo）· 图像通道 ${provider.label}` });

  let sg = project.styleGuide;
  if (!sg) {
    const stats = await sharp(await readProjectFile(project.id, project.refs[0].file)).stats();
    const guide = demoStyleGuide(stats.dominant);
    sg = guide;
    await updateProject(project.id, (p) => {
      p.styleGuide = guide;
    });
    emit(job, { type: "style", styleGuide: guide });
  }

  if (opts.redraw) {
    const old = project.assets.find((a) => a.id === opts.redraw!.assetId);
    if (!old) throw new Error("要重画的素材不存在");
    const input: GenerateInput = {
      name: old.name,
      asset_type: old.assetType as AssetType,
      prompt: `${old.prompt} Revision: ${opts.redraw.feedback}`,
      aspect: aspectFor(old.assetType),
      transparent_background: !isOpaqueType(old.assetType),
      consistency_asset_ids: [old.id],
      replaces_asset_id: old.id,
      frames: old.frames?.length,
    };
    emit(job, { type: "text", delta: `按意见重画「${old.name}」：${opts.redraw.feedback}\n` });
    emit(job, { type: "tool", name: "generate_image", input });
    const { asset } = await generateAsset(job, provider, input);
    emit(job, { type: "asset", asset });
    await recordDemoTurn(project.id, opts, `已重画 ${asset.id}`);
    return;
  }

  const types = (opts.assetTypes.length ? opts.assetTypes : ["item_icon", "character", "tile"]).filter(isAssetType);
  emit(job, { type: "text", delta: `计划生成 ${types.length} 个素材：${types.map((t) => ASSET_TYPES[t]).join("、")}。\n` });
  await Promise.all(
    types.map(async (t, i) => {
      const input: GenerateInput = {
        name: `${ASSET_TYPES[t]} #${i + 1}`,
        asset_type: t,
        prompt: `${sg.prompt_prefix} ${opts.request} ${t}`,
        aspect: aspectFor(t),
        transparent_background: !isOpaqueType(t),
      };
      emit(job, { type: "tool", name: "generate_image", input });
      const made = await generateAsset(job, provider, input).catch((err) => {
        if (err instanceof BudgetExceededError) return null;
        throw err;
      });
      if (!made) return;
      const { asset } = made;
      await updateProject(project.id, (p) => {
        const a = p.assets.find((x) => x.id === asset.id)!;
        a.status = "approved";
        a.score = 7;
        a.notes = "演示模式自动通过";
        a.reviewer = "agent";
        Object.assign(asset, a);
      });
      emit(job, { type: "asset", asset });
    }),
  );
  await recordDemoTurn(project.id, opts, `生成了 ${types.length} 个素材`);
  emit(job, { type: "text", delta: "演示完成。配置 ANTHROPIC_API_KEY 并去掉 AGENT_MODE=demo 即可启用真正的 Claude 美术总监。\n" });
}
