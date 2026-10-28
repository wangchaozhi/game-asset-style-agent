import type { ActionKey } from "../domain/actionSet.js";
import type { Asset, StyleGuide } from "../store/types.js";
import { saveRunUsage } from "../store/usage.js";
import type { RunUsage } from "../usage/types.js";
import type { Budget } from "./budget.js";
import { actionLabel, msg } from "../i18n.js";

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
  budget: Budget;
  /** set once the budget-reached notice has been shown */
  budgetNoticed?: boolean;
  /** image calls started but not finished (reserved against the budget) */
  imagesInFlight?: number;
  /** downscaled reference images, keyed by file, shared by this job's parallel generations */
  refCache?: Map<string, Promise<import("../providers/types.js").ImageInput>>;
}

export interface RunOptions {
  projectId: string;
  request: string;
  assetTypes: string[];
  providerId?: string;
  /** redraw these assets following the user's feedback on each (at most MAX_REDRAWS) */
  redraws?: { assetId: string; feedback: string }[];
  /** append to the project's previous agent conversation instead of starting fresh */
  continueConversation?: boolean;
  /** regenerate one asset from an edited prompt, without Claude */
  manual?: { assetId: string; prompt: string };
  /** per-run limits; missing fields fall back to RUN_MAX_IMAGES / RUN_MAX_USD */
  budget?: { maxImages?: unknown; maxUsd?: unknown };
  /** an animation set for a character; `request` carries the same as instructions for Claude */
  actionSet?: { assetId: string; name: string; actions: ActionKey[] };
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
  // Store streamed text as one event per paragraph run, not one per token; live listeners still get every delta.
  const last = job.events.at(-1);
  if (e.type === "text" && last?.type === "text") job.events[job.events.length - 1] = { type: "text", delta: last.delta + e.delta };
  else job.events.push(e);
  for (const l of job.listeners) l(e);
}

/** Broadcast the job's running usage and persist it to the project's usage log. */
export function reportUsage(job: Job) {
  emit(job, { type: "usage", usage: structuredClone(job.usage) });
  saveRunUsage(job.projectId, job.usage).catch(() => undefined);
}

/** Most assets one run may redraw (each adds an image to the request). */
export const MAX_REDRAWS = 10;

export function requestLabel(opts: Pick<RunOptions, "request" | "redraws" | "manual" | "actionSet">) {
  if (opts.manual) return msg("run.label.manual", { prompt: opts.manual.prompt.slice(0, 80) });
  if (opts.actionSet) return msg("run.label.actionSet", { name: opts.actionSet.name, actions: opts.actionSet.actions.map((k) => actionLabel(k)).join(msg("note.enumSep")) });
  const r = opts.redraws ?? [];
  if (r.length === 1) return msg("run.label.redraw", { feedback: r[0].feedback });
  if (r.length > 1) return msg("run.label.redrawN", { n: r.length });
  return opts.request;
}
