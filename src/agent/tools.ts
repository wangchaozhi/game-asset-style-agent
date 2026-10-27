import type Anthropic from "@anthropic-ai/sdk";
import { ASSET_TYPE_KEYS } from "../domain/assetTypes.js";

/** Tool definitions sent to Claude. Inputs are validated with ./schemas.ts before running. */
export const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: "save_style_guide",
    description:
      "Persist the project's style bible, distilled from the reference images. Every later generation prompt is built on it, so be concrete and visual (e.g. '2px dark-purple outline, cel shading with exactly 2 tones, 3/4 top-down camera, 1:2.5 head-to-body chibi proportions') rather than vague ('nice, colorful'). Call again only if the user asks to change the style.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One or two sentences naming the overall style, in the user's language." },
        palette: {
          type: "array",
          description: "5-10 dominant colours sampled from the references.",
          items: {
            type: "object",
            properties: { hex: { type: "string", description: "#RRGGBB" }, role: { type: "string" } },
            required: ["hex", "role"],
          },
        },
        rendering: { type: "string", description: "Medium / technique: pixel art (state the pixel density), vector flat, hand-painted, 3D render, etc." },
        line_and_edges: { type: "string" },
        lighting_and_shading: { type: "string" },
        perspective: { type: "string", description: "Camera angle and projection, e.g. side-view, isometric 2:1, top-down 3/4." },
        proportions: { type: "string" },
        texture_and_detail: { type: "string" },
        mood: { type: "string" },
        avoid: { type: "array", items: { type: "string" }, description: "Things that would break the style." },
        prompt_prefix: {
          type: "string",
          description: "An English style paragraph (60-120 words) to prepend to every image prompt. Must include the palette hex codes.",
        },
      },
      required: [
        "summary", "palette", "rendering", "line_and_edges", "lighting_and_shading", "perspective",
        "proportions", "texture_and_detail", "mood", "avoid", "prompt_prefix",
      ],
    },
  },
  {
    name: "generate_image",
    description:
      "Generate one game asset with the image model. The project's style reference images are attached automatically; you write the full English prompt. Returns the asset id and the rendered image so you can inspect it. Several calls in one turn run in parallel.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short display name in the user's language, e.g. '火焰剑'." },
        asset_type: { type: "string", enum: ASSET_TYPE_KEYS },
        prompt: {
          type: "string",
          description: "Complete English prompt: style prefix + subject + composition rules for this asset type + what to avoid.",
        },
        aspect: { type: "string", enum: ["square", "landscape", "portrait"] },
        transparent_background: { type: "boolean", description: "true for icons, sprites, props, UI, VFX; false for backgrounds and tiles." },
        consistency_asset_ids: {
          type: "array",
          items: { type: "string" },
          description: "Up to 4 previously generated asset ids to also attach as references, e.g. the approved character design when drawing its sprite sheet or portrait.",
        },
        replaces_asset_id: {
          type: "string",
          description: "When this is a redraw of an existing asset, its id (links the versions).",
        },
        frames: {
          type: "integer",
          description: "sprite_sheet only: number of animation frames in the single horizontal row (2-16). The sheet is sliced into frames and a GIF preview automatically.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional short labels to group the asset, in the user's language — e.g. the level, set or character the user named (\"第一关\", \"小狐狸\"). Redraws keep the original's tags automatically.",
        },
      },
      required: ["name", "asset_type", "prompt", "aspect", "transparent_background"],
    },
  },
  {
    name: "review_asset",
    description:
      "Record your verdict on a generated asset after comparing it to the reference images and style guide. Reject when palette, rendering technique, line work, perspective or proportions drift, or when the asset is unusable for its type (cropped, text artefacts, wrong background, inconsistent character).",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        asset_id: { type: "string" },
        verdict: { type: "string", enum: ["approved", "rejected"] },
        consistency_score: { type: "integer", description: "1-10 style consistency with the references." },
        notes: { type: "string", description: "Short reason in the user's language." },
      },
      required: ["asset_id", "verdict", "consistency_score", "notes"],
    },
  },
  {
    name: "fix_tile_seams",
    description:
      "Make a tile wrap seamlessly by cross-fading its edges (no image-model call, no cost). Use it when a tile's seam check fails instead of regenerating. Creates a new version of the asset (pending review) and returns its asset_id, the seam check before/after and the image; review the new version.",
    input_schema: {
      type: "object",
      properties: {
        asset_id: { type: "string" },
        overlap: { type: "number", description: "Share of each edge to blend, 0.04-0.4 (default 0.15). Larger hides stronger seams but softens more of the tile." },
      },
      required: ["asset_id"],
    },
  },
  {
    name: "align_sprite_frames",
    description:
      "Remove jitter from a sprite sheet by shifting every frame so the character sits on the same anchor (no image-model call, no cost). Use it when a sprite sheet's jitter check shows more than ~3px. Creates a new version (pending review) with re-sliced frames and GIF; review the new version.",
    input_schema: {
      type: "object",
      properties: {
        asset_id: { type: "string" },
        mode: { type: "string", enum: ["bottom", "center"], description: "bottom: feet on one baseline (characters, enemies). center: floating things (VFX, projectiles)." },
      },
      required: ["asset_id"],
    },
  },
  {
    name: "remove_background",
    description:
      "Re-cut the flat background of an asset that should be transparent, in place (no image-model call). Use it when leftover background or a halo remains, or when too much of the subject was cut away; the untouched model output is always kept, so you can retry with another tolerance.",
    input_schema: {
      type: "object",
      properties: {
        asset_id: { type: "string" },
        tolerance: { type: "integer", description: "Colour distance treated as background, 4-100 (default 28). Raise it for leftover halo, lower it if the subject loses pixels." },
      },
      required: ["asset_id"],
    },
  },
  {
    name: "snap_to_palette",
    description:
      "Recolour an asset so every pixel uses the nearest style-palette colour (no image-model call, no cost). Use it when the palette check shows clear off-palette colours in a flat, cel-shaded or pixel-art style with a strict palette. Avoid it for painterly or gradient-heavy styles, where it causes banding. Creates a new version (pending review) and returns palette coverage before/after; review the new version.",
    input_schema: {
      type: "object",
      properties: {
        asset_id: { type: "string" },
        dither: { type: "string", enum: ["none", "ordered"], description: "none: hard snap (pixel art, flat colour). ordered: Bayer dithering keeps some sense of gradients." },
      },
      required: ["asset_id"],
    },
  },
  {
    name: "set_nine_slice",
    description:
      "Save 9-slice margins on a ui asset that will be stretched in-game (panels, dialog frames, buttons, bars), so exports carry them for Godot and Phaser. Omit the margins to detect the stretchable centre automatically; give them (pixels of the full image) to set them yourself. Saves in place (no new version, no cost) and returns the asset stretched wider and taller: check that corners and ornaments stay intact and only flat areas stretch.",
    input_schema: {
      type: "object",
      properties: {
        asset_id: { type: "string" },
        left: { type: "integer", description: "Pixels from the left edge that never stretch (corner width)." },
        top: { type: "integer" },
        right: { type: "integer" },
        bottom: { type: "integer" },
      },
      required: ["asset_id"],
    },
  },
];
