import { Router } from "express";
import { jobs } from "../agent/index.js";
import { loadProject, loadUsage } from "../store/index.js";
import { summarize } from "../usage/index.js";
import { pid } from "./util.js";

export const usageRouter = Router();

/** Run-by-run Claude token and image-call usage for one project, newest first, plus totals. */
usageRouter.get("/api/projects/:id/usage", async (req, res) => {
  const projectId = pid(req);
  await loadProject(projectId);
  const stored = await loadUsage(projectId);
  // Jobs still in memory (running, or finished within the last half hour) hold the freshest numbers;
  // the file write of a just-finished run may not have landed yet.
  const live = [...jobs.values()].filter((j) => j.projectId === projectId).map((j) => j.usage);
  const runs = stored.map((r) => live.find((l) => l.jobId === r.jobId) ?? r);
  for (const l of live) if (!runs.some((r) => r.jobId === l.jobId)) runs.push(l);
  runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  res.json({ summary: summarize(runs), runs });
});
