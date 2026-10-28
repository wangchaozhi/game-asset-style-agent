import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NOTE_LOG_MAX, recordNote } from "../src/domain/noteLog.js";
import type { Asset } from "../src/store/types.js";

const asset = () => ({ id: "a", status: "pending_review" }) as Asset;

describe("recordNote", () => {
  it("appends notes with who wrote them, the verdict and (for the agent) the score", () => {
    const a = asset();
    a.status = "rejected";
    a.score = 4;
    recordNote(a, "agent", " too dark ", "t1");
    a.status = "approved";
    recordNote(a, "user", "fine after the fix", "t2");
    assert.deepEqual(a.noteLog, [
      { at: "t1", by: "agent", notes: "too dark", status: "rejected", score: 4 },
      { at: "t2", by: "user", notes: "fine after the fix", status: "approved" },
    ]);
  });

  it("skips empty notes and a repeat of the last one, and keeps only the newest", () => {
    const a = asset();
    recordNote(a, "user", "  ");
    assert.equal(a.noteLog, undefined);
    recordNote(a, "user", "x");
    recordNote(a, "user", "x");
    assert.equal(a.noteLog!.length, 1);
    for (let i = 0; i < NOTE_LOG_MAX + 5; i++) recordNote(a, "user", `n${i}`);
    assert.equal(a.noteLog!.length, NOTE_LOG_MAX);
    assert.equal(a.noteLog!.at(-1)!.notes, `n${NOTE_LOG_MAX + 4}`);
  });
});
