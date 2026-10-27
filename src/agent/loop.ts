import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { shrink } from "../image/io.js";
import { getProvider } from "../providers/index.js";
import { loadConversation, loadProject, readProjectFile, saveConversation } from "../store/index.js";
import { addTokens } from "../usage/record.js";
import { refImages } from "./assets.js";
import { pastHardStop } from "./budget.js";
import { type Job, type RunOptions, emit, reportUsage, requestLabel } from "./events.js";
import { SYSTEM, buildIntro } from "./prompts.js";
import { runTool } from "./runTool.js";
import { tools } from "./tools.js";

type Message = Anthropic.Beta.BetaMessageParam;
type ImageBlock = Anthropic.Beta.BetaImageBlockParam;

const jpegBlock = (data: Buffer): ImageBlock => ({
  type: "image",
  source: { type: "base64", media_type: "image/jpeg", data: data.toString("base64") },
});

/** The real agent: a hand-written tool-use loop against the Messages API. */
export async function runAgent(job: Job, opts: RunOptions) {
  const client = new Anthropic();
  const provider = getProvider(opts.providerId);
  const project = await loadProject(opts.projectId);
  if (!project.refs.length && !project.styleGuide) throw new Error("请先上传至少一张风格参考图，或在新建项目时选择风格预设");
  const model = config.model;

  const refs = await Promise.all((await refImages(project)).map((r) => shrink(r, 1024)));
  const redraws = (opts.redraws ?? []).map((r) => {
    const target = project.assets.find((a) => a.id === r.assetId);
    if (!target) throw new Error("要重画的素材不存在");
    return { target, feedback: r.feedback };
  });
  const redrawImages = await Promise.all(
    redraws.map(async (r) => shrink({ data: await readProjectFile(project.id, r.target.file), mime: r.target.mime }, 768)),
  );

  const intro = buildIntro({ project, request: opts.request, assetTypes: opts.assetTypes, redraws });

  // History is append-only: earlier turns (including thinking blocks) are sent back byte-for-byte.
  let history = opts.continueConversation ? await loadConversation(project.id) : null;
  if (history && JSON.stringify(history.messages).length > config.conversationLimitBytes) {
    emit(job, { type: "status", text: "对话历史过长，本次开启新对话（风格指南与素材不受影响）" });
    history = null;
  }
  const continuing = !!history?.messages.length;
  const messages: Message[] = [
    ...((history?.messages ?? []) as Message[]),
    {
      role: "user",
      content: [
        continuing
          ? { type: "text", text: "New request in the same project. The style guide below is current (the user may have edited it since)." }
          : refs.length
            ? { type: "text", text: `Style reference images (${refs.length}):` }
            : { type: "text", text: "No reference images: this project starts from its style guide (a built-in preset or the user's own). Follow it exactly." },
        // Number the references so notes in the intro ("Reference 2: …") can point at them.
        ...(continuing ? [] : refs.flatMap((r, i) => [{ type: "text" as const, text: `Reference ${i + 1}:` }, jpegBlock(r.data)])),
        ...redraws.flatMap((r, i) => [{ type: "text" as const, text: `Asset to redraw (${r.target.id}):` }, jpegBlock(redrawImages[i].data)]),
        { type: "text", text: intro },
      ],
    },
  ];

  const limits = [
    job.budget.maxImages !== null ? `图像 ≤ ${job.budget.maxImages} 次` : "",
    job.budget.maxUsd !== null ? `费用 ≤ $${job.budget.maxUsd}` : "",
  ].filter(Boolean);
  emit(job, {
    type: "status",
    text: `Agent 启动 · ${model} · 图像通道 ${provider.label}${continuing ? ` · 延续对话（第 ${history!.runs.length + 1} 轮）` : ""}${limits.length ? ` · 预算 ${limits.join("，")}` : ""}`,
  });
  const persist = async () => {
    const runs = [...(history?.runs ?? []), { request: requestLabel(opts), at: new Date().toISOString() }];
    await saveConversation(project.id, { messages, runs });
  };
  let jsonRetries = 0;

  for (let turn = 0; turn < config.maxTurns; turn++) {
    if (pastHardStop(job.budget, job.usage)) {
      emit(job, { type: "status", text: `估算费用 $${job.usage.cost.total.toFixed(3)} 已明显超过上限 $${job.budget.maxUsd}，强制结束本次运行` });
      return;
    }
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        cache_control: { type: "ephemeral" },
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: config.effort },
        system: SYSTEM,
        tools,
        messages,
      },
      { signal: job.abort.signal },
    );
    stream.on("text", (delta) => emit(job, { type: "text", delta }));

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // A failed stream may still have billed tokens; record what the SDK saw.
      const partial = stream.currentMessage;
      if (partial?.usage) {
        addTokens(job.usage, partial.model ?? model, partial.usage);
        reportUsage(job);
      }
      if (err instanceof Anthropic.APIError || job.abort.signal.aborted || jsonRetries++ >= 2) throw err;
      emit(job, { type: "status", text: "工具参数解析失败，重试本轮" });
      continue;
    }

    addTokens(job.usage, message.model ?? model, message.usage);
    reportUsage(job);

    for (const b of message.content) {
      if (b.type === "thinking" && b.thinking) emit(job, { type: "thinking", text: b.thinking });
    }

    if (message.stop_reason === "refusal") {
      throw new Error(`模型拒绝了该请求${message.stop_details?.explanation ? `：${message.stop_details.explanation}` : ""}`);
    }
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }

    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (message.stop_reason === "end_turn" || toolUses.length === 0) {
      // Only a cleanly finished run is saved, so the stored history never ends on an unanswered tool call.
      messages.push({ role: "assistant", content: message.content });
      await persist();
      return;
    }
    if (message.stop_reason === "max_tokens") throw new Error("输出超出 max_tokens，工具参数被截断");

    messages.push({ role: "assistant", content: message.content });
    for (const t of toolUses) emit(job, { type: "tool", name: t.name, input: t.input });
    // Every tool_result goes back in one user message; generations run concurrently.
    const results = await Promise.all(toolUses.map((t) => runTool(job, provider, t)));
    messages.push({ role: "user", content: results });
  }
  emit(job, { type: "status", text: `已达到最大轮数 ${config.maxTurns}，停止` });
}
