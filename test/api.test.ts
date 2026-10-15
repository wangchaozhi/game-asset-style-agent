import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { solidPng, useTempDataDir, validStyleGuide } from "./helpers.js";

useTempDataDir();
process.env.AGENT_MODE = "demo";
const { createApp } = await import("../src/app.js");

let base = "";
let server: import("node:http").Server;
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const json = async (path: string, init?: Omit<RequestInit, "body"> & { body?: unknown }) => {
  const res = await fetch(base + path, {
    ...init,
    headers: init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    body: init?.body instanceof FormData ? init.body : init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

/** Read the SSE stream until "done" and return the parsed events. */
async function events(jobId: string) {
  const res = await fetch(`${base}/api/jobs/${jobId}/events`);
  const text = await res.text();
  return text.split("\n\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
}

describe("HTTP API (demo mode)", () => {
  let id = "";

  it("serves config and the UI", async () => {
    const { body } = await json("/api/config");
    assert.equal(body.demo, true);
    assert.ok(body.providers.some((p: { id: string; available: boolean }) => p.id === "mock" && p.available));
    assert.ok("item_icon" in body.assetTypes);
    const html = await (await fetch(base + "/")).text();
    assert.match(html, /js\/main\.js/);
  });

  it("creates a project and uploads a reference", async () => {
    id = (await json("/api/projects", { method: "POST", body: { name: "API" } })).body.id;
    const fd = new FormData();
    fd.append("images", new Blob([new Uint8Array(await solidPng(40, 40, "#22aa66"))], { type: "image/png" }), "ref.png");
    const { status, body } = await json(`/api/projects/${id}/refs`, { method: "POST", body: fd });
    assert.equal(status, 200);
    assert.equal(body.refs.length, 1);
  });

  it("validates style guide edits", async () => {
    const bad = await json(`/api/projects/${id}/style-guide`, { method: "PUT", body: { ...validStyleGuide(), palette: [] } });
    assert.equal(bad.status, 400);
    const ok = await json(`/api/projects/${id}/style-guide`, { method: "PUT", body: validStyleGuide() });
    assert.equal(ok.body.styleGuide.summary, "Cozy pixel art");
  });

  it("runs a demo job end to end and records usage", async () => {
    const run = await json(`/api/projects/${id}/run`, { method: "POST", body: { request: "道具", assetTypes: ["item_icon", "tile"], provider: "mock" } });
    assert.equal(run.status, 200);
    const evs = await events(run.body.jobId);
    const kinds = evs.map((e) => e.type);
    assert.equal(kinds.at(-1), "done");
    const lastUsage = evs.filter((e) => e.type === "usage").at(-1);
    assert.deepEqual([lastUsage.usage.status, lastUsage.usage.images.calls], ["ok", 2]);
    // Reconnecting after the run replays the log with only the latest usage snapshot.
    const replay = await events(run.body.jobId);
    assert.equal(replay.filter((e) => e.type === "usage").length, 1);
    assert.equal(replay.at(-1).type, "done");
    assert.ok(!kinds.includes("error"), JSON.stringify(evs.filter((e) => e.type === "error")));
    const project = (await json(`/api/projects/${id}`)).body;
    assert.equal(project.assets.length, 2);
    assert.ok(project.assets.every((a: { status: string }) => a.status === "approved"));

    const usage = (await json(`/api/projects/${id}/usage`)).body;
    assert.equal(usage.runs.length, 1);
    assert.equal(usage.runs[0].status, "ok");
    assert.equal(usage.runs[0].mode, "demo");
    assert.equal(usage.summary.images.calls, 2);
    assert.equal(usage.summary.cost.total, 0);
  });

  it("serves asset files, sized PNGs and tile checks; blocks path tricks", async () => {
    const project = (await json(`/api/projects/${id}`)).body;
    const tile = project.assets.find((a: { assetType: string }) => a.assetType === "tile");
    assert.equal((await fetch(`${base}/api/projects/${id}/files/${tile.file}`)).status, 200);
    assert.equal((await fetch(`${base}/api/projects/${id}/files/project.json`)).status, 400);
    assert.equal((await fetch(`${base}/api/projects/${id}/files/assets/..%2Fproject.json`)).status, 400);
    const sized = await fetch(`${base}/api/projects/${id}/assets/${tile.id}/sized.png?size=32`);
    assert.equal(sized.headers.get("content-type"), "image/png");
    assert.equal((await json(`/api/projects/${id}/assets/${tile.id}/sized.png?size=1`)).status, 400);
    const seams = (await json(`/api/projects/${id}/assets/${tile.id}/seams`)).body;
    assert.equal(typeof seams.seamless, "boolean");
    assert.equal((await json(`/api/projects/${id}/assets/ast_missing/seams`)).status, 404);
  });

  it("manual review updates status and rejects bad values", async () => {
    const asset = (await json(`/api/projects/${id}`)).body.assets[0];
    const r = await json(`/api/projects/${id}/assets/${asset.id}`, { method: "PATCH", body: { status: "rejected", notes: "太亮" } });
    assert.deepEqual([r.body.status, r.body.notes, r.body.reviewer], ["rejected", "太亮", "user"]);
    assert.equal((await json(`/api/projects/${id}/assets/${asset.id}`, { method: "PATCH", body: { status: "great" } })).status, 400);
  });

  it("exports approved assets as a ZIP", async () => {
    const res = await fetch(`${base}/api/projects/${id}/export.zip`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/zip");
    const zip = Buffer.from(await res.arrayBuffer());
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    assert.ok(zip.includes(Buffer.from("manifest.json")));
  });

  it("returns 404 for unknown projects and jobs", async () => {
    assert.equal((await json("/api/projects/prj_0000000000")).status, 404);
    assert.equal((await fetch(`${base}/api/jobs/job_nope/events`)).status, 404);
    assert.equal((await json("/api/projects/not-an-id")).status, 500);
  });
});
