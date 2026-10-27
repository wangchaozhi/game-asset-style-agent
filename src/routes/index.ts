import { Router } from "express";
import { analysisRouter } from "./analysis.js";
import { assetsRouter } from "./assets.js";
import { configRouter } from "./config.js";
import { exportRouter } from "./export.js";
import { jobsRouter } from "./jobs.js";
import { postprocessRouter } from "./postprocess.js";
import { projectsRouter } from "./projects.js";
import { refsRouter } from "./refs.js";
import { usageRouter } from "./usage.js";

export const apiRouter = Router();
for (const r of [configRouter, projectsRouter, refsRouter, assetsRouter, postprocessRouter, analysisRouter, exportRouter, jobsRouter, usageRouter]) apiRouter.use(r);
