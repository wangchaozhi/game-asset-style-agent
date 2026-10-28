import assert from "node:assert/strict";
import { describe, it } from "node:test";

// The browser modules are plain JS without type declarations: import them through a string so tsc
// doesn't need types. A few read the document at load time (notify.js keeps the page title), so a
// minimal stand-in is installed first; everything tested here is pure.
(globalThis as { document?: unknown }).document ??= { title: "Game Asset Agent", hidden: false, addEventListener() {}, querySelector: () => null };
// The interface language comes from saved choice, else the browser; pin Chinese so assertions are stable.
Object.defineProperty(globalThis, "localStorage", { value: { getItem: () => "zh", setItem() {}, removeItem() {} }, configurable: true });
const load = (path: string) => import(path);
const { BUILTIN_PRESETS, applyPreset, exportNotes, exportUrl, formatOf, matchingPreset, renamedAscii } = await load("../public/js/exportDialog.js");
const { esc } = await load("../public/js/lib.js");
const { feedbackOf } = await load("../public/js/consistency.js");
const { lineage, stepVersion } = await load("../public/js/viewer/history.js");
const { state } = await load("../public/js/state.js");
const { gridMove, matchesQuery, parseQuery, visibleAssets } = await load("../public/js/assets.js");
const { processUndo, snapshot } = await load("../public/js/batch.js");
const { LEVELS, nextZoom } = await load("../public/js/viewer/zoom.js");
const { neighbours } = await load("../public/js/viewer/sprite.js");
const { menuItems } = await load("../public/js/cardMenu.js");
const { runPrefs } = await load("../public/js/run.js");
const { DICT, LANGS, defaultLang, fill, getLang, t, typeLabel } = await load("../public/js/i18n.js");

const DEFAULTS = { kind: "zip", scope: "approved", tag: "", names: "original", sizes: false, unity: false, godot: "assets", tile: "32", max: "256", size: "2048", cocos: false };

describe("front end: export URL", () => {
  it("leaves defaults out", () => {
    assert.equal(exportUrl("p1", DEFAULTS), "/api/projects/p1/export.zip");
    assert.equal(exportUrl("p1", { ...DEFAULTS, kind: "atlas" }), "/api/projects/p1/export-atlas.zip");
  });

  it("adds only the options that apply to the chosen format", () => {
    const all = { ...DEFAULTS, scope: "all", tag: "第一关", names: "ascii", sizes: true, unity: true, godot: "game/art", tile: "16", max: "128", size: "4096", cocos: true };
    const zip = new URL(exportUrl("p1", all), "http://x");
    assert.deepEqual(Object.fromEntries(zip.searchParams), { status: "all", tag: "第一关", names: "ascii", sizes: "1", unity: "1", godot: "game/art", tile: "16" });
    const atlas = new URL(exportUrl("p1", { ...all, kind: "atlas" }), "http://x");
    assert.deepEqual(Object.fromEntries(atlas.searchParams), { status: "all", tag: "第一关", names: "ascii", max: "128", size: "4096", cocos: "1" });
  });
});

describe("front end: per-project run choices", () => {
  const types = ["item_icon", "tile", "ui"];
  it("keeps saved types that still exist and a provider that is still usable", () => {
    assert.deepEqual(runPrefs('{"types":["tile","gone"],"provider":"mock"}', types, ["mock"]), { types: ["tile"], provider: "mock" });
    assert.deepEqual(runPrefs('{"types":["ui"],"provider":"openai"}', types, ["mock"]), { types: ["ui"], provider: null });
  });
  it("falls back to nothing for missing or broken data", () => {
    assert.deepEqual(runPrefs(null, types, ["mock"]), { types: [], provider: null });
    assert.deepEqual(runPrefs("{oops", types, ["mock"]), { types: [], provider: null });
    assert.deepEqual(runPrefs('{"types":"tile"}', types, ["mock"]), { types: [], provider: null });
  });
});

describe("front end: library keyboard", () => {
  it("offers only the review actions that change something, and restore / purge in the trash", () => {
    const acts = (status: string, trash = false) => menuItems({ status }, trash).filter((x: unknown) => x !== "-").map((x: string[]) => x[0]);
    assert.deepEqual(acts("approved"), ["open", "reject", "pending", "tag", "rename", "delete"]);
    assert.deepEqual(acts("pending_review"), ["open", "approve", "reject", "tag", "rename", "delete"]);
    assert.deepEqual(acts("rejected", true), ["restore", "purge"]);
  });

  it("moves focus through a 4-wide grid of 10 cards", () => {
    assert.equal(gridMove(0, "ArrowRight", 4, 10), 1);
    assert.equal(gridMove(3, "ArrowRight", 4, 10), 4, "wraps to the next row");
    assert.equal(gridMove(1, "ArrowDown", 4, 10), 5);
    assert.equal(gridMove(7, "ArrowDown", 4, 10), 7, "no card below: stays");
    assert.equal(gridMove(2, "ArrowUp", 4, 10), 2);
    assert.equal(gridMove(0, "ArrowLeft", 4, 10), 0);
    assert.equal(gridMove(5, "Home", 4, 10), 0);
    assert.equal(gridMove(5, "End", 4, 10), 9);
    assert.equal(gridMove(5, "a", 4, 10), null);
  });
});

describe("front end: export presets", () => {
  it("applies a preset's format over the defaults and keeps scope and tag", () => {
    const now = { ...DEFAULTS, scope: "all", tag: "boss", kind: "atlas", max: "64" };
    const o = applyPreset(now, BUILTIN_PRESETS["export.preset.unity"]);
    assert.deepEqual([o.kind, o.unity, o.names, o.max, o.scope, o.tag], ["zip", true, "ascii", "256", "all", "boss"]);
  });

  it("recognises which preset the current options are", () => {
    const presets = { a: BUILTIN_PRESETS["export.preset.cocos"], b: { kind: "zip", sizes: true } };
    assert.equal(matchingPreset(applyPreset(DEFAULTS, presets.a), presets), "a");
    assert.equal(matchingPreset({ ...applyPreset(DEFAULTS, presets.b), tag: "x" }, presets), "b", "tag doesn't matter");
    assert.equal(matchingPreset({ ...DEFAULTS, max: "128" }, presets), "");
    assert.deepEqual(Object.keys(formatOf(DEFAULTS)).sort(), ["cocos", "godot", "kind", "max", "names", "size", "sizes", "tile", "unity"]);
  });
});

describe("front end: pre-export notes", () => {
  const assets = [
    { id: "1", status: "approved", assetType: "background", name: "森林" },
    { id: "2", status: "approved", assetType: "sprite_sheet", name: "walk", frames: [] },
    { id: "3", status: "approved", assetType: "ui", name: "panel", nineSlice: { left: 4, top: 4, right: 4, bottom: 4 } },
    { id: "4", status: "approved", assetType: "ui", name: "按钮" },
    { id: "5", status: "rejected", assetType: "item_icon", name: "sword" },
  ];
  const notes = (o: object) => Object.fromEntries(exportNotes(assets, { ...DEFAULTS, ...o }).map((x: { key: string; n: number }) => [x.key, x.n]));

  it("counts what a bundle leaves out or exports as-is", () => {
    assert.deepEqual(notes({}), { unapproved: 1, unsliced: 1, noNine: 1 });
    assert.deepEqual(notes({ scope: "all" }), { unsliced: 1, noNine: 1 });
  });

  it("adds format- and option-specific notes", () => {
    assert.deepEqual(notes({ kind: "atlas", cocos: true, names: "ascii" }), { unapproved: 1, noBackground: 1, unsliced: 1, noNine: 1, cocosNine: 1, renamed: 2 });
  });

  it("predicts ASCII renames with the server's rule", async () => {
    const { stemNamer } = await import("../src/export/bundle.js");
    for (const name of ["sword", "Scene prop #3", "森林", "coin_01.v2", "  a b  ", "x/y"]) {
      const server = stemNamer("ascii")({ name, assetType: "prop" }) === "prop_01";
      assert.equal(renamedAscii(name), server, name);
    }
  });

  it("follows the tag filter", () => {
    const tagged = assets.map((a) => (a.id === "4" ? { ...a, tags: ["UI"] } : a));
    assert.deepEqual(exportNotes(tagged, { ...DEFAULTS, tag: "ui" }), [{ key: "noNine", n: 1 }]);
  });
});

describe("front end: helpers", () => {
  it("esc escapes HTML-significant characters", () => {
    assert.equal(esc(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    assert.equal(esc(null), "");
  });

  it("feedbackOf turns drift reasons into redraw feedback", () => {
    assert.equal(feedbackOf({ reasons: ["色板内 40%", "评分 4/10"] }), "色板内 40%；评分 4/10。请回到风格指南的色板与参考图的画风。");
  });

  it("lineage walks from the root to every version and variant, oldest first", () => {
    const a = (id: string, createdAt: string, more = {}) => ({ id, createdAt, ...more });
    const assets = [a("v1", "1"), a("v2", "2", { parentId: "v1" }), a("red", "3", { variantOf: "v1" }), a("v3", "4", { parentId: "v2" }), a("other", "5")];
    assert.deepEqual(lineage(assets[3], assets).map((x: { id: string }) => x.id), ["v1", "v2", "red", "v3"]);
    assert.deepEqual(lineage(assets[4], assets).map((x: { id: string }) => x.id), ["other"]);
    assert.equal(stepVersion(assets[1], 1, assets).id, "red");
    assert.equal(stepVersion(assets[1], -1, assets).id, "v1");
    assert.equal(stepVersion(assets[0], -1, assets), null, "nothing before the original");
    assert.equal(stepVersion(assets[3], 1, assets), null, "nothing after the newest");
  });
});

describe("front end: search syntax", () => {
  const sword = { id: "ast_1", name: "Iron sword", notes: "蓝色剑身", prompt: "", assetType: "item_icon", status: "approved", tags: ["Weapon", "第一关"] };
  const tile = { id: "ast_2", name: "Grass", notes: "", prompt: "seamless grass", assetType: "tile", status: "pending_review", tags: [] };
  const match = (text: string) => [sword, tile].filter((a) => matchesQuery(a, parseQuery(text))).map((a) => a.id);

  it("splits words, phrases, exclusions and qualifiers", () => {
    assert.deepEqual(parseQuery('iron "blue blade" -wood #Boss type:item status:pending'), {
      words: ["iron", "blue blade"], exclude: ["wood"], tags: ["boss"], types: ["item"], statuses: ["pending_review"],
    });
    assert.deepEqual(parseQuery("status:great # type:").words, ["status:great", "#", "type:"], "malformed qualifiers stay plain words");
  });

  it("matches every plain word, no excluded one, and each qualifier", () => {
    assert.deepEqual(match(""), ["ast_1", "ast_2"]);
    assert.deepEqual(match("iron 蓝色"), ["ast_1"]);
    assert.deepEqual(match("-sword"), ["ast_2"]);
    assert.deepEqual(match("#weapon"), ["ast_1"]);
    assert.deepEqual(match("#第一关 #weapon"), ["ast_1"], "all tags are required");
    assert.deepEqual(match("type:tile"), ["ast_2"]);
    assert.deepEqual(match("type:tile type:item"), ["ast_1", "ast_2"], "repeated qualifiers mean any of them");
    assert.deepEqual(match("status:approved"), ["ast_1"]);
    assert.deepEqual(match('"seamless grass"'), ["ast_2"]);
  });
});

describe("front end: library filters", () => {
  it("filters by status, type, tag and search, newest first; a colour search sorts by share", () => {
    const asset = (id: string, more = {}) => ({ id, name: id, assetType: "item_icon", status: "approved", ...more });
    state.project = {
      assets: [asset("a"), asset("b", { status: "rejected" }), asset("c", { assetType: "tile", tags: ["Boss"] }), asset("d", { notes: "蓝色的剑" })],
      trash: [],
    };
    Object.assign(state, { filter: "all", typeFilter: "", tagFilter: "", query: "", colorFilter: null });
    const ids = () => visibleAssets().map((x: { id: string }) => x.id);
    assert.deepEqual(ids(), ["d", "c", "b", "a"]);
    state.filter = "approved";
    assert.deepEqual(ids(), ["d", "c", "a"]);
    state.typeFilter = "tile";
    assert.deepEqual(ids(), ["c"]);
    Object.assign(state, { typeFilter: "", tagFilter: "boss" });
    assert.deepEqual(ids(), ["c"], "tags match case-insensitively");
    Object.assign(state, { tagFilter: "", query: "蓝色" });
    assert.deepEqual(ids(), ["d"], "search covers notes");
    Object.assign(state, { query: "", colorFilter: { hex: "#ff0000", shares: new Map([["a", 0.2], ["c", 0.6]]) } });
    assert.deepEqual(ids(), ["c", "a"]);
  });
});

describe("front end: sprite onion skin", () => {
  it("wraps around the loop for the first and last frame", () => {
    assert.deepEqual(neighbours(0, 6), { prev: 5, next: 1 });
    assert.deepEqual(neighbours(5, 6), { prev: 4, next: 0 });
    assert.deepEqual(neighbours(1, 2), { prev: 0, next: 0 });
  });
});

describe("front end: viewer zoom", () => {
  it("steps through the zoom levels and stops at either end", () => {
    assert.equal(nextZoom(0, 1), 1);
    assert.equal(nextZoom(4, 1), 8);
    assert.equal(nextZoom(4, -1), 2);
    assert.equal(nextZoom(1, -1), 0);
    assert.equal(nextZoom(0, -1), 0);
    assert.equal(nextZoom(LEVELS.at(-1), 1), LEVELS.at(-1));
    assert.equal(nextZoom(3, 1), 1, "unknown levels restart from fit");
  });
});

describe("front end: batch undo", () => {
  it("offers to undo post-processing only when it can give the previous image back", () => {
    const before = new Map([
      ["a", { id: "a", file: "assets/a.png" }],
      ["b", { id: "b", file: "assets/b_cut1.png", originalFile: "assets/b_orig.png" }],
      ["c", { id: "c", file: "assets/c_orig.png", originalFile: "assets/c_orig.png" }],
    ]);
    const done = (...ids: string[]) => ids.map((id) => ({ id, result: `${id}2` }));
    assert.equal(typeof processUndo("outline", done("a", "b"), before), "function");
    assert.equal(typeof processUndo("snap", done("a"), before), "function");
    assert.equal(typeof processUndo("cutout", done("a", "c"), before), "function", "never cut, or already restored");
    assert.equal(processUndo("cutout", done("a", "b"), before), null, "an earlier cut-out is gone for good");
    assert.equal(processUndo("outline", [], before), null);
  });

  it("snapshots only the selected assets, with the fields a revert restores", () => {
    const assets = [
      { id: "a", status: "approved", reviewer: "agent", tags: ["x"], name: "剑", file: "f" },
      { id: "b", status: "pending_review", name: "盾" },
      { id: "c", status: "rejected", name: "弓" },
    ];
    assert.deepEqual(snapshot(assets, ["b", "a"]), [
      { id: "a", status: "approved", reviewer: "agent", tags: ["x"], name: "剑" },
      { id: "b", status: "pending_review", reviewer: undefined, tags: [], name: "盾" },
    ]);
  });
});

describe("front end: i18n", () => {
  it("has the same keys in every language, with the same placeholders", () => {
    const zh = Object.keys(DICT.zh).sort();
    for (const lang of LANGS) {
      assert.deepEqual(Object.keys(DICT[lang]).sort(), zh, lang);
      for (const k of zh) {
        const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        assert.deepEqual(vars(DICT[lang][k]), vars(DICT.zh[k]), `${lang} ${k}`);
        assert.ok(DICT[lang][k].trim(), `${lang} ${k} is empty`);
      }
    }
  });

  it("every data-i18n key in index.html exists", async () => {
    const { readFile } = await import("node:fs/promises");
    const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
    const keys = [...html.matchAll(/data-i18n(?:-title|-placeholder|-aria)?="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(keys.length > 50);
    for (const k of keys) assert.ok(Object.hasOwn(DICT.zh, k), k);
  });

  it("t fills placeholders and falls back to the key; typeLabel falls back to the server label", () => {
    assert.equal(getLang(), "zh");
    assert.equal(t("lib.more", { n: 3 }), "加载更多（还有 3 个）");
    assert.equal(t("no.such.key"), "no.such.key");
    assert.equal(typeLabel("tile"), "地图瓦片 / 地形");
    assert.equal(typeLabel("custom", "自定义"), "自定义");
    assert.equal(typeLabel("constructor", "x"), "x");
  });

  it("picks English singular or plural forms by count", () => {
    const s = "Moved {n} {n|asset|assets}; {n|it is|they are} in the trash";
    assert.equal(fill(s, { n: 1 }), "Moved 1 asset; it is in the trash");
    assert.equal(fill(s, { n: 3 }), "Moved 3 assets; they are in the trash");
    assert.equal(fill(s, { n: 0 }), "Moved 0 assets; they are in the trash");
    assert.equal(fill("{x|a|b}", { n: 1 }), "{x|a|b}", "unknown variables stay as written");
  });

  it("uses plural forms only with variables the Chinese text also has", () => {
    for (const [k, en] of Object.entries(DICT.en) as [string, string][]) {
      for (const m of en.matchAll(/\{(\w+)\|/g)) assert.ok(DICT.zh[k].includes(`{${m[1]}}`), `${k}: {${m[1]}|…}`);
    }
  });

  it("defaults to the first supported browser language, else English", () => {
    assert.equal(defaultLang(["zh-CN", "en"]), "zh");
    assert.equal(defaultLang(["fr-FR", "zh-TW"]), "zh");
    assert.equal(defaultLang(["en-GB"]), "en");
    assert.equal(defaultLang(["ja"]), "en");
    assert.equal(defaultLang([]), "en");
  });

  it("keeps interface text out of the scripts: Chinese appears only in the dictionaries", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const root = new URL("../public/js/", import.meta.url);
    // Style-guide sniffing for pixel art matches Chinese words in user data, not interface text.
    const allowed = [/state\.pixelKernel = /];
    const offenders: string[] = [];
    for (const f of await readdir(root, { recursive: true })) {
      if (!f.endsWith(".js") || f.startsWith("i18n/")) continue;
      const lines = (await readFile(new URL(f, root), "utf8")).split("\n");
      lines.forEach((l, i) => {
        // Full-width brackets and quotes are Chinese typography too.
        if (/[\u4e00-\u9fa5（）「」]/.test(l) && !allowed.some((r) => r.test(l))) offenders.push(`${f}:${i + 1}`);
      });
    }
    assert.deepEqual(offenders, []);
  });

  it("marks every piece of Chinese text in the pages for translation", async () => {
    const { readFile } = await import("node:fs/promises");
    const zh = /[\u4e00-\u9fa5]/;
    // Filled by scripts with t() at render time, so their markup text is only a placeholder.
    const scripted = new Set(["editStyle", "styleGuide", "runBtn", "trashFilter", "selectToggle"]);
    const ATTRS: [string, string][] = [["title", "title"], ["aria-label", "aria"], ["placeholder", "placeholder"]];
    for (const page of ["index.html", "login.html"]) {
      const html = (await readFile(new URL(`../public/${page}`, import.meta.url), "utf8")).replace(/<title>[^<]*<\/title>/, "");
      const missing: string[] = [];
      // Each tag, then the text right after it (up to the next tag): attributes need data-i18n-<attr>, text needs data-i18n.
      for (const m of html.matchAll(/<(\w+)([^>]*)>([^<]*)/g)) {
        const [, , attrs, text] = m;
        for (const [attr, key] of ATTRS) {
          const v = attrs.match(new RegExp(`\\s${attr}="([^"]*)"`))?.[1];
          if (v && zh.test(v) && !attrs.includes(`data-i18n-${key}=`)) missing.push(`${attr}: ${v}`);
        }
        const id = attrs.match(/\sid="([^"]*)"/)?.[1];
        if (zh.test(text) && !/\sdata-i18n="/.test(attrs) && !scripted.has(id ?? "")) missing.push(text.trim());
      }
      assert.deepEqual(missing, [], page);
    }
  });
});
