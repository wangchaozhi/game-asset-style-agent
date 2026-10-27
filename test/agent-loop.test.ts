import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { type Recorded, type Turn, assetIdsFromLastToolResults, startFakeAnthropic } from "./fakeAnthropic.js";
import { solidPng, useTempDataDir, validStyleGuide } from "./helpers.js";

useTempDataDir();
const fake = await startFakeAnthropic();
process.env.ANTHROPIC_BASE_URL = fake.url;
process.env.ANTHROPIC_API_KEY = "sk-ant-test";
process.env.CLAUDE_MODEL = "claude-opus-5-5";
process.env.MOCK_DELAY_MS = "0";
delete process.env.AGENT_MODE;

const store = await import("../src/store/index.js");
const { startJob } = await import("../src/agent/index.js");
type AgentEvent = import("../src/agent/index.js").AgentEvent;

after(() => fake.close());
beforeEach(() => fake.reset());

async function newProject() {
  const p = await store.createProject("loop");
  await store.writeProjectFile(p.id, "refs/r.png", await solidPng(32, 32, "#3366cc"));
  await store.updateProject(p.id, (q) => void q.refs.push({ id: "ref_1", file: "refs/r.png", mime: "image/png", originalName: "r.png" }));
  return p.id;
}

/** Start a job and resolve with it once it is done. */
function run(opts: Partial<Parameters<typeof startJob>[0]> & { projectId: string }) {
  const job = startJob({ request: "做两个道具图标", assetTypes: ["item_icon"], providerId: "mock", continueConversation: true, ...opts });
  return new Promise<{ job: typeof job; events: AgentEvent[] }>((resolve) => {
    job.listeners.add((e) => e.type === "done" && resolve({ job, events: job.events }));
  });
}

const gen = (id: string, name: string) => ({
  type: "tool_use" as const, id, name: "generate_image",
  input: { name, asset_type: "item_icon", prompt: `${name}, palette #112233 #aabbcc #ffeedd, centred icon`, aspect: "square", transparent_background: true },
});
const say = (text: string, usage?: Turn["usage"]): Turn => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage });
const toolResults = (r: Recorded) =>
  (r.body.messages.at(-1)!.content as { type: string; tool_use_id: string; is_error?: boolean; content: unknown }[]).filter((b) => b.type === "tool_result");
const errorsOf = (events: AgentEvent[]) => events.filter((e) => e.type === "error");

describe("agent loop against a fake Messages API", () => {
  it("runs style guide → parallel generation → review → summary", async () => {
    const projectId = await newProject();
    fake.script(
      {
        content: [
          { type: "thinking", thinking: "先提炼风格。" },
          { type: "text", text: "我先提炼风格指南。" },
          { type: "tool_use", id: "toolu_sg", name: "save_style_guide", input: validStyleGuide() },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 2000, output_tokens: 300, cache_creation_input_tokens: 1500 },
      },
      { content: [gen("toolu_g1", "火焰剑"), gen("toolu_g2", "铁盾")], stop_reason: "tool_use", usage: { input_tokens: 50, output_tokens: 200, cache_read_input_tokens: 3500 } },
      (req) => {
        const [a, b] = assetIdsFromLastToolResults(req);
        return {
          content: [
            { type: "tool_use", id: "toolu_r1", name: "review_asset", input: { asset_id: a, verdict: "approved", consistency_score: 9, notes: "很好" } },
            { type: "tool_use", id: "toolu_r2", name: "review_asset", input: { asset_id: b, verdict: "rejected", consistency_score: 4, notes: "描边太细" } },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 30, output_tokens: 80, cache_read_input_tokens: 4200 },
        };
      },
      say("完成：火焰剑、铁盾。", { input_tokens: 40, output_tokens: 20, cache_read_input_tokens: 5000 }),
    );
    const { job, events } = await run({ projectId });

    assert.deepEqual(errorsOf(events), []);
    assert.equal(fake.pending(), 0);
    assert.equal(fake.requests.length, 4);

    // what was sent
    const first = fake.requests[0];
    assert.match(first.path, /^\/v1\/messages/);
    assert.equal(first.headers["x-api-key"], "sk-ant-test");
    assert.match(String(first.headers["anthropic-beta"]), /server-side-fallback/);
    assert.equal(first.body.model, "claude-opus-5-5");
    assert.equal(first.body.stream, true);
    assert.deepEqual((first.body.tools as { name: string }[]).map((t) => t.name), [
      "save_style_guide", "generate_image", "review_asset", "fix_tile_seams", "align_sprite_frames", "remove_background", "snap_to_palette",
      "set_nine_slice", "add_outline", "recolor_variant",
    ]);
    assert.deepEqual(first.body.thinking, { type: "adaptive", display: "summarized" });
    const opening = first.body.messages[0].content as { type: string; text?: string }[];
    assert.equal(opening.filter((b) => b.type === "image").length, 1, "the reference image is attached");
    const imgAt = opening.findIndex((b) => b.type === "image");
    assert.equal(opening[imgAt - 1].text, "Reference 1:", "each reference is numbered");
    assert.match(opening.at(-1)!.text!, /No style guide yet[\s\S]*做两个道具图标/);

    // the second request answers the style guide call; the third carries both generation results with images
    assert.deepEqual(toolResults(fake.requests[1]).map((t) => t.tool_use_id), ["toolu_sg"]);
    const genResults = toolResults(fake.requests[2]);
    assert.deepEqual(genResults.map((t) => t.tool_use_id), ["toolu_g1", "toolu_g2"]);
    for (const r of genResults) {
      const parts = r.content as { type: string; text?: string }[];
      assert.ok(parts.some((p) => p.type === "image"));
      assert.match(parts[0].text!, /asset_id=ast_[0-9a-f]+[\s\S]*Palette check/);
    }
    // assistant turns are echoed back verbatim, thinking signature included
    const echoed = fake.requests[1].body.messages[1].content as { type: string; signature?: string }[];
    assert.deepEqual(echoed.map((b) => b.type), ["thinking", "text", "tool_use"]);
    assert.equal(echoed[0].signature, "sig_0");

    // what happened
    const project = await store.loadProject(projectId);
    assert.deepEqual(project.styleGuide, validStyleGuide());
    const byName = Object.fromEntries(project.assets.map((a) => [a.name, a]));
    assert.deepEqual([byName["火焰剑"].status, byName["火焰剑"].score, byName["铁盾"].status, byName["铁盾"].notes], ["approved", 9, "rejected", "描边太细"]);
    assert.ok(events.some((e) => e.type === "thinking" && e.text === "先提炼风格。"));
    assert.equal(events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join(""), "我先提炼风格指南。完成：火焰剑、铁盾。");
    // The fake streams text in 8-character deltas; the stored log keeps one event per run of text.
    assert.ok(events.filter((e) => e.type === "text").length <= 2, "consecutive deltas are merged in the replay log");
    assert.deepEqual(events.filter((e) => e.type === "tool").map((e) => (e as { name: string }).name), ["save_style_guide", "generate_image", "generate_image", "review_asset", "review_asset"]);

    // usage: 4 requests, tokens summed, priced at Opus 5.5 rates
    assert.equal(job.usage.status, "ok");
    assert.equal(job.usage.claude.requests, 4);
    assert.deepEqual(job.usage.claude.byModel["claude-opus-5-5"], {
      input_tokens: 2120, output_tokens: 600, cache_creation_input_tokens: 1500, cache_read_input_tokens: 12700,
    });
    const expected = (2120 * 4 + 600 * 20 + 1500 * 5 + 12700 * 0.2) / 1e6;
    assert.ok(Math.abs(job.usage.cost.claude! - expected) < 1e-6, `${job.usage.cost.claude} vs ${expected}`);
    assert.equal(job.usage.images.calls, 2);

    // a finished run is persisted for the next one
    const conv = await store.loadConversation(projectId);
    assert.equal(conv!.messages.length, 8);
    assert.equal(conv!.runs.length, 1);
  });

  it("continues the conversation: history is resent unchanged, references are not re-attached", async () => {
    const projectId = await newProject();
    fake.script(say("第一轮"));
    await run({ projectId, request: "第一轮需求" });
    const firstSent = fake.requests[0].body.messages;
    fake.reset();
    fake.script(say("第二轮"));
    const { events } = await run({ projectId, request: "把剑改成蓝色" });
    assert.deepEqual(errorsOf(events), []);
    const msgs = fake.requests[0].body.messages;
    assert.equal(msgs.length, 3);
    assert.deepEqual(msgs[0], firstSent[0], "earlier turns are byte-identical");
    assert.equal(msgs[1].role, "assistant");
    const newTurn = msgs[2].content as { type: string; text?: string }[];
    assert.equal(newTurn.filter((b) => b.type === "image").length, 0);
    assert.match(newTurn[0].text!, /New request in the same project/);
    assert.match(newTurn.at(-1)!.text!, /把剑改成蓝色/);
    assert.ok(events.some((e) => e.type === "status" && /延续对话（第 2 轮）/.test((e as { text: string }).text)));
  });

  it("starts fresh when continueConversation is off", async () => {
    const projectId = await newProject();
    fake.script(say("一"));
    await run({ projectId });
    fake.reset();
    fake.script(say("二"));
    await run({ projectId, continueConversation: false });
    assert.equal(fake.requests[0].body.messages.length, 1);
  });

  it("sends malformed tool input back as an error and keeps going", async () => {
    const projectId = await newProject();
    fake.script(
      { content: [{ type: "tool_use", id: "toolu_bad", name: "generate_image", input: { name: "x" } }], stop_reason: "tool_use" },
      say("好的，我修正参数。"),
    );
    const { events } = await run({ projectId });
    assert.deepEqual(errorsOf(events), []);
    const [r] = toolResults(fake.requests[1]);
    assert.equal(r.is_error, true);
    assert.match(String(r.content), /INVALID_JSON/);
  });

  it("survives a tool call whose streamed JSON does not parse", async () => {
    const projectId = await newProject();
    fake.script(
      { content: [{ type: "tool_use", id: "toolu_trunc", name: "generate_image", input: {}, rawJson: '{"name": "剑", "asset_ty' }], stop_reason: "tool_use" },
      say("参数被截断了，我会重新调用。"),
    );
    const { events, job } = await run({ projectId });
    // The SDK parses what it can; validation rejects the incomplete input and Claude gets told so.
    assert.deepEqual(errorsOf(events), []);
    assert.equal(job.usage.status, "ok");
    const [r] = toolResults(fake.requests[1]);
    assert.equal(r.tool_use_id, "toolu_trunc");
    assert.equal(r.is_error, true);
    assert.match(String(r.content), /INVALID_JSON/);
    assert.equal((await store.loadProject(projectId)).assets.length, 0);
  });

  it("reports a refusal as an error and does not save the conversation", async () => {
    const projectId = await newProject();
    fake.script({ content: [], stop_reason: "refusal" });
    const { job, events } = await run({ projectId });
    assert.match((errorsOf(events)[0] as { message: string }).message, /模型拒绝了该请求/);
    assert.equal(job.usage.status, "error");
    assert.equal(await store.loadConversation(projectId), null);
  });

  it("surfaces API errors", async () => {
    const projectId = await newProject();
    fake.script({ content: [], stop_reason: "end_turn", error: { status: 400, type: "invalid_request_error", message: "bad things" } });
    const { events } = await run({ projectId });
    assert.match((errorsOf(events)[0] as { message: string }).message, /bad things/);
  });

  it("stops at AGENT_MAX_TURNS", async () => {
    const projectId = await newProject();
    process.env.AGENT_MAX_TURNS = "2";
    try {
      const loop: Turn = { content: [{ type: "tool_use", id: "toolu_x", name: "nope", input: {} }], stop_reason: "tool_use" };
      fake.script(loop, loop, loop);
      const { events } = await run({ projectId });
      assert.equal(fake.requests.length, 2);
      assert.ok(events.some((e) => e.type === "status" && /已达到最大轮数 2/.test((e as { text: string }).text)));
    } finally {
      delete process.env.AGENT_MAX_TURNS;
    }
  });

  it("prices tokens by the model that actually served the turn", async () => {
    const projectId = await newProject();
    fake.script({ ...say("fallback served"), model: "claude-sonnet-5-5", usage: { input_tokens: 1_000_000 } });
    const { job } = await run({ projectId });
    assert.deepEqual(Object.keys(job.usage.claude.byModel), ["claude-sonnet-5-5"]);
    assert.equal(job.usage.cost.claude, 2);
  });

  it("refuses generations past the image budget and tells Claude to wrap up", async () => {
    const projectId = await newProject();
    fake.script({ content: [gen("toolu_a", "一"), gen("toolu_b", "二"), gen("toolu_c", "三")], stop_reason: "tool_use" }, say("预算用完，已生成一个。"));
    const { job, events } = await run({ projectId, budget: { maxImages: 1 } });
    assert.deepEqual(errorsOf(events), []);
    assert.equal(job.usage.status, "ok");
    assert.equal(job.usage.images.calls, 1);
    const results = toolResults(fake.requests[1]);
    assert.equal(results.filter((r) => r.is_error && /BUDGET_EXHAUSTED/.test(String(r.content))).length, 2);
    assert.equal(events.filter((e) => e.type === "status" && /图像调用上限 1 次/.test((e as { text: string }).text)).length, 1, "noticed once");
    assert.ok(events.some((e) => e.type === "status" && /预算 图像 ≤ 1 次/.test((e as { text: string }).text)));
    assert.equal((await store.loadProject(projectId)).assets.length, 1);
    assert.deepEqual(job.usage.budget, { maxImages: 1, maxUsd: null });
  });

  it("cuts the loop off once spending is well past the cost cap", async () => {
    const projectId = await newProject();
    const pricey: Turn = { content: [{ type: "tool_use", id: "toolu_x", name: "nope", input: {} }], stop_reason: "tool_use", usage: { output_tokens: 100_000 } }; // $2
    fake.script(pricey, pricey, pricey);
    const { job, events } = await run({ projectId, budget: { maxUsd: 1 } });
    assert.equal(fake.requests.length, 1);
    assert.equal(job.usage.status, "ok");
    assert.ok(events.some((e) => e.type === "status" && /强制结束本次运行/.test((e as { text: string }).text)));
    assert.equal(await store.loadConversation(projectId), null, "an unfinished conversation is not saved");
  });

  it("fixes jitter with align_sprite_frames instead of regenerating", async () => {
    const projectId = await newProject();
    fake.script(
      {
        content: [{
          type: "tool_use", id: "toolu_walk", name: "generate_image",
          input: { name: "走路", asset_type: "sprite_sheet", prompt: "Fox walk cycle, 4 frames in one row", aspect: "landscape", transparent_background: true, frames: 4 },
        }],
        stop_reason: "tool_use",
      },
      (req) => {
        const [sheet] = assetIdsFromLastToolResults(req);
        const text = JSON.stringify(req.body.messages.at(-1)!.content);
        assert.match(text, /Frame jitter check: the character drifts/);
        return { content: [{ type: "tool_use", id: "toolu_align", name: "align_sprite_frames", input: { asset_id: sheet } }], stop_reason: "tool_use" };
      },
      (req) => {
        const text = JSON.stringify(req.body.messages.at(-1)!.content);
        const fixed = /New version asset_id=(ast_[0-9a-f]+)/.exec(text)![1];
        return {
          content: [{ type: "tool_use", id: "toolu_rev", name: "review_asset", input: { asset_id: fixed, verdict: "approved", consistency_score: 8, notes: "抖动已消除" } }],
          stop_reason: "tool_use",
        };
      },
      say("完成。"),
    );
    const { job, events } = await run({ projectId });
    assert.deepEqual(errorsOf(events), []);
    assert.equal(job.usage.images.calls, 1, "the fix cost no image call");
    const assets = (await store.loadProject(projectId)).assets;
    assert.equal(assets.length, 2);
    const fixed = assets.find((a) => a.parentId)!;
    assert.deepEqual([fixed.status, fixed.provider, fixed.reviewer], ["approved", "postprocess", "agent"]);
  });

  it("manual regeneration goes straight to the image model, never to Claude", async () => {
    const projectId = await newProject();
    fake.script({ content: [gen("toolu_g", "木剑")], stop_reason: "tool_use" }, say("ok"));
    await run({ projectId });
    const old = (await store.loadProject(projectId)).assets[0];
    fake.reset();
    const { job, events } = await run({ projectId, request: "", manual: { assetId: old.id, prompt: "A wooden sword icon, blue blade, thick outline" } });
    assert.deepEqual(errorsOf(events), []);
    assert.equal(fake.requests.length, 0, "no Messages API call");
    assert.deepEqual([job.usage.mode, job.usage.claude.requests, job.usage.images.calls], ["manual", 0, 1]);
    const created = (await store.loadProject(projectId)).assets.at(-1)!;
    assert.deepEqual([created.parentId, created.prompt, created.status], [old.id, "A wooden sword icon, blue blade, thick outline", "pending_review"]);
    assert.match(job.usage.request, /^直接重生成：A wooden sword/);
  });

  it("redraws several assets in one run, each with its own feedback", async () => {
    const projectId = await newProject();
    fake.script({ content: [gen("toolu_1", "一"), gen("toolu_2", "二")], stop_reason: "tool_use" }, say("ok"));
    await run({ projectId });
    const [a, b] = (await store.loadProject(projectId)).assets;
    fake.reset();
    fake.script(say("planned"));
    const { job } = await run({ projectId, request: "", continueConversation: false, redraws: [{ assetId: a.id, feedback: "更亮" }, { assetId: b.id, feedback: "" }] });
    const turn = fake.requests[0].body.messages[0].content as { type: string; text?: string }[];
    assert.equal(turn.filter((x) => x.type === "image").length, 3, "reference + both assets");
    const text = turn.at(-1)!.text!;
    assert.match(text, /REDRAW TASKS \(2\)/);
    assert.match(text, new RegExp(`1\\. asset ${a.id}[\\s\\S]*Feedback: 更亮[\\s\\S]*replaces_asset_id="${a.id}"`));
    assert.match(text, new RegExp(`2\\. asset ${b.id}[\\s\\S]*none given`));
    assert.equal(job.usage.request, "重画 2 个素材");
  });

  it("a redraw sends the old image and asks for exactly one replacement", async () => {
    const projectId = await newProject();
    fake.script({ content: [gen("toolu_g", "木剑")], stop_reason: "tool_use" }, say("ok"));
    await run({ projectId });
    const old = (await store.loadProject(projectId)).assets[0];
    fake.reset();
    fake.script(say("redraw planned"));
    await run({ projectId, request: "", redraws: [{ assetId: old.id, feedback: "剑身改成蓝色" }], continueConversation: false });
    const turn = fake.requests[0].body.messages[0].content as { type: string; text?: string }[];
    assert.equal(turn.filter((b) => b.type === "image").length, 2, "reference + the asset to redraw");
    assert.match(turn.at(-1)!.text!, new RegExp(`REDRAW TASK[\\s\\S]*剑身改成蓝色[\\s\\S]*replaces_asset_id="${old.id}"`));
  });
});
