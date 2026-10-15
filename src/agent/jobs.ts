import { config } from "../config.js";
import { newId } from "../store/index.js";
import { newRunUsage } from "../usage/record.js";
import { resolveBudget } from "./budget.js";
import { runDemo } from "./demo.js";
import { type Job, type RunOptions, emit, jobs, reportUsage, requestLabel } from "./events.js";
import { runAgent } from "./loop.js";

/** How long a finished job's event log stays available for reconnecting clients. */
const JOB_TTL_MS = 30 * 60_000;

/** Start a run in the background and return its job immediately; progress arrives as events. */
export function startJob(opts: RunOptions): Job {
  const id = newId("job");
  const demo = config.demo;
  const job: Job = {
    id,
    projectId: opts.projectId,
    events: [],
    listeners: new Set(),
    finished: false,
    abort: new AbortController(),
    usage: newRunUsage(id, requestLabel(opts), demo ? "demo" : "agent"),
    budget: resolveBudget(opts.budget),
  };
  job.usage.budget = job.budget;
  jobs.set(job.id, job);
  // Record the run immediately so a crash before the first image call still leaves a trace.
  reportUsage(job);
  const runner = demo ? runDemo : runAgent;
  runner(job, opts)
    .then(() => {
      job.usage.status = "ok";
    })
    .catch((err: unknown) => {
      job.usage.status = job.abort.signal.aborted ? "stopped" : "error";
      if (job.abort.signal.aborted) emit(job, { type: "status", text: "已停止" });
      else emit(job, { type: "error", message: err instanceof Error ? err.message : String(err) });
    })
    .finally(() => {
      job.usage.finishedAt = new Date().toISOString();
      reportUsage(job);
      job.finished = true;
      emit(job, { type: "done" });
      setTimeout(() => jobs.delete(job.id), JOB_TTL_MS).unref();
    });
  return job;
}
