import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import sharp from "sharp";
import { getProvider, providers } from "../src/providers/index.js";
import { mock } from "../src/providers/mock.js";
import { hexRgb } from "./helpers.js";

process.env.MOCK_DELAY_MS = "0";
const req = (over: Partial<Parameters<typeof mock.generate>[0]> = {}) => ({
  prompt: "Flat vector sword icon, palette #ff0000 #00ff00 #0000ff",
  references: [],
  aspect: "square" as const,
  transparent: true,
  ...over,
});

describe("mock provider", () => {
  it("is always available", () => {
    assert.equal(mock.available(), true);
  });

  it("produces a PNG sized by aspect", async () => {
    for (const [aspect, w, h] of [["square", 512, 512], ["landscape", 768, 512], ["portrait", 512, 768]] as const) {
      const img = await mock.generate(req({ aspect }));
      assert.equal(img.mime, "image/png");
      const meta = await sharp(img.data).metadata();
      assert.deepEqual([meta.format, meta.width, meta.height], ["png", w, h]);
    }
  });

  it("lays sprite sheet frames out in one row", async () => {
    const meta = await sharp((await mock.generate(req({ frames: 6 }))).data).metadata();
    assert.equal(meta.width, 6 * 192);
    assert.equal(meta.height, 512);
  });

  it("is deterministic for the same prompt and varies with it", async () => {
    const a = await mock.generate(req());
    const b = await mock.generate(req());
    const c = await mock.generate(req({ prompt: "Something else entirely #ff0000 #00ff00 #0000ff" }));
    assert.ok(a.data.equals(b.data));
    assert.ok(!a.data.equals(c.data));
  });

  it("paints with palette colours named in the prompt", async () => {
    const { data, info } = await sharp((await mock.generate(req())).data).raw().toBuffer({ resolveWithObject: true });
    const centre = ((info.height >> 1) * info.width + (info.width >> 1)) * info.channels;
    const px = { r: data[centre], g: data[centre + 1], b: data[centre + 2] };
    const palette = ["#ff0000", "#00ff00", "#0000ff"].map(hexRgb);
    assert.ok(palette.some((c) => c.r === px.r && c.g === px.g && c.b === px.b), JSON.stringify(px));
  });

  it("uses a white backdrop for transparent requests (cut out later)", async () => {
    const { data } = await sharp((await mock.generate(req())).data).raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([...data.subarray(0, 3)], [255, 255, 255]);
  });
});

describe("getProvider", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("falls back to the first available provider", () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.SD_WEBUI_URL;
    assert.equal(getProvider(undefined).id, "mock");
    assert.equal(getProvider("nope").id, "mock");
    process.env.GEMINI_API_KEY = "k";
    assert.equal(getProvider(undefined).id, "gemini");
  });

  it("refuses a named provider without a key", () => {
    delete process.env.OPENAI_API_KEY;
    assert.throws(() => getProvider("openai"), /未配置/);
  });

  it("exposes openai, gemini, sdwebui and mock", () => {
    assert.deepEqual(providers.map((p) => p.id), ["openai", "gemini", "sdwebui", "mock"]);
  });
});
