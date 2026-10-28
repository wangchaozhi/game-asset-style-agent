import sharp from "sharp";
import { ACTION_PRESETS } from "../domain/actionSet.js";
import { type AssetType, isAssetType, isOpaqueType } from "../domain/assetTypes.js";
import { getProvider } from "../providers/index.js";
import { loadConversation, loadProject, readProjectFile, recordStyleVersion, saveConversation, updateProject } from "../store/index.js";
import type { StyleGuide } from "../store/types.js";
import { generateAsset } from "./assets.js";
import { BudgetExceededError } from "./budget.js";
import { type Job, type RunOptions, emit, requestLabel } from "./events.js";
import type { GenerateInput } from "./schemas.js";
import { assetTypeLabel, msg, providerLabel } from "../i18n.js";
import { recordNote } from "../domain/noteLog.js";

// Demo mode: a scripted run with no Claude call, for trying the UI without an API key.

const hex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

/** A placeholder style guide built from the reference image's dominant colour. */
export function demoStyleGuide(d: { r: number; g: number; b: number }): StyleGuide {
  const palette = [
    { hex: hex(d.r, d.g, d.b), role: msg("demo.roleMain") },
    { hex: hex(d.r * 0.6, d.g * 0.6, d.b * 0.6), role: msg("demo.roleShadow") },
    { hex: hex(255 - d.r, 255 - d.g, 255 - d.b), role: msg("demo.roleAccent") },
  ];
  return {
    summary: msg("demo.summary"),
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
  if (!project.refs.length && !project.styleGuide) throw new Error(msg("err.needStyle"));
  emit(job, { type: "status", text: msg("run.demoStart", { provider: providerLabel(provider.id, provider.label) }) });

  let sg = project.styleGuide;
  if (!sg) {
    const stats = await sharp(await readProjectFile(project.id, project.refs[0].file)).stats();
    const guide = demoStyleGuide(stats.dominant);
    sg = guide;
    await updateProject(project.id, (p) => {
      p.styleGuide = guide;
    });
    await recordStyleVersion(project.id, guide, "agent");
    emit(job, { type: "style", styleGuide: guide });
  }

  if (opts.redraws?.length) {
    for (const r of opts.redraws) {
      const old = project.assets.find((a) => a.id === r.assetId);
      if (!old) throw new Error(msg("err.noRedrawAsset"));
      const input: GenerateInput = {
        name: old.name,
        asset_type: old.assetType as AssetType,
        prompt: `${old.prompt} Revision: ${r.feedback}`,
        aspect: aspectFor(old.assetType),
        transparent_background: !isOpaqueType(old.assetType),
        consistency_asset_ids: [old.id],
        replaces_asset_id: old.id,
        frames: old.frames?.length,
      };
      emit(job, { type: "text", delta: `${msg("run.redrawing", { name: old.name, feedback: r.feedback || msg("run.noFeedback") })}\n` });
      emit(job, { type: "tool", name: "generate_image", input });
      const made = await generateAsset(job, provider, input).catch((err) => {
        if (err instanceof BudgetExceededError) return null;
        throw err;
      });
      if (made) emit(job, { type: "asset", asset: made.asset });
    }
    await recordDemoTurn(project.id, opts, msg("run.redrew", { n: opts.redraws.length }));
    return;
  }

  const set = opts.actionSet;
  const inputs: GenerateInput[] = set
    ? // One sheet per action, at the preset's frame count and speed, tied to the character.
      set.actions.map((k) => ({
        name: `${set.name}·${ACTION_PRESETS[k].label}`,
        asset_type: "sprite_sheet",
        prompt: `${sg.prompt_prefix} ${set.name}: ${ACTION_PRESETS[k].motion}, ${ACTION_PRESETS[k].frames} frames in one row`,
        aspect: "landscape",
        transparent_background: true,
        frames: ACTION_PRESETS[k].frames,
        fps: ACTION_PRESETS[k].fps,
        consistency_asset_ids: [set.assetId],
        tags: [set.name],
      }))
    : (opts.assetTypes.length ? opts.assetTypes : ["item_icon", "character", "tile"]).filter(isAssetType).map((t, i) => ({
        name: `${assetTypeLabel(t)} #${i + 1}`,
        asset_type: t,
        prompt: `${sg.prompt_prefix} ${opts.request} ${t}`,
        aspect: aspectFor(t),
        transparent_background: !isOpaqueType(t),
      }));
  emit(job, { type: "text", delta: `${msg("run.plan", { n: inputs.length, names: inputs.map((i) => i.name).join(msg("note.enumSep")) })}\n` });
  await Promise.all(
    inputs.map(async (input) => {
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
        a.notes = msg("note.demoApproved");
        a.reviewer = "agent";
        recordNote(a, "agent", a.notes);
        Object.assign(asset, a);
      });
      emit(job, { type: "asset", asset });
    }),
  );
  await recordDemoTurn(project.id, opts, msg("run.generated", { n: inputs.length }));
  emit(job, { type: "text", delta: `${msg("run.demoDone")}\n` });
}
