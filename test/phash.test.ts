import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { dHash, hammingDistance } from "../src/image/phash.js";
import { lineageOf } from "../src/ops/similar.js";
import type { Asset } from "../src/store/types.js";

const shape = (svg: string, size = 128) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${svg}</svg>`)).png().toBuffer();

describe("dHash", () => {
  it("is close for the same picture at another size or with a small change", async () => {
    const a = await dHash(await shape(`<circle cx="64" cy="64" r="40" fill="#c33"/><rect x="20" y="90" width="88" height="20" fill="#333"/>`));
    const bigger = await dHash(await shape(`<circle cx="128" cy="128" r="80" fill="#c33"/><rect x="40" y="180" width="176" height="40" fill="#333"/>`, 256));
    const nudged = await dHash(await shape(`<circle cx="66" cy="64" r="40" fill="#c33"/><rect x="20" y="90" width="88" height="20" fill="#333"/>`));
    assert.match(a, /^[0-9a-f]{16}$/);
    assert.ok(hammingDistance(a, bigger) <= 4, `resized: ${hammingDistance(a, bigger)}`);
    assert.ok(hammingDistance(a, nudged) <= 10, `nudged: ${hammingDistance(a, nudged)}`);
  });

  it("is far for a different picture", async () => {
    const a = await dHash(await shape(`<circle cx="64" cy="64" r="40" fill="#c33"/>`));
    const b = await dHash(await shape(`<rect x="0" y="0" width="64" height="128" fill="#222"/><polygon points="80,10 120,120 70,120" fill="#3c3"/>`));
    assert.ok(hammingDistance(a, b) > 10, `different: ${hammingDistance(a, b)}`);
  });

  it("counts differing bits", () => {
    assert.equal(hammingDistance("0000000000000000", "0000000000000000"), 0);
    assert.equal(hammingDistance("0000000000000000", "ffffffffffffffff"), 64);
    assert.equal(hammingDistance("00000000000000f0", "0000000000000010"), 3);
  });
});

describe("lineageOf", () => {
  const asset = (id: string, extra: Partial<Asset> = {}) => ({ id, ...extra }) as Asset;
  const assets = [asset("root"), asset("v2", { parentId: "root" }), asset("v3", { parentId: "v2" }), asset("red", { variantOf: "v2" }), asset("other")];

  it("collects every version and variant of the family from any member", () => {
    for (const from of ["root", "v3", "red"]) assert.deepEqual([...lineageOf(assets, assets.find((a) => a.id === from)!)].sort(), ["red", "root", "v2", "v3"]);
    assert.deepEqual([...lineageOf(assets, assets[4])], ["other"]);
  });

  it("survives a parent cycle", () => {
    const loop = [asset("a", { parentId: "b" }), asset("b", { parentId: "a" })];
    assert.ok(lineageOf(loop, loop[0]).has("a"));
  });
});
