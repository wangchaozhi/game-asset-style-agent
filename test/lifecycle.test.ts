import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { solidPng, useTempDataDir } from "./helpers.js";

useTempDataDir();
process.env.AGENT_MODE = "demo";
const store = await import("../src/store/index.js");
const { newRunUsage } = await import("../src/usage/index.js");
const { recoverInterruptedRuns, stopAllJobs } = await import("../src/lifecycle.js");
const { startJob } = await import("../src/agent/index.js");

describe("recoverInterruptedRuns", () => {
  it("marks only leftover running runs as interrupted", async () => {
    const { id } = await store.createProject("restart");
    const running = newRunUsage("job_r", "", "agent");
    const done = { ...newRunUsage("job_d", "", "agent"), status: "ok" as const, finishedAt: "2026-01-01T00:00:00Z" };
    await store.saveRunUsage(id, running);
    await store.saveRunUsage(id, done);
    assert.equal(await recoverInterruptedRuns(), 1);
    const list = await store.loadUsage(id);
    assert.equal(list.find((r) => r.jobId === "job_r")!.status, "interrupted");
    assert.ok(list.find((r) => r.jobId === "job_r")!.finishedAt);
    assert.equal(list.find((r) => r.jobId === "job_d")!.finishedAt, "2026-01-01T00:00:00Z");
    assert.equal(await recoverInterruptedRuns(), 0, "idempotent");
  });
});

describe("stopAllJobs", () => {
  it("returns 0 when nothing runs", async () => {
    assert.equal(await stopAllJobs(), 0);
  });

  it("aborts running jobs and waits for their final usage record", async () => {
    process.env.MOCK_DELAY_MS = "2000";
    const p = await store.createProject("stop");
    await store.writeProjectFile(p.id, "refs/r.png", await solidPng(16, 16, "#123456"));
    await store.updateProject(p.id, (q) => void q.refs.push({ id: "ref_1", file: "refs/r.png", mime: "image/png", originalName: "r.png" }));
    const job = startJob({ projectId: p.id, request: "slow", assetTypes: ["prop"], providerId: "mock" });
    await new Promise((r) => setTimeout(r, 100));
    const started = Date.now();
    assert.equal(await stopAllJobs(3000), 1);
    assert.ok(job.finished);
    assert.ok(Date.now() - started < 2500, "did not wait for the slow generation");
    const run = (await store.loadUsage(p.id)).find((r) => r.jobId === job.id)!;
    assert.equal(run.status, "stopped");
  });
});
