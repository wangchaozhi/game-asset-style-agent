import { Router } from "express";
import { loadProject } from "../store.js";
import { jobs } from "../agent.js";
import { loadUsage, summarize } from "../usage.js";

export const usageRouter = Router();

/** Run-by-run Claude token and image-call usage for one project, newest first, plus totals. */
usageRouter.get("/api/projects/:id/usage", async (req, res) => {
  const projectId = String(req.params.id);
  await loadProject(projectId);
  const stored = await loadUsage(projectId);
  // A running job's latest numbers live in memory; prefer them over the last persisted snapshot.
  const live = [...jobs.values()].filter((j) => j.projectId === projectId && !j.finished).map((j) => j.usage);
  const runs = stored.map((r) => live.find((l) => l.jobId === r.jobId) ?? r);
  for (const l of live) if (!runs.some((r) => r.jobId === l.jobId)) runs.push(l);
  runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  res.json({ summary: summarize(runs), runs });
});
