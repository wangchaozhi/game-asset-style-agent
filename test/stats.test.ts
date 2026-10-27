import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectStats } from "../src/domain/stats.js";
import type { Asset, Project } from "../src/store/types.js";

const asset = (id: string, over: Partial<Asset> = {}): Asset => ({
  id, name: id, assetType: "item_icon", prompt: "", file: `assets/${id}.png`, mime: "image/png", status: "approved", runId: "r", provider: "mock", createdAt: "", ...over,
});
const project = (assets: Asset[], trash = 0): Project => ({
  id: "prj_t", name: "t", createdAt: "", refs: [], styleGuide: null, assets,
  trash: Array.from({ length: trash }, (_, i) => ({ ...asset(`ast_t${i}`), deletedAt: "" })),
});

describe("projectStats", () => {
  it("counts current assets by status and type, leaving superseded versions out", () => {
    const st = projectStats(
      project(
        [
          asset("a", { reviewer: "agent", score: 8 }),
          asset("b", { status: "rejected", reviewer: "agent", score: 4 }),
          asset("c", { parentId: "b", status: "pending_review" }),
          asset("d", { assetType: "tile", reviewer: "user", score: 2 }),
          asset("e", { variantOf: "a" }),
        ],
        2,
      ),
      1.5,
    );
    assert.equal(st.current, 4, "b is superseded by c");
    assert.deepEqual(st.byStatus, { approved: 3, pending_review: 1, rejected: 0 });
    assert.equal(st.approvalRate, 1);
    assert.equal(st.meanScore, 8, "only the agent's scores on current assets");
    assert.deepEqual(st.byType, [{ type: "item_icon", current: 3, approved: 2 }, { type: "tile", current: 1, approved: 1 }]);
    assert.deepEqual([st.variants, st.superseded, st.trashed, st.costPerApproved], [1, 1, 2, 0.5]);
  });

  it("uses null where there is nothing to measure yet", () => {
    const st = projectStats(project([asset("a", { status: "pending_review" })]), 0);
    assert.deepEqual([st.approvalRate, st.meanScore, st.costPerApproved], [null, null, null]);
    assert.equal(projectStats(project([]), 0).current, 0);
  });
});
