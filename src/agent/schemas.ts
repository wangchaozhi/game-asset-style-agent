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
  fps: z.number().int().min(1).max(30).optional(),
  replaces_asset_id: z.string().optional(),
  tags: z.array(z.string()).max(10).optional(),
});
export type GenerateInput = z.infer<typeof GenerateInput>;

export const ReviewInput = z.object({
  asset_id: z.string(),
  verdict: z.enum(["approved", "rejected"]),
  consistency_score: z.number().int().min(1).max(10),
  notes: z.string(),
});

export const FixSeamsInput = z.object({
  asset_id: z.string(),
  overlap: z.number().min(0.04).max(0.4).optional(),
});

export const AlignFramesInput = z.object({
  asset_id: z.string(),
  mode: z.enum(["bottom", "center"]).optional(),
});

export const RemoveBackgroundInput = z.object({
  asset_id: z.string(),
  tolerance: z.number().int().min(4).max(100).optional(),
});

export const SnapPaletteInput = z.object({
  asset_id: z.string(),
  dither: z.enum(["none", "ordered"]).optional(),
});

/** Margins are optional: without them the tool detects the stretchable band itself. */
export const NineSliceToolInput = z.object({
  asset_id: z.string(),
  left: z.number().int().min(0).optional(),
  top: z.number().int().min(0).optional(),
  right: z.number().int().min(0).optional(),
  bottom: z.number().int().min(0).optional(),
});

export const OutlineInput = z.object({
  asset_id: z.string(),
  width: z.number().int().min(1).max(16).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const RecolorInput = z.object({
  asset_id: z.string(),
  swaps: z.array(z.object({ from: z.string().regex(/^#[0-9a-fA-F]{6}$/), to: z.string().regex(/^#[0-9a-fA-F]{6}$/) })).min(1).max(8),
  name: z.string().max(80).optional(),
  threshold: z.number().min(5).max(60).optional(),
});

export const CheckConsistencyInput = z.object({
  limit: z.number().int().min(1).max(20).optional(),
});
