import type Anthropic from "@anthropic-ai/sdk";
import { imageSize, shrink } from "../image/io.js";
import { detectNineSlice, stretchNineSlice } from "../image/nineSlice.js";
import { dominantColors } from "../image/recolor.js";
import { isPixelArt } from "../image/sizes.js";
import { describePalette } from "../image/palette.js";
import type { Jitter } from "../image/spriteSheet.js";
import type { SeamReport } from "../image/tiles.js";
import { alignedVersion, cutoutAsset, jitterOf, paletteSnapVersion, outlineVersion, recolorVariant, seamlessVersion, seamsOf, setNineSlice } from "../ops/assetOps.js";
import type { ImageProvider } from "../providers/types.js";
import { loadProject, readProjectFile, recordStyleVersion, updateProject } from "../store/index.js";
import type { Asset, Project } from "../store/types.js";
import { measureConsistency } from "../ops/consistency.js";
import { generateAsset } from "./assets.js";
import { BudgetExceededError } from "./budget.js";
import { type Job, emit } from "./events.js";
import {
  AlignFramesInput, CheckConsistencyInput, FixSeamsInput, GenerateInput, NineSliceToolInput, OutlineInput, RecolorInput, RemoveBackgroundInput, ReviewInput, SnapPaletteInput, StyleGuideInput,
} from "./schemas.js";

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
    case "snap_to_palette": {
      const parsed = SnapPaletteInput.safeParse(block.input);
      if (!parsed.success) return invalid();
      const found = await findAssetFor(job, parsed.data.asset_id);
      if (!found) return errResult(block.id, `Unknown asset_id ${parsed.data.asset_id}`);
      if (!found.project.styleGuide?.palette.length) return errResult(block.id, "There is no style guide palette yet; call save_style_guide first.");
      const r = await paletteSnapVersion(found.project, found.asset, parsed.data.dither ?? "none", { by: "agent", runId: job.id });
      emit(job, { type: "asset", asset: r.asset });
      const pct = (x: number) => `${Math.round(x * 100)}%`;
      return withImage(
        block.id,
        `New version asset_id=${r.asset.id} (from ${found.asset.id}). On-palette pixels ${pct(r.before.coverage)} → ${pct(r.after.coverage)}. Check for banding or lost detail, then review the new version.`,
        await readProjectFile(found.project.id, r.asset.file),
        r.asset.mime,
      );
    }
    case "add_outline": {
      const parsed = OutlineInput.safeParse(block.input);
      if (!parsed.success) return invalid();
      const found = await findAssetFor(job, parsed.data.asset_id);
      if (!found) return errResult(block.id, `Unknown asset_id ${parsed.data.asset_id}`);
      const width = parsed.data.width ?? 2;
      const r = await outlineVersion(found.project, found.asset, { width, color: parsed.data.color }, { by: "agent", runId: job.id });
      if (typeof r === "string") return errResult(block.id, r);
      emit(job, { type: "asset", asset: r });
      return withImage(
        block.id,
        `New version asset_id=${r.id} (from ${found.asset.id}) with a ${width}px outline. Check it is even and doesn't swallow small details, then review the new version.`,
        await readProjectFile(found.project.id, r.file),
        r.mime,
      );
    }
    case "recolor_variant": {
      const parsed = RecolorInput.safeParse(block.input);
      if (!parsed.success) return invalid();
      const found = await findAssetFor(job, parsed.data.asset_id);
      if (!found) return errResult(block.id, `Unknown asset_id ${parsed.data.asset_id}`);
      const { swaps, name, threshold } = parsed.data;
      const r = await recolorVariant(found.project, found.asset, { swaps, name, threshold }, { by: "agent", runId: job.id });
      if (typeof r === "string") return errResult(block.id, r);
      emit(job, { type: "asset", asset: r });
      const main = (await dominantColors(await readProjectFile(found.project.id, found.asset.file))).map((c) => `${c.hex} ${Math.round(c.share * 100)}%`).join(", ");
      return withImage(
        block.id,
        `New variant asset_id=${r.id} "${r.name}" (of ${found.asset.id}). The original's main colours: ${main}. If some shades of a colour didn't change, retry with a higher threshold or add that shade as another swap. Review the variant.`,
        await readProjectFile(found.project.id, r.file),
        r.mime,
      );
    }
    case "check_consistency": {
      const parsed = CheckConsistencyInput.safeParse(block.input ?? {});
      if (!parsed.success) return invalid();
      const project = await loadProject(job.projectId);
      const report = await measureConsistency(project, { tag: parsed.data.tag });
      if (!report) return errResult(block.id, "There is no style guide palette yet; call save_style_guide first.");
      const byId = new Map(project.assets.map((a) => [a.id, a]));
      const pct = (x: number) => `${Math.round(x * 100)}%`;
      const drifting = report.items.filter((i) => i.reasons.length).slice(0, parsed.data.limit ?? 8);
      const lines = drifting.map((i) => {
        const a = byId.get(i.id)!;
        const mine = a.runId === job.id ? " (made in this run)" : "";
        return `- ${a.id} "${a.name}" [${a.assetType}]${mine}: drift ${i.drift} — ${i.reasons.join("; ")}`;
      });
      return {
        type: "tool_result",
        tool_use_id: block.id,
        content: [
          `Measured ${report.items.length} current assets${parsed.data.tag ? ` tagged "${parsed.data.tag}"` : ""}. ${parsed.data.tag ? "Group" : "Project"} median: on-palette ${pct(report.medianCoverage)}, mean ΔE ${Math.round(report.medianDeltaE * 10) / 10}.`,
          drifting.length ? `Clearly drifting, most first:\n${lines.join("\n")}` : "No asset clearly drifts from the rest of the set.",
        ].join("\n"),
      };
    }
    case "set_nine_slice": {
      const parsed = NineSliceToolInput.safeParse(block.input);
      if (!parsed.success) return invalid();
      const found = await findAssetFor(job, parsed.data.asset_id);
      if (!found) return errResult(block.id, `Unknown asset_id ${parsed.data.asset_id}`);
      if (found.asset.assetType !== "ui") return errResult(block.id, "set_nine_slice only applies to ui assets.");
      const data = await readProjectFile(found.project.id, found.asset.file);
      const size = await imageSize(data);
      const { left, top, right, bottom } = parsed.data;
      const given = [left, top, right, bottom].filter((v) => v !== undefined).length;
      if (given && given < 4) return errResult(block.id, "Give all four margins, or none to detect them.");
      const margins = given ? { left: left!, top: top!, right: right!, bottom: bottom! } : await detectNineSlice(data);
      if (!margins) {
        return errResult(
          block.id,
          `No stretchable band found automatically (image ${size.width}×${size.height}). If this asset should stretch, look at it and pass the four margins yourself; if its centre isn't flat enough to stretch, regenerate it with a plain centre.`,
        );
      }
      const updated = await setNineSlice(found.project, found.asset, margins);
      if (typeof updated === "string") return errResult(block.id, `${updated} (image ${size.width}×${size.height}).`);
      emit(job, { type: "asset", asset: updated });
      const m = updated.nineSlice!;
      const preview = await stretchNineSlice(data, m, size.width * 2, Math.round(size.height * 1.5), isPixelArt(found.project.styleGuide));
      return withImage(
        block.id,
        `Saved 9-slice margins on asset_id=${updated.id}${given ? "" : " (detected)"}: left ${m.left}, top ${m.top}, right ${m.right}, bottom ${m.bottom} of ${size.width}×${size.height}. The image below is the asset stretched to 2× width and 1.5× height; if corners or ornaments got distorted, call again with corrected margins.`,
        preview,
        "image/png",
      );
    }
    default:
      return errResult(block.id, `Unknown tool ${block.name}`);
  }
}
