/** The asset categories the agent can produce, with their display labels. */
export const ASSET_TYPES = {
  character: "角色立绘 / 角色设定",
  sprite_sheet: "角色动画帧（精灵表）",
  enemy: "敌人 / 怪物",
  item_icon: "道具 / 装备图标",
  tile: "地图瓦片 / 地形",
  prop: "场景物件",
  background: "场景背景",
  ui: "UI 元素（按钮、面板、图标）",
  vfx: "技能特效",
  portrait: "头像 / 对话立绘",
} as const;

export type AssetType = keyof typeof ASSET_TYPES;
export const ASSET_TYPE_KEYS = Object.keys(ASSET_TYPES) as [AssetType, ...AssetType[]];
// Own keys only: `in` would also accept inherited names like "constructor" or "toString".
export const isAssetType = (t: string): t is AssetType => Object.hasOwn(ASSET_TYPES, t);

/** Types that are drawn edge-to-edge rather than as a cut-out subject. */
export const isOpaqueType = (t: string) => t === "background" || t === "tile";
