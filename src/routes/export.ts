import { Router } from "express";
import { buildExport } from "../export/bundle.js";
import { loadProject } from "../store/index.js";
import { attachment, pid } from "./util.js";

export const exportRouter = Router();

/** ?status=all includes unapproved assets; ?sizes=1 adds common game sizes. */
exportRouter.get("/api/projects/:id/export.zip", async (req, res) => {
  const project = await loadProject(pid(req));
  const all = req.query.status === "all";
  const out = await buildExport(project, { all, sizes: !!req.query.sizes });
  if (!out) return void res.status(400).json({ error: all ? "项目还没有素材" : "还没有已通过的素材" });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", attachment("assets.zip", out.filename));
  res.send(out.zip);
});
