import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StyleGuideInput } from "../src/agent/schemas.js";
import { STYLE_PRESETS } from "../src/domain/stylePresets.js";

describe("style presets", () => {
  it("are valid style guides whose prompt prefix names their palette", () => {
    assert.ok(Object.keys(STYLE_PRESETS).length >= 3);
    for (const [key, p] of Object.entries(STYLE_PRESETS)) {
      const parsed = StyleGuideInput.safeParse(p.guide);
      assert.ok(parsed.success, `${key}: ${JSON.stringify(parsed.error?.issues)}`);
      for (const c of p.guide.palette) assert.ok(p.guide.prompt_prefix.toLowerCase().includes(c.hex.toLowerCase()), `${key} ${c.hex}`);
    }
  });
});
