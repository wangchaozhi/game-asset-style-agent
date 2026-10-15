import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeName, uniqueNamer } from "../src/export/bundle.js";
import { createZip } from "../src/export/zip.js";
import { readZip } from "./helpers.js";

describe("createZip", () => {
  it("round-trips text (deflated) and images (stored) with UTF-8 names", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const json = Buffer.from(JSON.stringify({ hello: "世界".repeat(50) }));
    const files = readZip(createZip([
      { name: "item_icon/火焰剑.png", data: png },
      { name: "manifest.json", data: json },
      { name: "empty.txt", data: Buffer.alloc(0) },
    ]));
    assert.deepEqual(Object.keys(files), ["item_icon/火焰剑.png", "manifest.json", "empty.txt"]);
    assert.ok(files["item_icon/火焰剑.png"].data.equals(png));
    assert.equal(files["item_icon/火焰剑.png"].method, 0);
    assert.ok(files["manifest.json"].data.equals(json));
    assert.equal(files["manifest.json"].method, 8);
    assert.ok(files["manifest.json"].utf8);
  });

  it("an empty archive is just the end record", () => {
    assert.equal(createZip([]).length, 22);
  });
});

describe("export naming", () => {
  it("safeName strips path and shell-unfriendly characters", () => {
    assert.equal(safeName("a/b\\c:d*e?f"), "a_b_c_d_e_f");
    assert.equal(safeName("  火焰 剑  "), "火焰_剑");
    assert.equal(safeName("///"), "asset");
  });

  it("uniqueNamer de-duplicates", () => {
    const n = uniqueNamer();
    assert.deepEqual([n("a"), n("a"), n("a"), n("b")], ["a", "a_2", "a_3", "b"]);
  });
});
