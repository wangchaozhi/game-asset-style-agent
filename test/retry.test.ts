import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { fetchWithRetry, retryAfterMs } from "../src/providers/retry.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Each call takes the next scripted outcome: a Response, or an Error to throw. */
function script(...outcomes: (Response | Error)[]) {
  let n = 0;
  globalThis.fetch = (async () => {
    const o = outcomes[Math.min(n++, outcomes.length - 1)];
    if (o instanceof Error) throw o;
    return o;
  }) as typeof fetch;
  return () => n;
}
const ok = () => new Response("ok", { status: 200 });
const status = (s: number, headers: Record<string, string> = {}) => new Response("x", { status: s, headers });
const fast = { baseMs: 1, maxMs: 5 };

describe("retryAfterMs", () => {
  it("reads seconds, milliseconds and HTTP dates", () => {
    assert.equal(retryAfterMs(status(429, { "retry-after": "3" })), 3000);
    assert.equal(retryAfterMs(status(429, { "retry-after-ms": "250", "retry-after": "9" })), 250);
    const now = Date.parse("2026-01-01T00:00:00Z");
    assert.equal(retryAfterMs(status(503, { "retry-after": "Thu, 01 Jan 2026 00:00:07 GMT" }), now), 7000);
    assert.equal(retryAfterMs(status(503, { "retry-after": "soon" })), null);
    assert.equal(retryAfterMs(status(503)), null);
  });
});

describe("fetchWithRetry", () => {
  it("retries retryable statuses until success", async () => {
    const count = script(status(503), status(429), ok());
    const seen: string[] = [];
    const res = await fetchWithRetry("http://x", {}, { ...fast, retries: 3, onRetry: (i) => seen.push(`${i.attempt}:${i.reason}`) });
    assert.equal(res.status, 200);
    assert.equal(count(), 3);
    assert.deepEqual(seen, ["1:HTTP 503", "2:HTTP 429"]);
  });

  it("does not retry client errors", async () => {
    const count = script(status(400), ok());
    assert.equal((await fetchWithRetry("http://x", {}, fast)).status, 400);
    assert.equal(count(), 1);
  });

  it("returns the last failing response when retries run out", async () => {
    const count = script(status(429));
    assert.equal((await fetchWithRetry("http://x", {}, { ...fast, retries: 2 })).status, 429);
    assert.equal(count(), 3);
  });

  it("retries network errors, and rethrows the last one", async () => {
    let count = script(new TypeError("fetch failed"), ok());
    assert.equal((await fetchWithRetry("http://x", {}, fast)).status, 200);
    assert.equal(count(), 2);
    count = script(new TypeError("fetch failed"));
    await assert.rejects(fetchWithRetry("http://x", {}, { ...fast, retries: 1 }), /fetch failed/);
    assert.equal(count(), 2);
  });

  it("honours Retry-After, capped at maxMs", async () => {
    script(status(429, { "retry-after-ms": "20" }), ok());
    const delays: number[] = [];
    await fetchWithRetry("http://x", {}, { baseMs: 1, maxMs: 1000, onRetry: (i) => delays.push(i.delayMs) });
    assert.deepEqual(delays, [20]);
    script(status(429, { "retry-after": "3600" }), ok());
    delays.length = 0;
    await fetchWithRetry("http://x", {}, { baseMs: 1, maxMs: 15, onRetry: (i) => delays.push(i.delayMs) });
    assert.deepEqual(delays, [15]);
  });

  it("stops waiting as soon as it is aborted", async () => {
    script(status(503, { "retry-after": "60" }), ok());
    const ac = new AbortController();
    const started = Date.now();
    setTimeout(() => ac.abort(new Error("stopped")), 20);
    await assert.rejects(fetchWithRetry("http://x", {}, { maxMs: 60_000, signal: ac.signal }), /stopped/);
    assert.ok(Date.now() - started < 1000);
  });

  it("IMAGE_MAX_RETRIES sets the default retry count", async () => {
    process.env.IMAGE_MAX_RETRIES = "0";
    try {
      const count = script(status(503), ok());
      assert.equal((await fetchWithRetry("http://x", {}, fast)).status, 503);
      assert.equal(count(), 1);
    } finally {
      delete process.env.IMAGE_MAX_RETRIES;
    }
  });
});
