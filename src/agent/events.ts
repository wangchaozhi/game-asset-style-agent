import type { Asset, StyleGuide } from "../store/types.js";
import { saveRunUsage } from "../store/usage.js";
import type { RunUsage } from "../usage/types.js";

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
  /** replayed to clients that (re)connect mid-run */
  events: AgentEvent[];
  listeners: Set<(e: AgentEvent) => void>;
  finished: boolean;
  abort: AbortController;
  usage: RunUsage;
}

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

/** In-memory registry of running and recently finished jobs. */
export const jobs = new Map<string, Job>();

export const runningJobFor = (projectId: string) =>
  [...jobs.values()].find((j) => j.projectId === projectId && !j.finished);

export function emit(job: Job, e: AgentEvent) {
  // Only the latest usage snapshot is worth replaying to late subscribers.
  if (e.type === "usage") {
    const i = job.events.findIndex((x) => x.type === "usage");
    if (i >= 0) job.events.splice(i, 1);
  }
  job.events.push(e);
  for (const l of job.listeners) l(e);
}

/** Broadcast the job's running usage and persist it to the project's usage log. */
export function reportUsage(job: Job) {
  emit(job, { type: "usage", usage: structuredClone(job.usage) });
  saveRunUsage(job.projectId, job.usage).catch(() => undefined);
}

export const requestLabel = (opts: Pick<RunOptions, "request" | "redraw">) =>
  opts.redraw ? `重画：${opts.redraw.feedback}` : opts.request;
