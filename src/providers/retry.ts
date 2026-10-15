/** Status codes worth retrying: timeouts, conflicts from overloaded backends, rate limits, server errors. */
const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

export interface RetryInfo {
  attempt: number;
  delayMs: number;
  reason: string;
}

export interface RetryOptions {
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  signal?: AbortSignal;
  onRetry?: (info: RetryInfo) => void;
}

/** Retry-After as seconds or an HTTP date; retry-after-ms if present. Null when absent/invalid. */
export function retryAfterMs(res: Response, now = Date.now()): number | null {
  const ms = Number(res.headers.get("retry-after-ms"));
  if (res.headers.has("retry-after-ms") && Number.isFinite(ms) && ms >= 0) return ms;
  const v = res.headers.get("retry-after");
  if (!v) return null;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

export function abortableSleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });
}

/**
 * fetch with retries on retryable statuses and network errors. Backoff is exponential with jitter,
 * capped at maxMs, and a server's Retry-After wins when given (also capped). Aborts stop immediately.
 * The last response (even a failing one) is returned so the caller can report it.
 */
export async function fetchWithRetry(url: string, init: RequestInit, opts: RetryOptions = {}): Promise<Response> {
  const retries = opts.retries ?? Number(process.env.IMAGE_MAX_RETRIES ?? 3);
  const base = opts.baseMs ?? 1000;
  const max = opts.maxMs ?? 30_000;
  const signal = opts.signal ?? init.signal ?? undefined;
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    let reason: string;
    try {
      res = await fetch(url, { ...init, signal });
      if (!RETRYABLE.has(res.status) || attempt >= retries) return res;
      reason = `HTTP ${res.status}`;
    } catch (err) {
      if (signal?.aborted || attempt >= retries) throw err;
      reason = err instanceof Error ? err.message : String(err);
    }
    const backoff = Math.min(max, base * 2 ** attempt) * (0.75 + Math.random() * 0.5);
    const delayMs = Math.round(Math.min(max, (res && retryAfterMs(res)) ?? backoff));
    await res?.body?.cancel().catch(() => undefined);
    opts.onRetry?.({ attempt: attempt + 1, delayMs, reason });
    await abortableSleep(delayMs, signal);
  }
}
