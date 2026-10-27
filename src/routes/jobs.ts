import { Router } from "express";
import { ACTION_SET_TYPES, actionSetRequest, isActionKey } from "../domain/actionSet.js";
import { type AgentEvent, jobs, runningJobFor, startJob } from "../agent/index.js";
import { MAX_REDRAWS } from "../agent/events.js";
import { loadProject } from "../store/index.js";
import { pid } from "./util.js";

export const jobsRouter = Router();

/** `redraws: [{ assetId, feedback }]`, or the older single `redraw: { assetId, feedback }`. */
function parseRedraws(body: { redraw?: unknown; redraws?: unknown } | undefined) {
  const list = Array.isArray(body?.redraws) ? body.redraws : body?.redraw ? [body.redraw] : [];
  const out = list
    .filter((r): r is { assetId: unknown; feedback?: unknown } => !!r && typeof r === "object" && "assetId" in r)
    .map((r) => ({ assetId: String(r.assetId), feedback: String(r.feedback ?? "").slice(0, 2000) }));
  return out.length ? out : undefined;
}

/** Start a run (409 with the running job's id if one is already active for the project). */
jobsRouter.post("/api/projects/:id/run", async (req, res) => {
  const projectId = pid(req);
  await loadProject(projectId);
  const running = runningJobFor(projectId);
  if (running) return void res.status(409).json({ error: "该项目已有任务在运行", jobId: running.id });
  if ((parseRedraws(req.body)?.length ?? 0) > MAX_REDRAWS) return void res.status(400).json({ error: `一次最多重画 ${MAX_REDRAWS} 个素材` });
  const job = startJob({
    projectId,
    request: String(req.body?.request ?? "").slice(0, 4000),
    assetTypes: Array.isArray(req.body?.assetTypes) ? req.body.assetTypes.map(String) : [],
    providerId: req.body?.provider ? String(req.body.provider) : undefined,
    continueConversation: req.body?.continueConversation !== false,
    budget: typeof req.body?.budget === "object" && req.body.budget ? req.body.budget : undefined,
    redraws: parseRedraws(req.body),
  });
  res.json({ jobId: job.id });
});

/** Animation set for a character / enemy: { actions: ["idle", "walk", …] } starts an agent run with one sprite sheet per action. */
jobsRouter.post("/api/projects/:id/assets/:assetId/action-set", async (req, res) => {
  const projectId = pid(req);
  const project = await loadProject(projectId);
  const asset = project.assets.find((a) => a.id === req.params.assetId);
  if (!asset) return void res.status(404).json({ error: "素材不存在" });
  if (!ACTION_SET_TYPES.has(asset.assetType)) return void res.status(400).json({ error: "只有角色和敌人可以生成动作套装" });
  const actions = Array.isArray(req.body?.actions) ? [...new Set(req.body.actions as unknown[])].filter(isActionKey) : [];
  if (!actions.length) return void res.status(400).json({ error: "请至少选择一个动作" });
  const running = runningJobFor(projectId);
  if (running) return void res.status(409).json({ error: "该项目已有任务在运行", jobId: running.id });
  const job = startJob({
    projectId,
    request: actionSetRequest(asset, actions),
    assetTypes: ["sprite_sheet"],
    providerId: req.body?.provider ? String(req.body.provider) : undefined,
    continueConversation: req.body?.continueConversation !== false,
    budget: typeof req.body?.budget === "object" && req.body.budget ? req.body.budget : undefined,
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
