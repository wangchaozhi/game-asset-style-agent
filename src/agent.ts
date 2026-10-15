import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  type Asset,
  type Project,
  type StyleGuide,
  extFor,
  loadConversation,
  loadProject,
  saveConversation,
  newId,
  readProjectFile,
  updateProject,
  writeProjectFile,
} from "./store.js";
import { type ImageInput, type ImageProvider, getProvider, shrink } from "./imageProviders.js";
import { detectFrameCount, sliceSheet } from "./spriteSheet.js";
import { isOpaque, removeBackground } from "./postprocess.js";
import { type RunUsage, addImageCall, addTokens, newRunUsage, saveRunUsage } from "./usage.js";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.CLAUDE_EFFORT ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max";
const MAX_TURNS = Number(process.env.AGENT_MAX_TURNS ?? 40);
/** Past this size a project starts a fresh conversation so requests stay well under the API's size limit. */
const CONVERSATION_LIMIT_BYTES = Number(process.env.CONVERSATION_LIMIT_MB ?? 12) * 1024 * 1024;

export const ASSET_TYPES = {
  character: "角色立绘 / 角色设定",
  sprite_sheet: "角色动画帧（精灵表）",
  enemy: "敌人 / 怪物",
  item_icon: "道具 / 装备图标",
  tile: "地图瓦片 / 地形",
  prop: "场景物件",
  background: "场景背景",
  ui: "UI 元素（按钮、面板、图标）",
  vfx: "技能特效",
  portrait: "头像 / 对话立绘",
} as const;
type AssetType = keyof typeof ASSET_TYPES;
const ASSET_TYPE_KEYS = Object.keys(ASSET_TYPES) as [AssetType, ...AssetType[]];

// ---------------- events ----------------

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "text"; delta: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string; input: unknown }
  | { type: "style"; styleGuide: StyleGuide }
  | { type: "asset"; asset: Asset }
  | { type: "error"; message: string }
  | { type: "usage"; usage: RunUsage }
  | { type: "done"; summary?: string };

export interface Job {
  id: string;
  projectId: string;
  events: AgentEvent[];
  listeners: Set<(e: AgentEvent) => void>;
  finished: boolean;
  abort: AbortController;
  usage: RunUsage;
}

export const jobs = new Map<string, Job>();

function emit(job: Job, e: AgentEvent) {
  // Only the latest usage snapshot is worth replaying to late subscribers.
  if (e.type === "usage") {
    const i = job.events.findIndex((x) => x.type === "usage");
    if (i >= 0) job.events.splice(i, 1);
  }
  job.events.push(e);
  for (const l of job.listeners) l(e);
}

/** Broadcast the job's running usage and persist it to the project's usage log. */
function reportUsage(job: Job) {
  emit(job, { type: "usage", usage: structuredClone(job.usage) });
  saveRunUsage(job.projectId, job.usage).catch(() => undefined);
}

// ---------------- tools ----------------

export const StyleGuideInput = z.object({
  summary: z.string().min(1),
  palette: z.array(z.object({ hex: z.string().regex(/^#[0-9a-fA-F]{6}$/), role: z.string() })).min(3),
  rendering: z.string(),
  line_and_edges: z.string(),
  lighting_and_shading: z.string(),
  perspective: z.string(),
  proportions: z.string(),
  texture_and_detail: z.string(),
  mood: z.string(),
  avoid: z.array(z.string()),
  prompt_prefix: z.string().min(20),
});

const GenerateInput = z.object({
  name: z.string().min(1),
  asset_type: z.enum(ASSET_TYPE_KEYS),
  prompt: z.string().min(20),
  aspect: z.enum(["square", "landscape", "portrait"]),
  transparent_background: z.boolean(),
  consistency_asset_ids: z.array(z.string()).max(4).optional(),
  frames: z.number().int().min(2).max(16).optional(),
  replaces_asset_id: z.string().optional(),
});

const ReviewInput = z.object({
  asset_id: z.string(),
  verdict: z.enum(["approved", "rejected"]),
  consistency_score: z.number().int().min(1).max(10),
  notes: z.string(),
});

const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: "save_style_guide",
    description:
      "Persist the project's style bible, distilled from the reference images. Every later generation prompt is built on it, so be concrete and visual (e.g. '2px dark-purple outline, cel shading with exactly 2 tones, 3/4 top-down camera, 1:2.5 head-to-body chibi proportions') rather than vague ('nice, colorful'). Call again only if the user asks to change the style.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One or two sentences naming the overall style, in the user's language." },
        palette: {
          type: "array",
          description: "5-10 dominant colours sampled from the references.",
          items: {
            type: "object",
            properties: { hex: { type: "string", description: "#RRGGBB" }, role: { type: "string" } },
            required: ["hex", "role"],
          },
        },
        rendering: { type: "string", description: "Medium / technique: pixel art (state the pixel density), vector flat, hand-painted, 3D render, etc." },
        line_and_edges: { type: "string" },
        lighting_and_shading: { type: "string" },
        perspective: { type: "string", description: "Camera angle and projection, e.g. side-view, isometric 2:1, top-down 3/4." },
        proportions: { type: "string" },
        texture_and_detail: { type: "string" },
        mood: { type: "string" },
        avoid: { type: "array", items: { type: "string" }, description: "Things that would break the style." },
        prompt_prefix: {
          type: "string",
          description: "An English style paragraph (60-120 words) to prepend to every image prompt. Must include the palette hex codes.",
        },
      },
      required: [
        "summary", "palette", "rendering", "line_and_edges", "lighting_and_shading", "perspective",
        "proportions", "texture_and_detail", "mood", "avoid", "prompt_prefix",
      ],
    },
  },
  {
    name: "generate_image",
    description:
      "Generate one game asset with the image model. The project's style reference images are attached automatically; you write the full English prompt. Returns the asset id and the rendered image so you can inspect it. Several calls in one turn run in parallel.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short display name in the user's language, e.g. '火焰剑'." },
        asset_type: { type: "string", enum: ASSET_TYPE_KEYS },
        prompt: {
          type: "string",
          description: "Complete English prompt: style prefix + subject + composition rules for this asset type + what to avoid.",
        },
        aspect: { type: "string", enum: ["square", "landscape", "portrait"] },
        transparent_background: { type: "boolean", description: "true for icons, sprites, props, UI, VFX; false for backgrounds and tiles." },
        consistency_asset_ids: {
          type: "array",
          items: { type: "string" },
          description: "Up to 4 previously generated asset ids to also attach as references, e.g. the approved character design when drawing its sprite sheet or portrait.",
        },
        replaces_asset_id: {
          type: "string",
          description: "When this is a redraw of an existing asset, its id (links the versions).",
        },
        frames: {
          type: "integer",
          description: "sprite_sheet only: number of animation frames in the single horizontal row (2-16). The sheet is sliced into frames and a GIF preview automatically.",
        },
      },
      required: ["name", "asset_type", "prompt", "aspect", "transparent_background"],
    },
  },
  {
    name: "review_asset",
    description:
      "Record your verdict on a generated asset after comparing it to the reference images and style guide. Reject when palette, rendering technique, line work, perspective or proportions drift, or when the asset is unusable for its type (cropped, text artefacts, wrong background, inconsistent character).",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        asset_id: { type: "string" },
        verdict: { type: "string", enum: ["approved", "rejected"] },
        consistency_score: { type: "integer", description: "1-10 style consistency with the references." },
        notes: { type: "string", description: "Short reason in the user's language." },
      },
      required: ["asset_id", "verdict", "consistency_score", "notes"],
    },
  },
];

const SYSTEM = `You are an art director agent for a game studio. Your job: produce game assets that look like they come from the same game as the user's reference images.

How you work:
1. If the project has no style guide yet, study the reference images closely and call save_style_guide. Pin down concrete, reproducible traits: palette hex codes, rendering technique, outline weight and colour, shading steps, light direction, camera/perspective, proportions, level of detail.
2. Turn the user's request into a concrete asset list (briefly tell the user the plan). Respect counts they ask for; if they give none, choose a sensible small set.
3. For each asset call generate_image. Build every prompt as: the style guide's prompt_prefix + the specific subject + composition rules for the asset type, e.g.
   - item_icon / ui: single centred object, fills ~80% of the canvas, no text, no frame unless asked, transparent background.
   - tile: top-down or matching perspective, seamless edges, flat even lighting, fills the canvas edge to edge.
   - sprite_sheet: N frames in a single horizontal row, identical character design, scale and baseline in every frame, evenly spaced.
   - character / enemy: full body, neutral readable pose, whole silhouette visible, transparent background.
   - background: no characters, leave gameplay space, matching perspective.
   When an asset must match an earlier one (same character in a new pose, matching set of icons), pass its id in consistency_asset_ids.
   Issue independent generations in parallel in one turn.
4. Look at every returned image and call review_asset. If rejected, regenerate with a corrected prompt that names the specific drift. Retry each asset at most twice.
5. Finish with a short summary in the user's language: what was made, and anything that still drifts.

Write your messages to the user in the same language they use (usually Chinese). Keep narration brief; the UI already shows every image.`;

// ---------------- helpers ----------------

async function refImages(project: Project): Promise<ImageInput[]> {
  return Promise.all(
    project.refs.map(async (r) => ({ data: await readProjectFile(project.id, r.file), mime: r.mime })),
  );
}

function styleGuideText(sg: StyleGuide) {
  return JSON.stringify(sg, null, 2);
}

function errResult(id: string, message: string): Anthropic.Beta.BetaToolResultBlockParam {
  return { type: "tool_result", tool_use_id: id, is_error: true, content: message };
}

// ---------------- the agent loop ----------------

export interface RunOptions {
  projectId: string;
  request: string;
  assetTypes: string[];
  providerId?: string;
  /** redraw one asset following the user's feedback */
  redraw?: { assetId: string; feedback: string };
  /** append to the project's previous agent conversation instead of starting fresh */
  continueConversation?: boolean;
}

export function startJob(opts: RunOptions): Job {
  const id = newId("job");
  const demo = process.env.AGENT_MODE === "demo";
  const job: Job = {
    id,
    projectId: opts.projectId,
    events: [],
    listeners: new Set(),
    finished: false,
    abort: new AbortController(),
    usage: newRunUsage(id, opts.redraw ? `重画：${opts.redraw.feedback}` : opts.request, demo ? "demo" : "agent"),
  };
  jobs.set(job.id, job);
  const runner = demo ? runDemo : runAgent;
  runner(job, opts)
    .then(() => {
      job.usage.status = "ok";
    })
    .catch((err: unknown) => {
      job.usage.status = job.abort.signal.aborted ? "stopped" : "error";
      if (job.abort.signal.aborted) emit(job, { type: "status", text: "已停止" });
      else emit(job, { type: "error", message: err instanceof Error ? err.message : String(err) });
    })
    .finally(() => {
      job.usage.finishedAt = new Date().toISOString();
      reportUsage(job);
      job.finished = true;
      emit(job, { type: "done" });
      setTimeout(() => jobs.delete(job.id), 30 * 60_000);
    });
  return job;
}

async function generateAsset(
  job: Job,
  provider: ImageProvider,
  input: z.infer<typeof GenerateInput>,
): Promise<{ asset: Asset; image: ImageInput }> {
  const project = await loadProject(job.projectId);
  const refs = await Promise.all((await refImages(project)).map((r) => shrink(r, 1024)));
  const extra = await Promise.all(
    (input.consistency_asset_ids ?? [])
      .map((id) => project.assets.find((a) => a.id === id))
      .filter((a): a is Asset => !!a)
      .map(async (a) => shrink({ data: await readProjectFile(project.id, a.file), mime: a.mime }, 1024)),
  );
  let img: ImageInput;
  try {
    img = await provider.generate(
      {
        prompt: input.prompt,
        references: [...extra, ...refs],
        aspect: input.aspect,
        transparent: input.transparent_background,
        frames: input.asset_type === "sprite_sheet" ? (input.frames ?? 4) : undefined,
      },
      job.abort.signal,
    );
  } catch (err) {
    addImageCall(job.usage, provider.id, false);
    reportUsage(job);
    throw err;
  }
  addImageCall(job.usage, provider.id, true);
  reportUsage(job);
  const id = newId("ast");
  let originalFile: string | undefined;
  // Many image models can't output alpha; cut the flat backdrop out ourselves.
  if (input.transparent_background && (await isOpaque(img.data))) {
    originalFile = `assets/${id}_orig.${extFor(img.mime)}`;
    await writeProjectFile(project.id, originalFile, img.data);
    img = { data: await removeBackground(img.data), mime: "image/png" };
  }
  const file = `assets/${id}.${extFor(img.mime)}`;
  await writeProjectFile(project.id, file, img.data);
  const asset: Asset = {
    id,
    name: input.name,
    assetType: input.asset_type,
    prompt: input.prompt,
    file,
    mime: img.mime,
    status: "pending_review",
    runId: job.id,
    provider: provider.id,
    createdAt: new Date().toISOString(),
    originalFile,
    parentId: input.replaces_asset_id,
  };
  if (input.asset_type === "sprite_sheet") {
    Object.assign(asset, await sliceAssetFrames(project.id, asset, img.data, input.frames).catch(() => ({})));
  }
  await updateProject(project.id, (p) => {
    p.assets.push(asset);
  });
  emit(job, { type: "asset", asset });
  return { asset, image: img };
}

/**
 * Slice a sprite sheet into frame PNGs + GIF and return the fields to merge into the asset.
 * Frame count: explicit value, else detected from transparent gaps, else 4.
 */
export async function sliceAssetFrames(
  projectId: string,
  asset: Pick<Asset, "id">,
  data: Buffer,
  frameCount?: number,
  fps = 8,
): Promise<Pick<Asset, "frames" | "gif" | "fps">> {
  const count = frameCount ?? (await detectFrameCount(data)) ?? 4;
  const sheet = await sliceSheet(data, count, fps);
  const frames = await Promise.all(
    sheet.frames.map(async (buf, i) => {
      const rel = `assets/${asset.id}_f${i}.png`;
      await writeProjectFile(projectId, rel, buf);
      return rel;
    }),
  );
  const gif = `assets/${asset.id}.gif`;
  await writeProjectFile(projectId, gif, sheet.gif);
  return { frames, gif, fps };
}

async function runTool(
  job: Job,
  provider: ImageProvider,
  block: Anthropic.Beta.BetaToolUseBlock,
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const invalid = () => errResult(block.id, JSON.stringify({ INVALID_JSON: JSON.stringify(block.input) }));
  switch (block.name) {
    case "save_style_guide": {
      const parsed = StyleGuideInput.safeParse(block.input);
      if (!parsed.success) return invalid();
      await updateProject(job.projectId, (p) => {
        p.styleGuide = parsed.data;
      });
      emit(job, { type: "style", styleGuide: parsed.data });
      return { type: "tool_result", tool_use_id: block.id, content: "Style guide saved." };
    }
    case "generate_image": {
      const parsed = GenerateInput.safeParse(block.input);
      if (!parsed.success) return invalid();
      try {
        const { asset, image } = await generateAsset(job, provider, parsed.data);
        const preview = await shrink(image, 768);
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: [
            { type: "text", text: `asset_id=${asset.id} name=${asset.name}. Review it against the references now.` },
            {
              type: "image",
              source: { type: "base64", media_type: preview.mime as "image/jpeg", data: preview.data.toString("base64") },
            },
          ],
        };
      } catch (err) {
        if (job.abort.signal.aborted) throw err;
        return errResult(block.id, `Image generation failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    case "review_asset": {
      const parsed = ReviewInput.safeParse(block.input);
      if (!parsed.success) return invalid();
      let updated: Asset | undefined;
      await updateProject(job.projectId, (p) => {
        updated = p.assets.find((a) => a.id === parsed.data.asset_id);
        if (!updated) return;
        updated.status = parsed.data.verdict;
        updated.score = parsed.data.consistency_score;
        updated.notes = parsed.data.notes;
        updated.reviewer = "agent";
      });
      if (!updated) return errResult(block.id, `Unknown asset_id ${parsed.data.asset_id}`);
      emit(job, { type: "asset", asset: updated });
      return { type: "tool_result", tool_use_id: block.id, content: "Recorded." };
    }
    default:
      return errResult(block.id, `Unknown tool ${block.name}`);
  }
}

async function runAgent(job: Job, opts: RunOptions) {
  const client = new Anthropic();
  const provider = getProvider(opts.providerId);
  const project = await loadProject(opts.projectId);
  if (!project.refs.length) throw new Error("请先上传至少一张风格参考图");

  const refs = await Promise.all((await refImages(project)).map((r) => shrink(r, 1024)));
  const existing = project.assets.filter((a) => a.status === "approved");
  const typeLabels = opts.assetTypes
    .filter((t): t is AssetType => t in ASSET_TYPES)
    .map((t) => `${t}（${ASSET_TYPES[t]}）`);

  const redrawTarget = opts.redraw ? project.assets.find((a) => a.id === opts.redraw!.assetId) : undefined;
  if (opts.redraw && !redrawTarget) throw new Error("要重画的素材不存在");
  const redrawImage = redrawTarget
    ? await shrink({ data: await readProjectFile(project.id, redrawTarget.file), mime: redrawTarget.mime }, 768)
    : undefined;

  const intro = [
    `Project: ${project.name}`,
    project.styleGuide
      ? `This project already has a style guide. Reuse it as-is:\n${styleGuideText(project.styleGuide)}`
      : "No style guide yet: create one first from the reference images above.",
    existing.length
      ? `Approved assets so far (usable in consistency_asset_ids):\n${existing.map((a) => `- ${a.id} ${a.name} [${a.assetType}]`).join("\n")}`
      : "",
    typeLabels.length ? `Asset categories the user selected: ${typeLabels.join(", ")}` : "",
    redrawTarget
      ? `REDRAW TASK. The user reviewed asset ${redrawTarget.id} "${redrawTarget.name}" [${redrawTarget.assetType}] (shown in the last image above) and wants it redrawn.
Their feedback: ${opts.redraw!.feedback || "(none given: fix whatever drifts from the style)"}
Previous prompt:\n${redrawTarget.prompt}
Generate exactly one new version with generate_image, passing replaces_asset_id="${redrawTarget.id}" and consistency_asset_ids=["${redrawTarget.id}"], keep the same name, asset_type and aspect, apply the feedback precisely, then review it. Do not create other assets.`
      : `User request:\n${opts.request || "按参考图风格生成一套基础素材。"}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  // History is append-only: earlier turns (including thinking blocks) are sent back byte-for-byte.
  let history = opts.continueConversation ? await loadConversation(project.id) : null;
  if (history && JSON.stringify(history.messages).length > CONVERSATION_LIMIT_BYTES) {
    emit(job, { type: "status", text: "对话历史过长，本次开启新对话（风格指南与素材不受影响）" });
    history = null;
  }
  const continuing = !!history?.messages.length;
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...((history?.messages ?? []) as Anthropic.Beta.BetaMessageParam[]),
    {
      role: "user",
      content: [
        ...(continuing
          ? [{ type: "text" as const, text: "New request in the same project. The style guide below is current (the user may have edited it since)." }]
          : [{ type: "text" as const, text: `Style reference images (${refs.length}):` }]),
        ...(continuing ? [] : refs).map(
          (r): Anthropic.Beta.BetaImageBlockParam => ({
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: r.data.toString("base64") },
          }),
        ),
        ...(redrawImage
          ? [
              { type: "text" as const, text: `Asset to redraw (${redrawTarget!.id}):` },
              {
                type: "image" as const,
                source: { type: "base64" as const, media_type: "image/jpeg" as const, data: redrawImage.data.toString("base64") },
              },
            ]
          : []),
        { type: "text", text: intro },
      ],
    },
  ];

  emit(job, {
    type: "status",
    text: `Agent 启动 · ${MODEL} · 图像通道 ${provider.label}${continuing ? ` · 延续对话（第 ${history!.runs.length + 1} 轮）` : ""}`,
  });
  const persist = async () => {
    const runs = [...(history?.runs ?? []), { request: opts.redraw ? `重画：${opts.redraw.feedback}` : opts.request, at: new Date().toISOString() }];
    await saveConversation(project.id, { messages, runs });
  };
  let jsonRetries = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        cache_control: { type: "ephemeral" },
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: EFFORT },
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
        addTokens(job.usage, partial.model ?? MODEL, partial.usage);
        reportUsage(job);
      }
      if (err instanceof Anthropic.APIError || job.abort.signal.aborted || jsonRetries++ >= 2) throw err;
      emit(job, { type: "status", text: "工具参数解析失败，重试本轮" });
      continue;
    }

    addTokens(job.usage, message.model ?? MODEL, message.usage);
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
  emit(job, { type: "status", text: `已达到最大轮数 ${MAX_TURNS}，停止` });
}

// ---------------- demo mode: scripted run, no Claude call (for trying the UI without an API key) ----------------

/** Demo runs keep a text-only transcript so the conversation UI can be exercised without Claude. */
async function recordDemoTurn(projectId: string, opts: RunOptions, reply: string) {
  const prev = opts.continueConversation ? await loadConversation(projectId) : null;
  const request = opts.redraw ? `重画：${opts.redraw.feedback}` : opts.request;
  await saveConversation(projectId, {
    messages: [...(prev?.messages ?? []), { role: "user", content: request }, { role: "assistant", content: reply }],
    runs: [...(prev?.runs ?? []), { request, at: new Date().toISOString() }],
  });
}

async function runDemo(job: Job, opts: RunOptions) {
  const provider = getProvider(opts.providerId);
  const project = await loadProject(opts.projectId);
  if (!project.refs.length) throw new Error("请先上传至少一张风格参考图");
  emit(job, { type: "status", text: `演示模式（AGENT_MODE=demo）· 图像通道 ${provider.label}` });

  let sg = project.styleGuide;
  if (!sg) {
    const { default: sharp } = await import("sharp");
    const stats = await sharp(await readProjectFile(project.id, project.refs[0].file)).stats();
    const d = stats.dominant;
    const hex = (r: number, g: number, b: number) =>
      "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
    const palette = [
      { hex: hex(d.r, d.g, d.b), role: "主色" },
      { hex: hex(d.r * 0.6, d.g * 0.6, d.b * 0.6), role: "暗部" },
      { hex: hex(255 - d.r, 255 - d.g, 255 - d.b), role: "强调色" },
    ];
    sg = {
      summary: "演示风格指南（从参考图主色自动提取）",
      palette,
      rendering: "flat vector",
      line_and_edges: "bold dark outline",
      lighting_and_shading: "two-tone cel shading",
      perspective: "front view",
      proportions: "chunky",
      texture_and_detail: "low detail",
      mood: "playful",
      avoid: ["photorealism"],
      prompt_prefix: `Flat vector game art, bold outline, palette ${palette.map((p) => p.hex).join(" ")}.`,
    };
    await updateProject(project.id, (p) => {
      p.styleGuide = sg;
    });
    emit(job, { type: "style", styleGuide: sg });
  }

  if (opts.redraw) {
    const old = project.assets.find((a) => a.id === opts.redraw!.assetId);
    if (!old) throw new Error("要重画的素材不存在");
    const input = {
      name: old.name,
      asset_type: old.assetType as AssetType,
      prompt: `${old.prompt} Revision: ${opts.redraw.feedback}`,
      aspect: old.assetType === "background" ? ("landscape" as const) : ("square" as const),
      transparent_background: !["background", "tile"].includes(old.assetType),
      consistency_asset_ids: [old.id],
      replaces_asset_id: old.id,
      frames: old.frames?.length,
    };
    emit(job, { type: "text", delta: `按意见重画「${old.name}」：${opts.redraw.feedback}\n` });
    emit(job, { type: "tool", name: "generate_image", input });
    const { asset } = await generateAsset(job, provider, input);
    emit(job, { type: "asset", asset });
    await recordDemoTurn(project.id, opts, `已重画 ${asset.id}`);
    return;
  }

  const types = (opts.assetTypes.length ? opts.assetTypes : ["item_icon", "character", "tile"]).filter(
    (t): t is AssetType => t in ASSET_TYPES,
  );
  emit(job, { type: "text", delta: `计划生成 ${types.length} 个素材：${types.map((t) => ASSET_TYPES[t]).join("、")}。\n` });
  await Promise.all(
    types.map(async (t, i) => {
      const input = {
        name: `${ASSET_TYPES[t]} #${i + 1}`,
        asset_type: t,
        prompt: `${sg!.prompt_prefix} ${opts.request} ${t}`,
        aspect: t === "background" ? ("landscape" as const) : ("square" as const),
        transparent_background: t !== "background" && t !== "tile",
      };
      emit(job, { type: "tool", name: "generate_image", input });
      const { asset } = await generateAsset(job, provider, input);
      await updateProject(project.id, (p) => {
        const a = p.assets.find((x) => x.id === asset.id)!;
        a.status = "approved";
        a.score = 7;
        a.notes = "演示模式自动通过";
        Object.assign(asset, a);
      });
      emit(job, { type: "asset", asset });
    }),
  );
  await recordDemoTurn(project.id, opts, `生成了 ${types.length} 个素材`);
  emit(job, { type: "text", delta: "演示完成。配置 ANTHROPIC_API_KEY 并去掉 AGENT_MODE=demo 即可启用真正的 Claude 美术总监。\n" });
}
