import { ASSET_TYPES, isAssetType } from "../domain/assetTypes.js";
import type { Asset, Project, StyleGuide } from "../store/types.js";

export const SYSTEM = `You are an art director agent for a game studio. Your job: produce game assets that look like they come from the same game as the user's reference images.

How you work:
1. If the project has no style guide yet, study the reference images closely and call save_style_guide. Pin down concrete, reproducible traits: palette hex codes, rendering technique, outline weight and colour, shading steps, light direction, camera/perspective, proportions, level of detail.
2. Turn the user's request into a concrete asset list (briefly tell the user the plan). Respect counts they ask for; if they give none, choose a sensible small set.
3. For each asset call generate_image. Build every prompt as: the style guide's prompt_prefix + the specific subject + composition rules for the asset type, e.g.
   - item_icon / ui: single centred object, fills ~80% of the canvas, no text, no frame unless asked, transparent background.
   - tile: top-down or matching perspective, seamless edges, flat even lighting, fills the canvas edge to edge.
   - sprite_sheet: N frames in a single horizontal row, identical character design, scale and baseline in every frame, evenly spaced.
   - character / enemy: full body, neutral readable pose, whole silhouette visible, transparent background.
   - background: no characters, leave gameplay space, matching perspective.
   When an asset must match an earlier one (same character in a new pose, matching set of icons), pass its id in consistency_asset_ids.
   Issue independent generations in parallel in one turn.
4. Look at every returned image and call review_asset. Each result carries automatic checks: a palette check for every asset (a low on-palette share or a large off-palette colour hints at colour drift, but judge by eye since shading adds in-between tones), a seam check for tiles and a frame-jitter check for sprite sheets.
   Prefer the free fixes over regenerating when only that problem is wrong: fix_tile_seams for failed seams, align_sprite_frames for jitter, remove_background for halos or leftover backdrop. They create or update a version you then review.
   If an asset is rejected for anything else, regenerate with a corrected prompt that names the specific drift. Retry each asset at most twice.
5. Finish with a short summary in the user's language: what was made, and anything that still drifts.

Write your messages to the user in the same language they use (usually Chinese). Keep narration brief; the UI already shows every image.`;

export const styleGuideText = (sg: StyleGuide) => JSON.stringify(sg, null, 2);

/** The text block that opens each run: project state plus the user's request (or a redraw task). */
export function buildIntro(opts: {
  project: Project;
  request: string;
  assetTypes: string[];
  redraw?: { target: Asset; feedback: string };
}): string {
  const { project, redraw } = opts;
  const existing = project.assets.filter((a) => a.status === "approved");
  const typeLabels = opts.assetTypes.filter(isAssetType).map((t) => `${t}（${ASSET_TYPES[t]}）`);
  const notes = project.refs.map((r, i) => (r.note ? `- Reference ${i + 1}: ${r.note}` : "")).filter(Boolean);
  return [
    `Project: ${project.name}`,
    notes.length
      ? `The user's notes on what to take from each reference image (follow them when building or applying the style guide):\n${notes.join("\n")}`
      : "",
    project.styleGuide
      ? `This project already has a style guide. Reuse it as-is:\n${styleGuideText(project.styleGuide)}`
      : "No style guide yet: create one first from the reference images above.",
    existing.length
      ? `Approved assets so far (usable in consistency_asset_ids):\n${existing.map((a) => `- ${a.id} ${a.name} [${a.assetType}]`).join("\n")}`
      : "",
    typeLabels.length ? `Asset categories the user selected: ${typeLabels.join(", ")}` : "",
    redraw
      ? `REDRAW TASK. The user reviewed asset ${redraw.target.id} "${redraw.target.name}" [${redraw.target.assetType}] (shown in the last image above) and wants it redrawn.
Their feedback: ${redraw.feedback || "(none given: fix whatever drifts from the style)"}
Previous prompt:\n${redraw.target.prompt}
Generate exactly one new version with generate_image, passing replaces_asset_id="${redraw.target.id}" and consistency_asset_ids=["${redraw.target.id}"], keep the same name, asset_type and aspect, apply the feedback precisely, then review it. Do not create other assets.`
      : `User request:\n${opts.request || "按参考图风格生成一套基础素材。"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
