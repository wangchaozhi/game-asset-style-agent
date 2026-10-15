import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { gemini } from "../src/providers/gemini.js";
import { openai } from "../src/providers/openai.js";
import type { GenerateRequest } from "../src/providers/types.js";

interface Captured {
  url: string;
  init: RequestInit;
}

const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };
let calls: Captured[] = [];

/** Replace fetch with a stub that records the request and answers with `respond`. */
function stubFetch(respond: (n: number) => Response) {
  calls = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(calls.length);
  }) as typeof fetch;
}

const PNG_B64 = Buffer.from("fake-png").toString("base64");
const ref = (n: number) => Array.from({ length: n }, (_, i) => ({ data: Buffer.from(`ref${i}`), mime: "image/png" }));
const req = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
  prompt: "A sword icon",
  references: [],
  aspect: "square",
  transparent: true,
  ...over,
});
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  process.env = { ...savedEnv, OPENAI_API_KEY: "sk-test", GEMINI_API_KEY: "g-test", IMAGE_MAX_RETRIES: "0" };
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_IMAGE_MODEL;
  delete process.env.GEMINI_IMAGE_MODEL;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...savedEnv };
});

describe("OpenAI provider", () => {
  it("is available only with a key", () => {
    assert.equal(openai.available(), true);
    delete process.env.OPENAI_API_KEY;
    assert.equal(openai.available(), false);
  });

  it("sends references to images/edits as multipart, capped at 16", async () => {
    stubFetch(() => jsonResponse({ data: [{ b64_json: PNG_B64 }] }));
    const out = await openai.generate(req({ references: ref(20), aspect: "landscape" }));
    assert.equal(out.mime, "image/png");
    assert.equal(out.data.toString(), "fake-png");
    const { url, init } = calls[0];
    assert.equal(url, "https://api.openai.com/v1/images/edits");
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer sk-test");
    const form = init.body as FormData;
    assert.equal(form.get("model"), "gpt-image-1");
    assert.equal(form.get("size"), "1536x1024");
    assert.equal(form.get("background"), "transparent");
    assert.equal(form.get("prompt"), "A sword icon");
    assert.equal(form.getAll("image[]").length, 16);
  });

  it("uses images/generations with JSON when there are no references", async () => {
    stubFetch(() => jsonResponse({ data: [{ b64_json: PNG_B64 }] }));
    process.env.OPENAI_BASE_URL = "https://proxy.example/v1";
    process.env.OPENAI_IMAGE_MODEL = "gpt-image-2";
    await openai.generate(req({ aspect: "portrait", transparent: false }));
    const { url, init } = calls[0];
    assert.equal(url, "https://proxy.example/v1/images/generations");
    const body = JSON.parse(String(init.body));
    assert.deepEqual(body, { model: "gpt-image-2", prompt: "A sword icon", size: "1024x1536", n: 1, background: "opaque" });
  });

  it("passes the abort signal through", async () => {
    stubFetch(() => jsonResponse({ data: [{ b64_json: PNG_B64 }] }));
    const ac = new AbortController();
    await openai.generate(req(), ac.signal);
    assert.equal(calls[0].init.signal, ac.signal);
  });

  it("surfaces HTTP errors with status and body", async () => {
    stubFetch(() => new Response("rate limited, slow down", { status: 429 }));
    await assert.rejects(openai.generate(req()), /OpenAI HTTP 429: rate limited/);
  });

  it("errors when the response has no image", async () => {
    stubFetch(() => jsonResponse({ data: [] }));
    await assert.rejects(openai.generate(req()), /no image/);
  });

  it("retries a rate limit and reports it", async () => {
    process.env.IMAGE_MAX_RETRIES = "2";
    stubFetch((n) => (n === 1 ? new Response("slow down", { status: 429, headers: { "retry-after-ms": "5" } }) : jsonResponse({ data: [{ b64_json: PNG_B64 }] })));
    const retries: unknown[] = [];
    const out = await openai.generate(req({ references: ref(1), onRetry: (i) => retries.push(i) }));
    assert.equal(out.data.toString(), "fake-png");
    assert.equal(calls.length, 2);
    assert.deepEqual(retries, [{ attempt: 1, delayMs: 5, reason: "HTTP 429" }]);
    assert.equal((calls[1].init.body as FormData).getAll("image[]").length, 1, "the form is resent intact");
  });
});

describe("Gemini provider", () => {
  it("accepts GOOGLE_API_KEY as a fallback", () => {
    delete process.env.GEMINI_API_KEY;
    assert.equal(gemini.available(), false);
    process.env.GOOGLE_API_KEY = "k";
    assert.equal(gemini.available(), true);
  });

  it("sends inline references (max 14), aspect ratio and the key header", async () => {
    stubFetch(() => jsonResponse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/webp", data: PNG_B64 } }] } }] }));
    const out = await gemini.generate(req({ references: ref(20), aspect: "landscape", transparent: false }));
    assert.equal(out.mime, "image/webp");
    const { url, init } = calls[0];
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent");
    assert.equal((init.headers as Record<string, string>)["x-goog-api-key"], "g-test");
    const body = JSON.parse(String(init.body));
    const parts = body.contents[0].parts;
    assert.equal(parts.filter((p: { inline_data?: unknown }) => p.inline_data).length, 14);
    assert.equal(parts.at(-1).text, "A sword icon");
    assert.equal(body.generationConfig.imageConfig.aspectRatio, "3:2");
    assert.deepEqual(body.generationConfig.responseModalities, ["TEXT", "IMAGE"]);
  });

  it("asks for a flat white backdrop when transparency is wanted", async () => {
    stubFetch(() => jsonResponse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG_B64 } }] } }] }));
    await gemini.generate(req({ transparent: true }));
    const text = JSON.parse(String(calls[0].init.body)).contents[0].parts.at(-1).text;
    assert.match(text, /^A sword icon\n\n.*pure-white \(#FFFFFF\) background/s);
  });

  it("reports the model's text when it returns no image", async () => {
    stubFetch(() => jsonResponse({ candidates: [{ content: { parts: [{ text: "I can't draw that." }] } }] }));
    await assert.rejects(gemini.generate(req()), /Gemini returned no image: I can't draw that\./);
  });

  it("surfaces HTTP errors", async () => {
    stubFetch(() => new Response('{"error":"bad key"}', { status: 403 }));
    await assert.rejects(gemini.generate(req()), /Gemini HTTP 403: \{"error":"bad key"\}/);
  });

  it("retries a 503 before giving up", async () => {
    process.env.IMAGE_MAX_RETRIES = "1";
    stubFetch(() => new Response("overloaded", { status: 503, headers: { "retry-after-ms": "1" } }));
    await assert.rejects(gemini.generate(req()), /Gemini HTTP 503/);
    assert.equal(calls.length, 2);
  });
});
