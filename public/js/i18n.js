// Interface language: Chinese (default) and English. Static text in index.html is marked with
// data-i18n (text), data-i18n-title, data-i18n-placeholder and data-i18n-aria (aria-label);
// scripts use t(key, vars) when they render. The choice is remembered per browser.

const KEY = "gaa.lang";

export const DICT = {
  zh: {
    "app.tagline": "上传风格参考图 → AI 美术总监提炼风格 → 批量生成风格一致的游戏素材",
    "lang.switch": "English",
    "lang.switchTitle": "Switch the interface to English",
    "project.select": "选择项目",
    "project.usage": "用量",
    "project.usageTitle": "项目进度、Claude tokens 与图像调用统计",
    "project.new": "新建项目",
    "project.styleSheet": "风格说明书",
    "project.styleSheetTitle": "单页 HTML：色板、画风规则、参考图与素材样例，可发给外包或打印",
    "project.backup": "备份",
    "project.backupTitle": "导出整个项目（参考图、风格指南、素材、对话、用量）",
    "project.import": "导入",
    "project.importTitle": "从备份 zip 恢复为一个新项目",
    "project.delete": "删除",
    "project.deleteTitle": "删除当前项目",
    "project.logout": "退出登录",

    "style.heading": "① 风格参考",
    "style.drop": "拖入或点击上传参考图（最多 8 张）",
    "style.dropHint": "截图、原画、已有素材都可以，越能代表目标风格越好",
    "style.guide": "风格指南",
    "style.edit": "编辑",
    "style.fill": "手动填写",
    "style.reset": "重新提炼",
    "style.history": "历史",
    "style.historyTitle": "查看与恢复以前的风格指南",
    "style.empty": "还没有风格指南，第一次运行时 Agent 会根据参考图自动生成。",
    "style.conventions": "项目约定",
    "style.conventionsHint": "团队自己的美术规范，每次运行都会发给 Claude，也会写进风格说明书。",
    "style.conventionsPlaceholder": "例如：图标统一 2px 深色描边；角色正面 3/4 视角；不要文字和边框；UI 面板中心保持平整，方便九宫格拉伸。",
    "style.saveConventions": "保存约定",

    "run.heading": "② 描述需求",
    "run.placeholder": "例如：为一个蘑菇森林关卡做 6 个道具图标（回血蘑菇、毒蘑菇、木剑、铁盾、金币、钥匙），再做主角小狐狸的立绘和 4 帧走路动画。",
    "run.provider": "图像模型",
    "run.continue": "延续对话",
    "run.continueTitle": "Agent 会记得本项目之前的需求与结果，可以说「把刚才的剑改成蓝色」",
    "run.budget": "预算",
    "run.budgetTitle": "单次运行的上限，达到后不再生成新图",
    "run.budgetImages": "图像次数上限",
    "run.budgetUsd": "费用上限（美元）",
    "run.budgetHint": "留空用默认值，填 0 表示不限",
    "run.start": "开始生成",
    "run.running": "生成中…",
    "run.stop": "停止",
    "run.log": "Agent 工作日志",
    "run.notify": "完成时通知",
    "run.notifyTitle": "页面不在前台时，运行结束后弹出系统通知",
    "run.thinking": "显示思考",
    "run.logEmpty": "运行后，这里会实时显示 Agent 的分析、计划、生成与审核过程。",
    "run.unconfigured": "（未配置）",

    "type.character": "角色立绘 / 角色设定",
    "type.sprite_sheet": "角色动画帧（精灵表）",
    "type.enemy": "敌人 / 怪物",
    "type.item_icon": "道具 / 装备图标",
    "type.tile": "地图瓦片 / 地形",
    "type.prop": "场景物件",
    "type.background": "场景背景",
    "type.ui": "UI 元素（按钮、面板、图标）",
    "type.vfx": "技能特效",
    "type.portrait": "头像 / 对话立绘",

    "lib.heading": "③ 素材库",
    "lib.exportApproved": "导出已通过 ZIP",
    "lib.exportMore": "更多导出…",
    "lib.import": "导入素材…",
    "lib.importTitle": "上传自己的图片作为素材，可用全部后处理与导出",
    "lib.scene": "场景拼版",
    "lib.sceneTitle": "把已通过的素材摆到背景上，看整体是否协调",
    "lib.cleanup": "清理旧版本",
    "lib.cleanupTitle": "把已有通过新版本的旧版本移到回收站（可恢复）",
    "lib.consistency": "一致性总览",
    "lib.consistencyTitle": "按风格色板测量所有素材，找出最跑偏的",
    "filter.all": "全部",
    "filter.approved": "已通过",
    "filter.rejected": "已驳回",
    "filter.pending_review": "待审核",
    "filter.trash": "回收站",
    "filter.select": "选择",
    "filter.search": "搜索名称 / 意见 / prompt",
    "filter.searchLabel": "搜索素材",
    "filter.type": "按类型筛选",
    "filter.tag": "按标签筛选",
    "filter.allTypes": "全部类型（{n}）",
    "filter.allTags": "全部标签",
    "filter.byColor": "按颜色",
    "filter.byColorTitle": "按颜色找素材：列出主要使用该颜色的素材",
    "filter.clearColor": "清除颜色",
    "lib.emptyTrash": "回收站是空的",
    "lib.noMatch": "没有符合筛选的素材",
    "lib.empty": "生成的素材会出现在这里",
    "lib.more": "加载更多（还有 {n} 个）",
    "badge.approved": "✓ 通过",
    "badge.rejected": "✗ 驳回",
    "badge.pending_review": "… 审核中",
    "filter.trashN": "回收站 {n}",
    "filter.done": "完成",
    "filter.colorFound": "{n} 个素材使用了 {hex} 附近的颜色",
    "filter.colorNone": "没有素材明显使用 {hex}",
    "lib.shown": "显示 {shown} / {total}",
    "mark.frames": "{n} 帧",
    "mark.framesTitle": "精灵表，已切成 {n} 帧",
    "mark.nineSlice": "九宫格",
    "mark.nineSliceTitle": "已设置九宫格边距",
    "mark.colorTitle": "{hex} 附近颜色的像素占比",
    "mark.variant": "变体",
    "mark.variantTitle": "换色变体",
    "mark.old": "旧版本",
    "mark.oldTitle": "已有新版本",
    "batch.count": "已选 {n} 个",
    "batch.trashHint": "删除的素材保留 {n} 天，可选择后恢复",
    "batch.hint": "点击素材进行选择（Shift 连选）",
    "lib.purgeIn": "{n} 天后清除",
    "lib.deletedAt": "删除于 {when}",

    "batch.all": "全选",
    "batch.none": "清空",
    "batch.restore": "↺ 恢复",
    "batch.purge": "彻底删除",
    "batch.empty": "清空回收站",
    "batch.approve": "✓ 通过",
    "batch.reject": "✗ 驳回",
    "batch.redraw": "按意见重画",
    "batch.redrawTitle": "把所选素材连同各自的审核意见一次交给 Agent 重画（最多 10 个）",
    "batch.outline": "描边",
    "batch.outlineTitle": "给所选素材加 2px 描边（色板最深色），生成新版本",
    "batch.cutout": "去背景",
    "batch.cutoutTitle": "去除所选素材的背景（原地，可随时恢复原图）",
    "batch.snap": "吸附色板",
    "batch.snapTitle": "把所选素材的颜色吸附到风格色板，生成新版本",
    "batch.compare": "并排比较",
    "batch.compareTitle": "把所选的 2-6 个素材并排放大比较",
    "batch.tag": "+ 标签",
    "batch.tagTitle": "给所选素材加标签",
    "batch.rename": "批量改名",
    "batch.renameTitle": "按素材库顺序把所选素材改名为「前缀 + 序号」",
    "batch.untag": "− 标签",
    "batch.untagTitle": "从所选素材移除标签",
    "batch.zip": "导出 ZIP",
    "batch.atlas": "导出图集",
    "batch.delete": "删除",
  },
  en: {
    "app.tagline": "Upload style references → an AI art director distils the style → generate consistent game assets in batches",
    "lang.switch": "中文",
    "lang.switchTitle": "切换为中文界面",
    "project.select": "Choose a project",
    "project.usage": "Usage",
    "project.usageTitle": "Project progress, Claude tokens and image calls",
    "project.new": "New project",
    "project.styleSheet": "Style sheet",
    "project.styleSheetTitle": "One-page HTML: palette, art rules, references and sample assets, for outsourcers or print",
    "project.backup": "Backup",
    "project.backupTitle": "Export the whole project (references, style guide, assets, conversation, usage)",
    "project.import": "Import",
    "project.importTitle": "Restore a backup zip as a new project",
    "project.delete": "Delete",
    "project.deleteTitle": "Delete this project",
    "project.logout": "Sign out",

    "style.heading": "① Style references",
    "style.drop": "Drop or click to upload reference images (up to 8)",
    "style.dropHint": "Screenshots, concept art or existing assets — the closer to the target style the better",
    "style.guide": "Style guide",
    "style.edit": "Edit",
    "style.fill": "Write manually",
    "style.reset": "Re-extract",
    "style.history": "History",
    "style.historyTitle": "View and restore earlier style guides",
    "style.empty": "No style guide yet. On the first run the agent builds one from the references.",
    "style.conventions": "Project conventions",
    "style.conventionsHint": "Your team's own art rules. Sent to Claude on every run and included in the style sheet.",
    "style.conventionsPlaceholder": "e.g. 2px dark outline on all icons; characters in 3/4 front view; no text or frames; keep UI panel centres flat for nine-slice stretching.",
    "style.saveConventions": "Save conventions",

    "run.heading": "② Describe what you need",
    "run.placeholder": "e.g. Six item icons for a mushroom-forest level (healing mushroom, poison mushroom, wooden sword, iron shield, coin, key), plus a portrait of the fox hero and a 4-frame walk cycle.",
    "run.provider": "Image model",
    "run.continue": "Continue conversation",
    "run.continueTitle": "The agent remembers this project's earlier requests and results, so you can say \"make that sword blue\"",
    "run.budget": "Budget",
    "run.budgetTitle": "Limits for one run; no new images are generated once reached",
    "run.budgetImages": "Max image calls",
    "run.budgetUsd": "Max cost (USD)",
    "run.budgetHint": "Leave empty for the default, 0 for no limit",
    "run.start": "Generate",
    "run.running": "Generating…",
    "run.stop": "Stop",
    "run.log": "Agent log",
    "run.notify": "Notify when done",
    "run.notifyTitle": "Show a system notification when a run finishes while the page is in the background",
    "run.thinking": "Show thinking",
    "run.logEmpty": "Once a run starts, the agent's analysis, plan, generation and review appear here live.",
    "run.unconfigured": " (not configured)",

    "type.character": "Character art / design",
    "type.sprite_sheet": "Animation frames (sprite sheet)",
    "type.enemy": "Enemy / monster",
    "type.item_icon": "Item / gear icon",
    "type.tile": "Map tile / terrain",
    "type.prop": "Scene prop",
    "type.background": "Background",
    "type.ui": "UI element (button, panel, icon)",
    "type.vfx": "Skill effect",
    "type.portrait": "Avatar / dialogue portrait",

    "lib.heading": "③ Asset library",
    "lib.exportApproved": "Export approved ZIP",
    "lib.exportMore": "More exports…",
    "lib.import": "Import assets…",
    "lib.importTitle": "Upload your own images as assets, with every post-process and export",
    "lib.scene": "Scene mock-up",
    "lib.sceneTitle": "Arrange approved assets on a background to see whether they fit together",
    "lib.cleanup": "Clean up old versions",
    "lib.cleanupTitle": "Move old versions that have an approved newer version to the trash (restorable)",
    "lib.consistency": "Consistency overview",
    "lib.consistencyTitle": "Measure every asset against the style palette and find the ones that drift most",
    "filter.all": "All",
    "filter.approved": "Approved",
    "filter.rejected": "Rejected",
    "filter.pending_review": "Pending",
    "filter.trash": "Trash",
    "filter.select": "Select",
    "filter.search": "Search name / notes / prompt",
    "filter.searchLabel": "Search assets",
    "filter.type": "Filter by type",
    "filter.tag": "Filter by tag",
    "filter.allTypes": "All types ({n})",
    "filter.allTags": "All tags",
    "filter.byColor": "By colour",
    "filter.byColorTitle": "Find assets by colour: lists the assets that mainly use it",
    "filter.clearColor": "Clear colour",
    "lib.emptyTrash": "The trash is empty",
    "lib.noMatch": "No assets match the filters",
    "lib.empty": "Generated assets will appear here",
    "lib.more": "Load more ({n} left)",
    "badge.approved": "✓ Approved",
    "badge.rejected": "✗ Rejected",
    "badge.pending_review": "… In review",
    "filter.trashN": "Trash {n}",
    "filter.done": "Done",
    "filter.colorFound": "{n} assets use colours near {hex}",
    "filter.colorNone": "No asset clearly uses {hex}",
    "lib.shown": "Showing {shown} / {total}",
    "mark.frames": "{n} fr",
    "mark.framesTitle": "Sprite sheet, sliced into {n} frames",
    "mark.nineSlice": "9-slice",
    "mark.nineSliceTitle": "Nine-slice borders set",
    "mark.colorTitle": "Share of pixels near {hex}",
    "mark.variant": "Variant",
    "mark.variantTitle": "Colour variant",
    "mark.old": "Old",
    "mark.oldTitle": "A newer version exists",
    "batch.count": "{n} selected",
    "batch.trashHint": "Deleted assets are kept for {n} days; select them to restore",
    "batch.hint": "Click assets to select (Shift for a range)",
    "lib.purgeIn": "Purged in {n} d",
    "lib.deletedAt": "Deleted {when}",

    "batch.all": "Select all",
    "batch.none": "Clear",
    "batch.restore": "↺ Restore",
    "batch.purge": "Delete permanently",
    "batch.empty": "Empty trash",
    "batch.approve": "✓ Approve",
    "batch.reject": "✗ Reject",
    "batch.redraw": "Redraw from notes",
    "batch.redrawTitle": "Hand the selected assets and their review notes to the agent to redraw (up to 10)",
    "batch.outline": "Outline",
    "batch.outlineTitle": "Add a 2px outline (darkest palette colour) to the selected assets as new versions",
    "batch.cutout": "Remove background",
    "batch.cutoutTitle": "Remove the background of the selected assets (in place; the original can be restored)",
    "batch.snap": "Snap to palette",
    "batch.snapTitle": "Snap the selected assets' colours to the style palette as new versions",
    "batch.compare": "Compare",
    "batch.compareTitle": "Show 2–6 selected assets side by side, enlarged",
    "batch.tag": "+ Tag",
    "batch.tagTitle": "Add a tag to the selected assets",
    "batch.rename": "Rename",
    "batch.renameTitle": "Rename the selected assets to \"prefix + number\" in library order",
    "batch.untag": "− Tag",
    "batch.untagTitle": "Remove a tag from the selected assets",
    "batch.zip": "Export ZIP",
    "batch.atlas": "Export atlas",
    "batch.delete": "Delete",
  },
};

export const LANGS = Object.keys(DICT);

function saved() {
  try {
    const v = localStorage.getItem(KEY);
    return LANGS.includes(v) ? v : null;
  } catch {
    return null;
  }
}

let lang = saved() ?? "zh";

export const getLang = () => lang;

/** The text for `key` in the current language, with {name} placeholders filled; falls back to Chinese, then the key. */
export function t(key, vars) {
  const s = DICT[lang][key] ?? DICT.zh[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Display label of an asset type in the current language (the server's label for unknown types). */
export const typeLabel = (type, fallback) => (Object.hasOwn(DICT.zh, `type.${type}`) ? t(`type.${type}`) : (fallback ?? type));

const ATTRS = { i18n: null, i18nTitle: "title", i18nPlaceholder: "placeholder", i18nAria: "aria-label" };

/** Fill every marked element under `root` with the current language's text. */
export function applyI18n(root = document) {
  root.documentElement?.setAttribute("lang", lang === "zh" ? "zh-CN" : "en");
  for (const [data, attr] of Object.entries(ATTRS)) {
    const sel = `[data-${data.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}]`;
    for (const el of root.querySelectorAll(sel)) {
      const text = t(el.dataset[data]);
      if (attr) el.setAttribute(attr, text);
      else el.textContent = text;
    }
  }
}

/** Switch language, remember it, refresh static text and tell renderers ("gaa:lang"). */
export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {}
  applyI18n();
  document.dispatchEvent(new CustomEvent("gaa:lang", { detail: { lang } }));
}
