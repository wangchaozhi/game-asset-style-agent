import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replaceableVersions } from "../src/domain/versions.js";
import type { Asset } from "../src/store/types.js";

const a = (id: string, status: Asset["status"], over: Partial<Asset> = {}): Asset => ({
  id, name: id, assetType: "item_icon", prompt: "", file: "", mime: "image/png", status, runId: "r", provider: "mock", createdAt: "", ...over,
});

describe("replaceableVersions", () => {
  it("clears versions with an approved newer version at any depth", () => {
    const ids = replaceableVersions([
      a("v1", "approved"),
      a("v2", "rejected", { parentId: "v1" }),
      a("v3", "approved", { parentId: "v2" }),
    ]);
    assert.deepEqual(ids, ["v1", "v2"]);
  });

  it("keeps an old version whose newer versions are not approved, and ignores colour variants", () => {
    const ids = replaceableVersions([
      a("old", "approved"),
      a("new", "pending_review", { parentId: "old" }),
      a("base", "approved"),
      a("red", "approved", { variantOf: "base" }),
    ]);
    assert.deepEqual(ids, []);
  });

  it("survives a parent cycle in corrupt data", () => {
    assert.deepEqual(replaceableVersions([a("x", "approved", { parentId: "y" }), a("y", "approved", { parentId: "x" })]).sort(), ["x", "y"]);
  });
});
