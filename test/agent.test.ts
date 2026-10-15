import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { solidPng, useTempDataDir, validStyleGuide } from "./helpers.js";

useTempDataDir();
const store = await import("../src/store/index.js");
const { newRunUsage } = await import("../src/usage/index.js");
const { runTool } = await import("../src/agent/runTool.js");
const { buildIntro } = await import("../src/agent/prompts.js");
const { tools } = await import("../src/agent/tools.js");
const { demoStyleGuide } = await import("../src/agent/demo.js");
const { StyleGuideInput } = await import("../src/agent/schemas.js");
const { mock } = await import("../src/providers/mock.js");
type Job = import("../src/agent/events.js").Job;
type AgentEvent = import("../src/agent/events.js").AgentEvent;

async function projectWithRef() {
  const p = await store.createProject("agent");
  await store.writeProjectFile(p.id, "refs/r.png", await solidPng(32, 32, "#3366cc"));
  return store.updateProject(p.id, (q) => void q.refs.push({ id: "ref_1", file: "refs/r.png", mime: "image/png", originalName: "r.png" }));
}

function fakeJob(projectId: string): Job {
  return { id: "job_test", projectId, events: [], listeners: new Set(), finished: false, abort: new AbortController(), usage: newRunUsage("job_test", "", "agent"), budget: { maxImages: null, maxUsd: null } };
}

const call = (name: string, input: unknown, id = "toolu_1") => ({ type: "tool_use", id, name, input }) as Anthropic.Beta.BetaToolUseBlock;
const types = (events: AgentEvent[]) => events.map((e) => e.type);

describe("tool definitions", () => {
  it("every tool has a schema whose required fields are declared", () => {
    assert.deepEqual(tools.map((t) => t.name), ["save_style_guide", "generate_image", "review_asset"]);
    for (const t of tools) {
      const props = Object.keys(t.input_schema.properties ?? {});
      for (const r of t.input_schema.required ?? []) assert.ok(props.includes(r), `${t.name}.${r}`);
    }
  });
});

describe("runTool", () => {
  let projectId: string;
  before(async () => {
    projectId = (await projectWithRef()).id;
  });

  it("returns INVALID_JSON errors for malformed input", async () => {
    const r = await runTool(fakeJob(projectId), mock, call("save_style_guide", { summary: "x" }));
    assert.equal(r.is_error, true);
    assert.match(String(r.content), /INVALID_JSON/);
  });

  it("rejects unknown tools", async () => {
    const r = await runTool(fakeJob(projectId), mock, call("delete_everything", {}));
    assert.equal(r.is_error, true);
  });

  it("save_style_guide persists and broadcasts", async () => {
    const job = fakeJob(projectId);
    const r = await runTool(job, mock, call("save_style_guide", validStyleGuide()));
    assert.notEqual(r.is_error, true);
    assert.deepEqual((await store.loadProject(projectId)).styleGuide, validStyleGuide());
    assert.deepEqual(types(job.events), ["style"]);
    assert.deepEqual((await store.loadStyleHistory(projectId)).map((v) => v.source), ["agent"]);
  });

  it("generate_image stores a cut-out asset, counts the call, and shows Claude the image", async () => {
    const job = fakeJob(projectId);
    const r = await runTool(job, mock, call("generate_image", {
      name: "铁盾", asset_type: "item_icon", prompt: "An iron shield icon, palette #112233 #aabbcc", aspect: "square", transparent_background: true,
    }));
    assert.notEqual(r.is_error, true);
    const content = r.content as Anthropic.Beta.BetaToolResultBlockParam["content"] & unknown[];
    assert.equal((content[1] as { type: string }).type, "image");
    assert.match((content[0] as { text: string }).text, /Palette check: \d+% of opaque pixels/);
    const asset = (await store.loadProject(projectId)).assets.at(-1)!;
    assert.equal(asset.name, "铁盾");
    assert.equal(asset.status, "pending_review");
    assert.ok(asset.originalFile, "mock's white backdrop was cut out");
    assert.ok(asset.palette && asset.palette.coverage > 0.5, JSON.stringify(asset.palette));
    assert.equal(job.usage.images.calls, 1);
    assert.ok(types(job.events).includes("asset"));
    assert.ok(types(job.events).includes("usage"));
  });

  it("generate_image slices sprite sheets", async () => {
    const job = fakeJob(projectId);
    await runTool(job, mock, call("generate_image", {
      name: "走路", asset_type: "sprite_sheet", prompt: "Walk cycle, four frames in one row", aspect: "landscape", transparent_background: true, frames: 4,
    }));
    const asset = (await store.loadProject(projectId)).assets.at(-1)!;
    assert.equal(asset.frames?.length, 4);
    assert.ok(asset.gif);
  });

  it("generate_image failures come back as tool errors and are counted", async () => {
    const job = fakeJob(projectId);
    const failing = { ...mock, generate: async () => { throw new Error("quota"); } };
    const r = await runTool(job, failing, call("generate_image", {
      name: "x", asset_type: "prop", prompt: "A barrel prop, wooden, simple", aspect: "square", transparent_background: false,
    }));
    assert.equal(r.is_error, true);
    assert.match(String(r.content), /quota/);
    assert.deepEqual([job.usage.images.calls, job.usage.images.failed], [1, 1]);
  });

  it("image API retries show up in the job log", async () => {
    const job = fakeJob(projectId);
    const flaky = {
      ...mock,
      generate: async (req: Parameters<typeof mock.generate>[0], signal?: AbortSignal) => {
        req.onRetry?.({ attempt: 1, delayMs: 2500, reason: "HTTP 429" });
        return mock.generate(req, signal);
      },
    };
    await runTool(job, flaky, call("generate_image", {
      name: "金币", asset_type: "item_icon", prompt: "A gold coin icon, shiny, centred", aspect: "square", transparent_background: true,
    }));
    const status = job.events.find((e) => e.type === "status") as { text: string } | undefined;
    assert.equal(status?.text, "「金币」图像接口限流（HTTP 429），3 秒后第 1 次重试");
  });

  it("review_asset records the verdict, or errors for unknown ids", async () => {
    const id = (await store.loadProject(projectId)).assets[0].id;
    const ok = await runTool(fakeJob(projectId), mock, call("review_asset", { asset_id: id, verdict: "rejected", consistency_score: 4, notes: "颜色偏了" }));
    assert.notEqual(ok.is_error, true);
    const a = (await store.loadProject(projectId)).assets[0];
    assert.deepEqual([a.status, a.score, a.notes, a.reviewer], ["rejected", 4, "颜色偏了", "agent"]);
    const bad = await runTool(fakeJob(projectId), mock, call("review_asset", { asset_id: "ast_nope", verdict: "approved", consistency_score: 9, notes: "" }));
    assert.equal(bad.is_error, true);
  });
});

describe("buildIntro", () => {
  it("asks for a style guide when there is none and lists selected types", async () => {
    const project = await projectWithRef();
    const text = buildIntro({ project, request: "做几把剑", assetTypes: ["item_icon", "bogus"] });
    assert.match(text, /No style guide yet/);
    assert.match(text, /item_icon（道具 \/ 装备图标）/);
    assert.doesNotMatch(text, /bogus/);
    assert.match(text, /做几把剑/);
  });

  it("describes a redraw task with the previous prompt and feedback", async () => {
    const project = await projectWithRef();
    project.styleGuide = validStyleGuide();
    project.assets.push({
      id: "ast_1", name: "剑", assetType: "item_icon", prompt: "old prompt", file: "assets/a.png", mime: "image/png",
      status: "approved", runId: "job", provider: "mock", createdAt: "",
    });
    const text = buildIntro({ project, request: "", assetTypes: [], redraw: { target: project.assets[0], feedback: "改成蓝色" } });
    assert.match(text, /REDRAW TASK/);
    assert.match(text, /改成蓝色/);
    assert.match(text, /replaces_asset_id="ast_1"/);
    assert.match(text, /old prompt/);
    assert.match(text, /Approved assets so far/);
    assert.doesNotMatch(text, /User request/);
  });
});

describe("demo style guide", () => {
  it("is a valid style guide derived from the dominant colour", () => {
    const sg = demoStyleGuide({ r: 255, g: 128, b: 0 });
    assert.ok(StyleGuideInput.safeParse(sg).success);
    assert.deepEqual(sg.palette.map((p) => p.hex), ["#ff8000", "#994d00", "#007fff"]);
  });
});
