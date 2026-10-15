import http from "node:http";
import type { AddressInfo } from "node:net";

/** One scripted assistant turn. Blocks are streamed as real Messages API SSE events. */
export interface Turn {
  content: (
    | { type: "text"; text: string }
    | { type: "thinking"; thinking: string }
    | { type: "tool_use"; id: string; name: string; input: unknown; rawJson?: string }
  )[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "refusal" | "pause_turn";
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  model?: string;
  /** reply with this HTTP error instead of a stream */
  error?: { status: number; type: string; message: string };
}

/** A turn, or a function that builds one from the request (e.g. to read tool results). */
export type Script = Turn | ((req: Recorded) => Turn | Promise<Turn>);

export interface Recorded {
  path: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown> & { messages: { role: string; content: unknown }[] };
}

/** A local stand-in for api.anthropic.com that plays back scripted turns in order. */
export async function startFakeAnthropic() {
  const queue: Script[] = [];
  const requests: Recorded[] = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    const recorded = { path: req.url ?? "", headers: req.headers, body };
    requests.push(recorded);
    const next = queue.shift();
    const turn = typeof next === "function" ? await next(recorded) : next;
    if (!turn) {
      res.writeHead(500, { "content-type": "application/json" });
      return void res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "fake: no scripted turn left" } }));
    }
    if (turn.error) {
      res.writeHead(turn.error.status, { "content-type": "application/json", "x-should-retry": "false" });
      return void res.end(JSON.stringify({ type: "error", error: { type: turn.error.type, message: turn.error.message } }));
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const send = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    const u = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...turn.usage };
    send("message_start", {
      message: {
        id: `msg_${requests.length}`, type: "message", role: "assistant", model: turn.model ?? body.model, content: [],
        stop_reason: null, stop_sequence: null,
        usage: { input_tokens: u.input_tokens, output_tokens: 1, cache_creation_input_tokens: u.cache_creation_input_tokens, cache_read_input_tokens: u.cache_read_input_tokens },
      },
    });
    turn.content.forEach((b, index) => {
      if (b.type === "text") {
        send("content_block_start", { index, content_block: { type: "text", text: "" } });
        for (const piece of b.text.match(/.{1,8}/gs) ?? []) send("content_block_delta", { index, delta: { type: "text_delta", text: piece } });
      } else if (b.type === "thinking") {
        send("content_block_start", { index, content_block: { type: "thinking", thinking: "", signature: "" } });
        send("content_block_delta", { index, delta: { type: "thinking_delta", thinking: b.thinking } });
        send("content_block_delta", { index, delta: { type: "signature_delta", signature: `sig_${index}` } });
      } else {
        send("content_block_start", { index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
        const json = b.rawJson ?? JSON.stringify(b.input);
        const mid = Math.floor(json.length / 2);
        send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: json.slice(0, mid) } });
        send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: json.slice(mid) } });
      }
      send("content_block_stop", { index });
    });
    send("message_delta", { delta: { stop_reason: turn.stop_reason, stop_sequence: null }, usage: { output_tokens: u.output_tokens } });
    send("message_stop", {});
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    requests,
    script: (...turns: Script[]) => void queue.push(...turns),
    pending: () => queue.length,
    reset: () => {
      queue.length = 0;
      requests.length = 0;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** Pull every `asset_id=…` out of the tool results in the last user message. */
export function assetIdsFromLastToolResults(req: Recorded): string[] {
  const last = req.body.messages.at(-1);
  const blocks = Array.isArray(last?.content) ? (last.content as { type: string; content?: unknown }[]) : [];
  const text = JSON.stringify(blocks.filter((b) => b.type === "tool_result").map((b) => b.content));
  return [...text.matchAll(/asset_id=(ast_[0-9a-f]+)/g)].map((m) => m[1]);
}
