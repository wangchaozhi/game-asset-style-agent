import type Anthropic from "@anthropic-ai/sdk";
import { shrink } from "../image/io.js";
import { describePalette } from "../image/palette.js";
import type { Jitter } from "../image/spriteSheet.js";
import type { SeamReport } from "../image/tiles.js";
import { alignedVersion, cutoutAsset, jitterOf, seamlessVersion, seamsOf } from "../ops/assetOps.js";
import type { ImageProvider } from "../providers/types.js";
import { loadProject, readProjectFile, recordStyleVersion, updateProject } from "../store/index.js";
import type { Asset, Project } from "../store/types.js";
import { generateAsset } from "./assets.js";
import { BudgetExceededError } from "./budget.js";
import { type Job, emit } from "./events.js";
import { AlignFramesInput, FixSeamsInput, GenerateInput, RemoveBackgroundInput, ReviewInput, StyleGuideInput } from "./schemas.js";

type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

export const describeSeams = (r: SeamReport) =>
  r.seamless
    ? `Seam check: tiles seamlessly (edge difference L/R ${r.horizontalDiff}, T/B ${r.verticalDiff}).`
    : `Seam check: FAILS (${[!r.horizontalOk && "left/right", !r.verticalOk && "top/bottom"].filter(Boolean).join(" and ")} edges differ: ${r.horizontalDiff} / ${r.verticalDiff} vs. in-tile baseline ${r.baseline}). Use fix_tile_seams rather than regenerating.`;

export const describeJitter = (j: Jitter) =>
  Math.max(j.horizontal, j.vertical) <= 3
    ? `Frame jitter check: steady (horizontal ${j.horizontal}px, baseline ${j.vertical}px).`
    : `Frame jitter check: the character drifts ${j.horizontal}px horizontally and ${j.vertical}px vertically between frames. Use align_sprite_frames rather than regenerating.`;

/** Tool result with a short text and the image for Claude to look at. */
async function withImage(id: string, text: string, data: Buffer, mime: string): Promise<ToolResult> {
  const preview = await shrink({ data, mime }, 768);
  return {
    type: "tool_result",
    tool_use_id: id,
    content: [
      { type: "text", text },
      { type: "image", source: { type: "base64", media_type: preview.mime as "image/jpeg", data: preview.data.toString("base64") } },
    ],
  };
}

async function findAssetFor(job: Job, assetId: string): Promise<{ project: Project; asset: Project["assets"][number] } | null> {
  const project = await loadProject(job.projectId);
  const asset = project.assets.find((a) => a.id === assetId);
  return asset ? { project, asset } : null;
}

export const errResult = (id: string, message: string): ToolResult => ({
  type: "tool_result",
  tool_use_id: id,
  is_error: true,
  content: message,
});

/** Execute one tool call from Claude. Errors the model can fix come back as is_error results. */
export async function runTool(job: Job, provider: ImageProvider, block: Anthropic.Beta.BetaToolUseBlock): Promise<ToolResult> {
  const invalid = () => errResult(block.id, JSON.stringify({ INVALID_JSON: JSON.stringify(block.input) }));
  switch (block.name) {
    case "save_style_guide": {
      const parsed = StyleGuideInput.safeParse(block.input);
      if (!parsed.success) return invalid();
      let previous = null as typeof parsed.data | null;
      await updateProject(job.projectId, (p) => {
        previous = p.styleGuide;
        p.styleGuide = parsed.data;
      });
      await recordStyleVersion(job.projectId, parsed.data, "agent", previous);
      emit(job, { type: "style", styleGuide: parsed.data });
      return { type: "tool_result", tool_use_id: block.id, content: "Style guide saved." };
    }
    case "generate_image": {
      const parsed = GenerateInput.safeParse(block.input);
      if (!parsed.success) return invalid();
      try {
        const { asset, image } = await generateAsset(job, provider, parsed.data);
        const project = await loadProject(job.projectId);
        // Automatic checks are hints for the review; a failing check must not fail the generation.
        const seams = asset.assetType === "tile" ? await seamsOf(project, asset).catch(() => null) : null;
        const jitter = asset.assetType === "sprite_sheet" && asset.frames?.length ? await jitterOf(project, asset).catch(() => null) : null;
        const checks = [asset.palette ? describePalette(asset.palette) : "", seams ? describeSeams(seams) : "", jitter ? describeJitter(jitter) : ""];
        return withImage(
          block.id,
          [`asset_id=${asset.id} name=${asset.name}. Review it against the references now.`, ...checks].filter(Boolean).join("\n"),
          image.data,
          image.mime,
        );
      } catch (err) {
        if (job.abort.signal.aborted) throw err;
        if (err instanceof BudgetExceededError) {
          return errResult(
            block.id,
            `BUDGET_EXHAUSTED: ${err.message}. The user's budget for this run is used up. Do not call generate_image again; review what exists and finish with a summary that lists the assets you could not make.`,
          );
        }
        return errResult(block.id, `Image generation failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    case "review_asset": {
      const parsed = ReviewInput.safeParse(block.input);
      if (!parsed.success) return invalid();
      let updated: Asset | undefined;
      await updateProject(job.projectId, (p) => {
        updated = p.assets.find((a) => a.id === parsed.data.asset_id);
        if (!updated) return;
        updated.status = parsed.data.verdict;
        updated.score = parsed.data.consistency_score;
        updated.notes = parsed.data.notes;
        updated.reviewer = "agent";
      });
      if (!updated) return errResult(block.id, `Unknown asset_id ${parsed.data.asset_id}`);
      emit(job, { type: "asset", asset: updated });
      return { type: "tool_result", tool_use_id: block.id, content: "Recorded." };
    }
    case "fix_tile_seams": {
      const parsed = FixSeamsInput.safeParse(block.input);
      if (!parsed.success) return invalid();
      const found = await findAssetFor(job, parsed.data.asset_id);
      if (!found) return errResult(block.id, `Unknown asset_id ${parsed.data.asset_id}`);
      if (found.asset.assetType !== "tile") return errResult(block.id, "fix_tile_seams only applies to tile assets.");
      const r = await seamlessVersion(found.project, found.asset, parsed.data.overlap ?? 0.15, { by: "agent", runId: job.id });
      emit(job, { type: "asset", asset: r.asset });
      return withImage(
        block.id,
        `New version asset_id=${r.asset.id} (from ${found.asset.id}). Before: ${describeSeams(r.before)}\nAfter: ${describeSeams(r.after)}\nReview the new version; reject the old one if the new one is better.`,
        await readProjectFile(found.project.id, r.asset.file),
        r.asset.mime,
      );
    }
    case "align_sprite_frames": {
      const parsed = AlignFramesInput.safeParse(block.input);
      if (!parsed.success) return invalid();
      const found = await findAssetFor(job, parsed.data.asset_id);
      if (!found) return errResult(block.id, `Unknown asset_id ${parsed.data.asset_id}`);
      if (found.asset.assetType !== "sprite_sheet") return errResult(block.id, "align_sprite_frames only applies to sprite_sheet assets.");
      const r = await alignedVersion(found.project, found.asset, parsed.data.mode ?? "bottom", { by: "agent", runId: job.id });
      emit(job, { type: "asset", asset: r.asset });
      return withImage(
        block.id,
        `New version asset_id=${r.asset.id} (from ${found.asset.id}). Jitter before: ${r.before.horizontal}px / ${r.before.vertical}px, after: ${r.after.horizontal}px / ${r.after.vertical}px. Review the new version.`,
        await readProjectFile(found.project.id, r.asset.file),
        r.asset.mime,
      );
    }
    case "remove_background": {
      const parsed = RemoveBackgroundInput.safeParse(block.input);
      if (!parsed.success) return invalid();
      const found = await findAssetFor(job, parsed.data.asset_id);
      if (!found) return errResult(block.id, `Unknown asset_id ${parsed.data.asset_id}`);
      const updated = await cutoutAsset(found.project, found.asset, { tolerance: parsed.data.tolerance });
      emit(job, { type: "asset", asset: updated });
      return withImage(
        block.id,
        `Background re-cut for asset_id=${updated.id} with tolerance ${parsed.data.tolerance ?? 28} (shown on white; transparent areas appear white). Check for halo or missing pixels.`,
        await readProjectFile(found.project.id, updated.file),
        updated.mime,
      );
    }
    default:
      return errResult(block.id, `Unknown tool ${block.name}`);
  }
}
