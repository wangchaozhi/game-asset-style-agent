import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { solidPng, useTempDataDir } from "./helpers.js";

const dataDir = useTempDataDir();
process.env.AGENT_MODE = "demo";
const store = await import("../src/store/index.js");
const { newRunUsage } = await import("../src/usage/index.js");
const { cleanOrphanFiles, recoverInterruptedRuns, stopAllJobs } = await import("../src/lifecycle.js");
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

describe("cleanOrphanFiles", () => {
  it("sweeps every project and totals the result", async () => {
    const a = await store.createProject("o1");
    const b = await store.createProject("o2");
    fs.writeFileSync(path.join(dataDir, "projects", a.id, "assets", "stray.png"), Buffer.alloc(100));
    fs.writeFileSync(path.join(dataDir, "projects", b.id, "refs", "stray.png"), Buffer.alloc(50));
    const r = await cleanOrphanFiles();
    assert.ok(r.removed >= 2 && r.bytes >= 150, JSON.stringify(r));
  });
});

describe("server process", () => {
  it("starts, reports leftovers, and exits cleanly on SIGTERM", async () => {
    // A leftover "running" run from a previous process, to be marked on startup.
    const p = await store.createProject("proc");
    await store.saveRunUsage(p.id, newRunUsage("job_left", "", "agent"));
    const port = 5600 + Math.floor(Math.random() * 300);
    const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
      cwd: path.join(import.meta.dirname, ".."),
      env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, AGENT_MODE: "demo" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    const exited = new Promise<number | null>((r) => child.on("exit", (code) => r(code)));
    for (let i = 0; i < 100 && !log.includes("http://localhost"); i++) await new Promise((r) => setTimeout(r, 100));
    assert.match(log, /已标记为「已中断」/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);
    child.kill("SIGTERM");
    assert.equal(await exited, 0, log);
    assert.match(log, /SIGTERM 收到/);
    assert.equal((await store.loadUsage(p.id))[0].status, "interrupted");
  });
});
