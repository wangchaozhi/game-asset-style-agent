import fs from "node:fs/promises";
import path from "node:path";
import { projectDir } from "./store.js";

/** Token counts as reported by the Messages API `usage` block. */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface RunUsage {
  jobId: string;
  request: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "ok" | "error" | "stopped";
  /** "demo" when no Claude call was made */
  mode: "agent" | "demo";
  claude: {
    requests: number;
    /** token usage per model actually served (server-side fallback may switch models) */
    byModel: Record<string, TokenUsage>;
  };
  images: {
    calls: number;
    failed: number;
    byProvider: Record<string, number>;
  };
  /** USD; null parts mean no price is known for that model / provider */
  cost: { claude: number | null; images: number | null; total: number };
}

// ---------------- pricing (USD per million tokens) ----------------

interface ModelPrice {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

// https://platform.claude.com/docs/en/about-claude/pricing — 5-minute cache writes.
const MODEL_PRICES: [RegExp, ModelPrice][] = [
  [/fable-5-1|mythos-5-1/, { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 }],
  [/fable-5|mythos-5/, { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 }],
  [/opus-5-5/, { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 }],
  [/opus-5|opus-4-[5-9]/, { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }],
  [/opus-4/, { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 }],
  [/sonnet-5-5|sonnet-5/, { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 }],
  [/sonnet-4/, { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 }],
  [/haiku-5-5/, { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 }],
  [/haiku-4-5/, { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 }],
];

/** Env override: CLAUDE_PRICE="input,output,cacheWrite,cacheRead" (USD / MTok) applies to every model. */
export function modelPrice(model: string, env = process.env): ModelPrice | null {
  const o = env.CLAUDE_PRICE?.split(",").map(Number);
  if (o?.length === 4 && o.every((n) => Number.isFinite(n) && n >= 0)) {
    return { input: o[0], output: o[1], cacheWrite: o[2], cacheRead: o[3] };
  }
  return MODEL_PRICES.find(([re]) => re.test(model))?.[1] ?? null;
}

/** Per-image price for a provider, from IMAGE_PRICE_<PROVIDER> (USD). Mock is free. */
export function imagePrice(provider: string, env = process.env): number | null {
  if (provider === "mock") return 0;
  const v = env[`IMAGE_PRICE_${provider.toUpperCase()}`];
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function tokenCost(u: TokenUsage, p: ModelPrice): number {
  return (
    (u.input_tokens * p.input +
      u.output_tokens * p.output +
      u.cache_creation_input_tokens * p.cacheWrite +
      u.cache_read_input_tokens * p.cacheRead) /
    1_000_000
  );
}

export function computeCost(run: Pick<RunUsage, "claude" | "images">, env = process.env): RunUsage["cost"] {
  let claude: number | null = 0;
  for (const [model, u] of Object.entries(run.claude.byModel)) {
    const p = modelPrice(model, env);
    if (!p) {
      claude = null;
      break;
    }
    claude += tokenCost(u, p);
  }
  let images: number | null = 0;
  for (const [provider, n] of Object.entries(run.images.byProvider)) {
    const p = imagePrice(provider, env);
    if (p === null) {
      images = null;
      break;
    }
    images += n * p;
  }
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    claude: claude === null ? null : round(claude),
    images: images === null ? null : round(images),
    total: round((claude ?? 0) + (images ?? 0)),
  };
}

// ---------------- recording ----------------

const emptyTokens = (): TokenUsage => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
});

export function newRunUsage(jobId: string, request: string, mode: RunUsage["mode"]): RunUsage {
  return {
    jobId,
    request,
    startedAt: new Date().toISOString(),
    status: "running",
    mode,
    claude: { requests: 0, byModel: {} },
    images: { calls: 0, failed: 0, byProvider: {} },
    cost: { claude: 0, images: 0, total: 0 },
  };
}

/** Add one Messages API response's usage. Missing / null counters count as 0. */
export function addTokens(run: RunUsage, model: string, u: Partial<Record<keyof TokenUsage, number | null>>) {
  const t = (run.claude.byModel[model] ??= emptyTokens());
  for (const k of Object.keys(t) as (keyof TokenUsage)[]) t[k] += u[k] ?? 0;
  run.claude.requests++;
  run.cost = computeCost(run);
}

export function addImageCall(run: RunUsage, provider: string, ok: boolean) {
  run.images.calls++;
  if (ok) run.images.byProvider[provider] = (run.images.byProvider[provider] ?? 0) + 1;
  else run.images.failed++;
  run.cost = computeCost(run);
}

export function totalTokens(run: RunUsage): TokenUsage {
  const sum = emptyTokens();
  for (const u of Object.values(run.claude.byModel)) {
    for (const k of Object.keys(sum) as (keyof TokenUsage)[]) sum[k] += u[k];
  }
  return sum;
}

// ---------------- persistence: data/projects/<id>/usage.json ----------------

const usageFile = (projectId: string) => path.join(projectDir(projectId), "usage.json");
const writes = new Map<string, Promise<unknown>>();

export async function loadUsage(projectId: string): Promise<RunUsage[]> {
  try {
    const list = JSON.parse(await fs.readFile(usageFile(projectId), "utf8")) as RunUsage[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Insert or replace the run with the same jobId. Writes are serialized per project. */
export function saveRunUsage(projectId: string, run: RunUsage): Promise<void> {
  const prev = writes.get(projectId) ?? Promise.resolve();
  const next = prev.then(async () => {
    const list = await loadUsage(projectId);
    const i = list.findIndex((r) => r.jobId === run.jobId);
    if (i >= 0) list[i] = run;
    else list.push(run);
    const file = usageFile(projectId);
    await fs.writeFile(file + ".tmp", JSON.stringify(list, null, 2));
    await fs.rename(file + ".tmp", file);
  });
  writes.set(projectId, next.catch(() => undefined));
  return next;
}

export interface UsageSummary {
  runs: number;
  claudeRequests: number;
  tokens: TokenUsage;
  images: { calls: number; failed: number };
  cost: { claude: number | null; images: number | null; total: number };
}

export function summarize(list: RunUsage[]): UsageSummary {
  const s: UsageSummary = {
    runs: list.length,
    claudeRequests: 0,
    tokens: emptyTokens(),
    images: { calls: 0, failed: 0 },
    cost: { claude: 0, images: 0, total: 0 },
  };
  for (const r of list) {
    s.claudeRequests += r.claude.requests;
    const t = totalTokens(r);
    for (const k of Object.keys(t) as (keyof TokenUsage)[]) s.tokens[k] += t[k];
    s.images.calls += r.images.calls;
    s.images.failed += r.images.failed;
    s.cost.claude = s.cost.claude === null || r.cost.claude === null ? null : s.cost.claude + r.cost.claude;
    s.cost.images = s.cost.images === null || r.cost.images === null ? null : s.cost.images + r.cost.images;
    s.cost.total += r.cost.total;
  }
  const round = (n: number | null) => (n === null ? null : Math.round(n * 1e6) / 1e6);
  s.cost = { claude: round(s.cost.claude), images: round(s.cost.images), total: round(s.cost.total)! };
  return s;
}
