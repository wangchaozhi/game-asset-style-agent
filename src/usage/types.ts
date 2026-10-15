/** Token counts as reported by the Messages API `usage` block. */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

/** USD; a null part means no price is known for some model / provider used. */
export interface Cost {
  claude: number | null;
  images: number | null;
  total: number;
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
  cost: Cost;
}

export interface UsageSummary {
  runs: number;
  claudeRequests: number;
  tokens: TokenUsage;
  images: { calls: number; failed: number };
  cost: Cost;
}

export const TOKEN_KEYS = [
  "input_tokens",
  "output_tokens",
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
] as const satisfies readonly (keyof TokenUsage)[];

export const emptyTokens = (): TokenUsage => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
});

export function addInto(target: TokenUsage, u: Partial<Record<keyof TokenUsage, number | null>>) {
  for (const k of TOKEN_KEYS) target[k] += u[k] ?? 0;
}
