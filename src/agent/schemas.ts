import { z } from "zod";
import { ASSET_TYPE_KEYS } from "../domain/assetTypes.js";

/** Runtime validation for tool inputs (the model's JSON) and for the style-guide edit API. */

export const StyleGuideInput = z.object({
  summary: z.string().min(1),
  palette: z.array(z.object({ hex: z.string().regex(/^#[0-9a-fA-F]{6}$/), role: z.string() })).min(3),
  rendering: z.string(),
  line_and_edges: z.string(),
  lighting_and_shading: z.string(),
  perspective: z.string(),
  proportions: z.string(),
  texture_and_detail: z.string(),
  mood: z.string(),
  avoid: z.array(z.string()),
  prompt_prefix: z.string().min(20),
});

export const GenerateInput = z.object({
  name: z.string().min(1),
  asset_type: z.enum(ASSET_TYPE_KEYS),
  prompt: z.string().min(20),
  aspect: z.enum(["square", "landscape", "portrait"]),
  transparent_background: z.boolean(),
  consistency_asset_ids: z.array(z.string()).max(4).optional(),
  frames: z.number().int().min(2).max(16).optional(),
  replaces_asset_id: z.string().optional(),
});
export type GenerateInput = z.infer<typeof GenerateInput>;

export const ReviewInput = z.object({
  asset_id: z.string(),
  verdict: z.enum(["approved", "rejected"]),
  consistency_score: z.number().int().min(1).max(10),
  notes: z.string(),
});
