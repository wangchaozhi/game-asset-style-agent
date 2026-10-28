import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { ASSET_TYPES, type AssetType, isAssetType } from "./domain/assetTypes.js";

/**
 * Language of server-generated text (asset notes, drift reasons, skip reasons): the request's
 * `?lang=` or Accept-Language, carried through the request's async work (including runs it starts)
 * so deep helpers can call msg() without threading a parameter. Chinese when nothing says otherwise.
 */
export type Lang = "zh" | "en";

const store = new AsyncLocalStorage<Lang>();

/** The first supported language in a `?lang=` value or an Accept-Language header; Chinese otherwise. */
export function langOf(value: unknown): Lang {
  for (const part of String(value ?? "").split(",")) {
    const base = part.trim().split(";")[0].toLowerCase().split("-")[0];
    if (base === "zh" || base === "en") return base;
  }
  return "zh";
}

export const currentLang = (): Lang => store.getStore() ?? "zh";

/** Run `fn` with server text in `lang`. */
export const withLang = <T>(lang: Lang, fn: () => T): T => store.run(lang, fn);

export function langMiddleware(req: Request, _res: Response, next: NextFunction) {
  const q = typeof req.query.lang === "string" ? req.query.lang : undefined;
  store.run(langOf(q ?? req.headers["accept-language"]), next);
}

const zh = {
  "drift.coverage": "色板内像素 {coverage}，低于项目中位数 {median}",
  "drift.deltaE": "平均色差 ΔE {de}，高于项目中位数 {median}",
  "drift.score": "Agent 一致性评分 {score}/10",
  "drift.offPalette": "主要色板外颜色 {hex}（{share}）",
  "note.seamless": "由「{name}」无缝化处理（边缘融合 {overlap}%）",
  "note.alignBottom": "由「{name}」对齐帧（底边居中）：水平抖动 {h0}→{h1}px，底边 {v0}→{v1}px",
  "note.alignCenter": "由「{name}」对齐帧（中心）：水平抖动 {h0}→{h1}px，垂直 {v0}→{v1}px",
  "note.snapOrdered": "由「{name}」吸附到色板（有序抖动）：色板内像素 {before}→{after}",
  "note.snapNone": "由「{name}」吸附到色板（不抖动）：色板内像素 {before}→{after}",
  "note.outline": "由「{name}」加 {width}px 描边（{color}）",
  "note.recolor": "由「{name}」换色：{swaps}",
  "note.listSep": "，",
  "note.variantName": "{name}（变体）",
  "note.imported": "导入的素材",
  "note.demoApproved": "演示模式自动通过",
  "import.defaultName": "导入的素材",
  "skip.missing": "素材不存在",
  "skip.opaqueCutout": "背景和瓦片铺满画面，不需要去背景",
  "backup.ref": "参考图 {id}",
  "backup.asset": "素材 {name}",
  "backup.badStyle": "风格指南（格式无效）",
  "status.approved": "已通过",
  "status.rejected": "已驳回",
  "status.pending_review": "待审核",
  "csv.header": "排名|素材 id|名称|类型|状态|色板内占比|平均色差 ΔE|偏离度|原因",
  "csv.reasonSep": "；",
  "csv.fileSuffix": "一致性",
} as const;

export type MsgKey = keyof typeof zh;

/** Same keys as zh, enforced by the type: a missing translation fails the build. */
const en: Record<MsgKey, string> = {
  "drift.coverage": "{coverage} of pixels in palette, below the project median {median}",
  "drift.deltaE": "mean colour difference ΔE {de}, above the project median {median}",
  "drift.score": "agent consistency score {score}/10",
  "drift.offPalette": "main off-palette colour {hex} ({share})",
  "note.seamless": "Made seamless from \"{name}\" (edge blend {overlap}%)",
  "note.alignBottom": "Frames of \"{name}\" aligned (bottom centre): horizontal jitter {h0}→{h1}px, bottom {v0}→{v1}px",
  "note.alignCenter": "Frames of \"{name}\" aligned (centre): horizontal jitter {h0}→{h1}px, vertical {v0}→{v1}px",
  "note.snapOrdered": "\"{name}\" snapped to the palette (ordered dither): in-palette pixels {before}→{after}",
  "note.snapNone": "\"{name}\" snapped to the palette (no dither): in-palette pixels {before}→{after}",
  "note.outline": "{width}px outline ({color}) added to \"{name}\"",
  "note.recolor": "Recoloured from \"{name}\": {swaps}",
  "note.listSep": ", ",
  "note.variantName": "{name} (variant)",
  "note.imported": "Imported asset",
  "note.demoApproved": "Approved automatically in demo mode",
  "import.defaultName": "Imported asset",
  "skip.missing": "asset not found",
  "skip.opaqueCutout": "backgrounds and tiles fill the canvas; no background to remove",
  "backup.ref": "reference {id}",
  "backup.asset": "asset {name}",
  "backup.badStyle": "style guide (invalid format)",
  "status.approved": "Approved",
  "status.rejected": "Rejected",
  "status.pending_review": "Pending",
  "csv.header": "Rank|Asset id|Name|Type|Status|In palette|Mean ΔE|Drift|Reasons",
  "csv.reasonSep": "; ",
  "csv.fileSuffix": "consistency",
};

export const MESSAGES: Record<Lang, Record<MsgKey, string>> = { zh, en };

/** English asset type labels; the Chinese ones live with the types (ASSET_TYPES). */
const TYPE_EN: Record<AssetType, string> = {
  character: "Character art / design",
  sprite_sheet: "Animation frames (sprite sheet)",
  enemy: "Enemy / monster",
  item_icon: "Item / gear icon",
  tile: "Map tile / terrain",
  prop: "Scene prop",
  background: "Background",
  ui: "UI element (button, panel, icon)",
  vfx: "Skill effect",
  portrait: "Avatar / dialogue portrait",
};

/** An asset type's label in the current language; unknown types as they are. */
export function assetTypeLabel(type: string): string {
  if (!isAssetType(type)) return type;
  return currentLang() === "en" ? TYPE_EN[type] : ASSET_TYPES[type];
}

/** Server text for `key` in the current request's language, with {name} placeholders filled. */
export function msg(key: MsgKey, vars?: Record<string, string | number>): string {
  const s = MESSAGES[currentLang()][key];
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}
