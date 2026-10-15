import assert from "node:assert/strict";
import zlib from "node:zlib";
import { describe, it } from "node:test";
import { safeName, uniqueNamer } from "../src/export/bundle.js";
import { createZip } from "../src/export/zip.js";

/** Minimal reader: walk the central directory and inflate each entry. */
function readZip(buf: Buffer) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, "end of central directory");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Record<string, { data: Buffer; method: number; utf8: boolean }> = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    assert.equal(buf.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    assert.equal(data.length, usize);
    assert.equal(zlib.crc32(data) >>> 0, crc, `crc of ${name}`);
    out[name] = { data, method, utf8: !!(flags & 0x800) };
    p += 46 + nlen;
  }
  return out;
}

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
