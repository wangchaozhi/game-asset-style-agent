import { computeCost } from "./pricing.js";
import { type RunUsage, type TokenUsage, addInto, emptyTokens } from "./types.js";

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
  addInto((run.claude.byModel[model] ??= emptyTokens()), u);
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
  for (const u of Object.values(run.claude.byModel)) addInto(sum, u);
  return sum;
}
