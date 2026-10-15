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
    assert.deepEqual(tools.map((t) => t.name), [
      "save_style_guide", "generate_image", "review_asset", "fix_tile_seams", "align_sprite_frames", "remove_background",
    ]);
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

describe("post-processing tools", () => {
  let projectId: string;
  before(async () => {
    projectId = (await projectWithRef()).id;
    await runTool(fakeJob(projectId), mock, call("generate_image", {
      name: "盾", asset_type: "item_icon", prompt: "A round wooden shield icon, centred", aspect: "square", transparent_background: true,
    }));
  });
  const textOf = (r: Anthropic.Beta.BetaToolResultBlockParam) => ((r.content as { type: string; text?: string }[])[0].text ?? String(r.content));

  /** A tile with an obvious left/right seam. */
  async function addSeamyTile() {
    const w = 64;
    const raw = Buffer.alloc(w * w * 3);
    for (let i = 0; i < w * w; i++) raw.fill(Math.round(((i % w) / (w - 1)) * 255), i * 3, i * 3 + 3);
    const { default: sharp } = await import("sharp");
    const png = await sharp(raw, { raw: { width: w, height: w, channels: 3 } }).png().toBuffer();
    await store.writeProjectFile(projectId, "assets/ast_tile0001.png", png);
    await store.updateProject(projectId, (p) => void p.assets.push({
      id: "ast_tile0001", name: "草地", assetType: "tile", prompt: "grass", file: "assets/ast_tile0001.png", mime: "image/png",
      status: "pending_review", runId: "job_x", provider: "mock", createdAt: "",
    }));
    return "ast_tile0001";
  }

  it("generate_image reports seam and jitter checks for tiles and sprite sheets", async () => {
    const job = fakeJob(projectId);
    const tile = await runTool(job, mock, call("generate_image", { name: "地面", asset_type: "tile", prompt: "Flat ground tile, seamless, top-down", aspect: "square", transparent_background: false }));
    assert.match(textOf(tile), /Seam check:/);
    const sheet = await runTool(job, mock, call("generate_image", { name: "走路", asset_type: "sprite_sheet", prompt: "Walk cycle in one row, 4 frames", aspect: "landscape", transparent_background: true, frames: 4 }));
    assert.match(textOf(sheet), /Frame jitter check: the character drifts \d+(\.\d+)?px horizontally and \d+(\.\d+)?px vertically/);
  });

  it("fix_tile_seams makes a seamless new version owned by the run", async () => {
    const id = await addSeamyTile();
    const job = fakeJob(projectId);
    const r = await runTool(job, mock, call("fix_tile_seams", { asset_id: id, overlap: 0.2 }));
    assert.notEqual(r.is_error, true);
    assert.match(textOf(r), /Before: Seam check: FAILS[\s\S]*After: Seam check: tiles seamlessly/);
    const created = (await store.loadProject(projectId)).assets.at(-1)!;
    assert.deepEqual([created.parentId, created.reviewer, created.runId, created.status], [id, "agent", "job_test", "pending_review"]);
    assert.ok(job.events.some((e) => e.type === "asset"));
  });

  it("align_sprite_frames removes the mock walk cycle's bobbing", async () => {
    const sheet = (await store.loadProject(projectId)).assets.find((a) => a.assetType === "sprite_sheet")!;
    const r = await runTool(fakeJob(projectId), mock, call("align_sprite_frames", { asset_id: sheet.id }));
    assert.match(textOf(r), /after: 0px \/ 0px/);
    assert.equal((await store.loadProject(projectId)).assets.at(-1)!.frames?.length, 4);
  });

  it("remove_background re-cuts in place and keeps the original", async () => {
    const icon = (await store.loadProject(projectId)).assets.find((a) => a.assetType === "item_icon")!;
    const r = await runTool(fakeJob(projectId), mock, call("remove_background", { asset_id: icon.id, tolerance: 60 }));
    assert.notEqual(r.is_error, true);
    const after = (await store.loadProject(projectId)).assets.find((a) => a.id === icon.id)!;
    assert.notEqual(after.file, icon.file);
    assert.ok(after.originalFile);
  });

  it("refuses the wrong asset type or an unknown id", async () => {
    const icon = (await store.loadProject(projectId)).assets.find((a) => a.assetType === "item_icon")!;
    assert.equal((await runTool(fakeJob(projectId), mock, call("fix_tile_seams", { asset_id: icon.id }))).is_error, true);
    assert.equal((await runTool(fakeJob(projectId), mock, call("align_sprite_frames", { asset_id: icon.id }))).is_error, true);
    assert.equal((await runTool(fakeJob(projectId), mock, call("remove_background", { asset_id: "ast_none" }))).is_error, true);
    assert.match(String((await runTool(fakeJob(projectId), mock, call("fix_tile_seams", { asset_id: icon.id, overlap: 2 }))).content), /INVALID_JSON/);
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
