import type { Cost, RunUsage, TokenUsage } from "./types.js";

/** USD per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

// https://platform.claude.com/docs/en/about-claude/pricing — 5-minute cache writes. First match wins.
const MODEL_PRICES: [RegExp, ModelPrice][] = [
  [/fable-5-1|mythos-5-1/, { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 }],
  [/fable-5|mythos-5/, { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 }],
  [/opus-5-5/, { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 }],
  [/opus-5|opus-4-[5-9]/, { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }],
  [/opus-4/, { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 }],
  [/sonnet-5/, { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 }],
  [/sonnet-4/, { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 }],
  [/haiku-5-5/, { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 }],
  [/haiku-4-5/, { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 }],
];

type Env = Record<string, string | undefined>;

/** Env override: CLAUDE_PRICE="input,output,cacheWrite,cacheRead" (USD / MTok) applies to every model. */
export function modelPrice(model: string, env: Env = process.env): ModelPrice | null {
  const o = env.CLAUDE_PRICE?.split(",").map(Number);
  if (o?.length === 4 && o.every((n) => Number.isFinite(n) && n >= 0)) {
    return { input: o[0], output: o[1], cacheWrite: o[2], cacheRead: o[3] };
  }
  return MODEL_PRICES.find(([re]) => re.test(model))?.[1] ?? null;
}

/** Per-image price for a provider, from IMAGE_PRICE_<PROVIDER> (USD). Mock is free. */
export function imagePrice(provider: string, env: Env = process.env): number | null {
  if (provider === "mock") return 0;
  const v = env[`IMAGE_PRICE_${provider.toUpperCase()}`];
  if (v === undefined || v.trim() === "") return null;
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

export const roundUsd = (n: number) => Math.round(n * 1e6) / 1e6;

export function computeCost(run: Pick<RunUsage, "claude" | "images">, env: Env = process.env): Cost {
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
  return {
    claude: claude === null ? null : roundUsd(claude),
    images: images === null ? null : roundUsd(images),
    total: roundUsd((claude ?? 0) + (images ?? 0)),
  };
}
