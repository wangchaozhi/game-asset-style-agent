import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MESSAGES, assetTypeLabel, currentLang, langOf, msg, withLang } from "../src/i18n.js";
import { rankDrift } from "../src/domain/consistency.js";

describe("server i18n", () => {
  it("picks the first supported language, else Chinese", () => {
    assert.equal(langOf("en-US,en;q=0.9,zh-CN;q=0.8"), "en");
    assert.equal(langOf("fr-FR, zh-TW;q=0.5"), "zh");
    assert.equal(langOf("fr"), "zh");
    assert.equal(langOf(undefined), "zh");
    assert.equal(langOf("en"), "en");
  });

  it("fills placeholders in the current language", () => {
    assert.equal(currentLang(), "zh");
    assert.equal(msg("backup.asset", { name: "剑" }), "素材 剑");
    assert.equal(withLang("en", () => msg("backup.asset", { name: "sword" })), "asset sword");
    assert.equal(withLang("en", () => assetTypeLabel("tile")), "Map tile / terrain");
    assert.equal(assetTypeLabel("tile"), "地图瓦片 / 地形");
    assert.equal(assetTypeLabel("custom"), "custom");
  });

  it("has the same placeholders in every language", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(MESSAGES.zh) as (keyof typeof MESSAGES.zh)[]) assert.deepEqual(vars(MESSAGES.en[k]), vars(MESSAGES.zh[k]), k);
  });

  it("picks English singular or plural forms by count", () => {
    assert.equal(withLang("en", () => msg("run.generated", { n: 1 })), "Generated 1 asset");
    assert.equal(withLang("en", () => msg("run.generated", { n: 2 })), "Generated 2 assets");
    assert.equal(msg("run.generated", { n: 1 }), "生成了 1 个素材");
  });

  it("keeps the language across awaits", async () => {
    const lang = await withLang("en", async () => {
      await new Promise((r) => setTimeout(r, 5));
      return currentLang();
    });
    assert.equal(lang, "en");
  });

  it("writes drift reasons in the current language", () => {
    const item = (id: string, coverage: number, meanDeltaE: number) => ({ id, coverage, meanDeltaE, offPalette: [] });
    const items = [item("a", 0.9, 8), item("b", 0.9, 8), item("c", 0.5, 25)];
    assert.match(withLang("en", () => rankDrift(items)).items[0].reasons[0], /^50% of pixels in palette, below the project median 90%/);
    assert.match(rankDrift(items).items[0].reasons[0], /^色板内像素 50%/);
  });

  it("keeps user-facing messages in the message table, not in the code", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const root = new URL("../src/", import.meta.url);
    // Errors, rejections and validation results that reach the user: a Chinese literal right after one of these.
    const userFacing = /(error: |new Error\(|return |reasons?\.push\(|notes: )[`"'][^`"']*[\u4e00-\u9fa5]/;
    const offenders: string[] = [];
    for (const f of await readdir(root, { recursive: true })) {
      if (!f.endsWith(".ts") || f === "i18n.ts") continue;
      (await readFile(new URL(f, root), "utf8")).split("\n").forEach((l, i) => userFacing.test(l) && offenders.push(`${f}:${i + 1}`));
    }
    assert.deepEqual(offenders, []);
  });
});
