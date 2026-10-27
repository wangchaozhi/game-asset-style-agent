/** Common animation sets for a character: frame count and playback speed per action. */
export const ACTION_PRESETS = {
  idle: { label: "待机", frames: 4, fps: 6, motion: "idle breathing loop, standing in place, subtle up-and-down" },
  walk: { label: "行走", frames: 6, fps: 10, motion: "walk cycle seen from the side, alternating legs, steady pace" },
  run: { label: "奔跑", frames: 6, fps: 12, motion: "run cycle seen from the side, longer stride, leaning forward" },
  attack: { label: "攻击", frames: 5, fps: 12, motion: "attack: wind-up, strike, follow-through, recover" },
  hurt: { label: "受击", frames: 3, fps: 10, motion: "hit reaction: flinch backwards and recover" },
  jump: { label: "跳跃", frames: 4, fps: 10, motion: "jump: crouch, take off, airborne, land" },
  death: { label: "倒下", frames: 6, fps: 8, motion: "defeat: stagger and fall to the ground, last frame lying still" },
} as const;

export type ActionKey = keyof typeof ACTION_PRESETS;
export const isActionKey = (k: unknown): k is ActionKey => typeof k === "string" && k in ACTION_PRESETS;

/** Asset types an action set can be made for. */
export const ACTION_SET_TYPES = new Set(["character", "enemy"]);

/**
 * The request for the agent: one sprite sheet per action, all with the source asset as the
 * consistency reference and tagged with its name, so the set reads as one character and groups together.
 */
export function actionSetRequest(asset: { id: string; name: string }, actions: ActionKey[]): string {
  const lines = actions.map((k) => {
    const p = ACTION_PRESETS[k];
    return `- 「${asset.name}·${p.label}」: sprite_sheet, frames=${p.frames}, fps=${p.fps} — ${p.motion}`;
  });
  return [
    `为角色「${asset.name}」（素材 ${asset.id}）制作一套动作精灵表，共 ${actions.length} 张：`,
    ...lines,
    `Every sheet: pass consistency_asset_ids=["${asset.id}"] and tags=["${asset.name}"]; keep exactly the same character design, colours, scale and ground baseline in every frame and across all sheets; frames evenly spaced in one horizontal row; transparent background.`,
  ].join("\n");
}
