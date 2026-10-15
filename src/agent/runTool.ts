import type Anthropic from "@anthropic-ai/sdk";
import { shrink } from "../image/io.js";
import { describePalette } from "../image/palette.js";
import type { ImageProvider } from "../providers/types.js";
import { recordStyleVersion, updateProject } from "../store/index.js";
import type { Asset } from "../store/types.js";
import { generateAsset } from "./assets.js";
import { BudgetExceededError } from "./budget.js";
import { type Job, emit } from "./events.js";
import { GenerateInput, ReviewInput, StyleGuideInput } from "./schemas.js";

type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

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
        const preview = await shrink(image, 768);
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: [
            {
              type: "text",
              text: [
                `asset_id=${asset.id} name=${asset.name}. Review it against the references now.`,
                asset.palette ? describePalette(asset.palette) : "",
              ].filter(Boolean).join("\n"),
            },
            {
              type: "image",
              source: { type: "base64", media_type: preview.mime as "image/jpeg", data: preview.data.toString("base64") },
            },
          ],
        };
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
    default:
      return errResult(block.id, `Unknown tool ${block.name}`);
  }
}
