import assert from "node:assert/strict";
import { describe, it } from "node:test";

// The browser modules are plain JS without type declarations: import them through a string so tsc
// doesn't need types. A few read the document at load time (notify.js keeps the page title), so a
// minimal stand-in is installed first; everything tested here is pure.
(globalThis as { document?: unknown }).document ??= { title: "Game Asset Agent", hidden: false, addEventListener() {}, querySelector: () => null };
// The interface language comes from saved choice, else the browser; pin Chinese so assertions are stable.
Object.defineProperty(globalThis, "localStorage", { value: { getItem: () => "zh", setItem() {}, removeItem() {} }, configurable: true });
const load = (path: string) => import(path);
const { exportUrl } = await load("../public/js/exportDialog.js");
const { esc } = await load("../public/js/lib.js");
const { feedbackOf } = await load("../public/js/consistency.js");
const { lineage, stepVersion } = await load("../public/js/viewer/history.js");
const { state } = await load("../public/js/state.js");
const { visibleAssets } = await load("../public/js/assets.js");
const { DICT, LANGS, defaultLang, getLang, t, typeLabel } = await load("../public/js/i18n.js");

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
