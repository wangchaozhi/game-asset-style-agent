import { Router } from "express";
import { type AgentEvent, jobs, runningJobFor, startJob } from "../agent/index.js";
import { loadProject } from "../store/index.js";
import { pid } from "./util.js";

export const jobsRouter = Router();

/** Start a run (409 with the running job's id if one is already active for the project). */
jobsRouter.post("/api/projects/:id/run", async (req, res) => {
  const projectId = pid(req);
  await loadProject(projectId);
  const running = runningJobFor(projectId);
  if (running) return void res.status(409).json({ error: "该项目已有任务在运行", jobId: running.id });
  const job = startJob({
    projectId,
    request: String(req.body?.request ?? "").slice(0, 4000),
    assetTypes: Array.isArray(req.body?.assetTypes) ? req.body.assetTypes.map(String) : [],
    providerId: req.body?.provider ? String(req.body.provider) : undefined,
    continueConversation: req.body?.continueConversation !== false,
    budget: typeof req.body?.budget === "object" && req.body.budget ? req.body.budget : undefined,
    redraw: req.body?.redraw?.assetId
      ? { assetId: String(req.body.redraw.assetId), feedback: String(req.body.redraw.feedback ?? "").slice(0, 2000) }
      : undefined,
  });
  res.json({ jobId: job.id });
});

/** Regenerate one asset from an edited prompt, straight to the image model (no Claude). */
jobsRouter.post("/api/projects/:id/assets/:assetId/regenerate", async (req, res) => {
  const projectId = pid(req);
  const project = await loadProject(projectId);
  if (!project.assets.some((a) => a.id === req.params.assetId)) return void res.status(404).json({ error: "素材不存在" });
  const prompt = String(req.body?.prompt ?? "").trim();
  if (prompt.length < 10) return void res.status(400).json({ error: "prompt 太短" });
  const running = runningJobFor(projectId);
  if (running) return void res.status(409).json({ error: "该项目已有任务在运行", jobId: running.id });
  const job = startJob({
    projectId,
    request: "",
    assetTypes: [],
    providerId: req.body?.provider ? String(req.body.provider) : undefined,
    budget: typeof req.body?.budget === "object" && req.body.budget ? req.body.budget : undefined,
    manual: { assetId: String(req.params.assetId), prompt: prompt.slice(0, 8000) },
  });
  res.json({ jobId: job.id });
});

jobsRouter.post("/api/jobs/:id/stop", (req, res) => {
  jobs.get(String(req.params.id))?.abort.abort();
  res.json({ ok: true });
});

/** Server-sent events: replays the job's log so far, then streams until "done". */
jobsRouter.get("/api/jobs/:id/events", (req, res) => {
  const job = jobs.get(String(req.params.id));
  if (!job) return void res.status(404).end();
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (e: AgentEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  job.events.forEach(send);
  if (job.finished) return void res.end();
  const listener = (e: AgentEvent) => {
    send(e);
    if (e.type === "done") res.end();
  };
  job.listeners.add(listener);
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => {
    clearInterval(ping);
    job.listeners.delete(listener);
  });
});
