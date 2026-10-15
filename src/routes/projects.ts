import { Router } from "express";
import multer from "multer";
import path from "node:path";
import { runningJobFor } from "../agent/index.js";
import { StyleGuideInput } from "../agent/schemas.js";
import {
  clearConversation, createProject, deleteProject, listProjects, loadConversation, loadProject, projectDir,
  buildBackup, importBackup, projectDiskUsage, removeOrphanFiles, updateProject,
} from "../store/index.js";
import { THUMB_WIDTHS, getThumb } from "../image/thumbs.js";
import { isPixelArt } from "../image/sizes.js";
import { attachment, pid } from "./util.js";

export const projectsRouter = Router();

projectsRouter.get("/api/projects", async (_req, res) => {
  const all = await listProjects();
  res.json(all.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, assets: p.assets.length, cover: p.refs[0]?.file })));
});

projectsRouter.post("/api/projects", async (req, res) => {
  res.json(await createProject(String(req.body?.name ?? "").slice(0, 80)));
});

projectsRouter.get("/api/projects/:id", async (req, res) => {
  res.json(await loadProject(pid(req)));
});

projectsRouter.patch("/api/projects/:id", async (req, res) => {
  const p = await updateProject(pid(req), (p) => {
    if (typeof req.body?.name === "string") p.name = req.body.name.slice(0, 80);
    if (req.body?.resetStyle) p.styleGuide = null;
  });
  res.json(p);
});

projectsRouter.delete("/api/projects/:id", async (req, res) => {
  await deleteProject(pid(req));
  res.json({ ok: true });
});

projectsRouter.put("/api/projects/:id/style-guide", async (req, res) => {
  const parsed = StyleGuideInput.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return void res.status(400).json({ error: `风格指南字段无效：${issue.path.join(".")} ${issue.message}` });
  }
  res.json(await updateProject(pid(req), (p) => void (p.styleGuide = parsed.data)));
});

projectsRouter.get("/api/projects/:id/conversation", async (req, res) => {
  const conv = await loadConversation(pid(req));
  res.json({ runs: conv?.runs ?? [], bytes: conv ? JSON.stringify(conv.messages).length : 0 });
});

projectsRouter.delete("/api/projects/:id/conversation", async (req, res) => {
  await clearConversation(pid(req));
  res.json({ ok: true });
});

/** Serve reference images and asset files. Only flat names under refs/ or assets/ are allowed. */
projectsRouter.get("/api/projects/:id/files/*rel", (req, res) => {
  const rel = ([] as string[]).concat(req.params.rel as string | string[]).join("/");
  if (!/^(refs|assets)\/[\w.-]+$/.test(rel)) return void res.status(400).end();
  res.sendFile(path.join(projectDir(pid(req)), rel));
});

/** Cached WebP thumbnail of a reference or asset file: ?w=160|320|640 (default 320). */
projectsRouter.get("/api/projects/:id/thumbs/*rel", async (req, res) => {
  const rel = ([] as string[]).concat(req.params.rel as string | string[]).join("/");
  if (!/^(refs|assets)\/[\w.-]+$/.test(rel)) return void res.status(400).end();
  const w = Number(req.query.w ?? 320);
  if (!(THUMB_WIDTHS as readonly number[]).includes(w)) return void res.status(400).json({ error: `w 需为 ${THUMB_WIDTHS.join(" / ")}` });
  const project = await loadProject(pid(req));
  // Asset art in a pixel style keeps hard edges; reference photos/paintings use smooth scaling.
  const pixel = rel.startsWith("assets/") && isPixelArt(project.styleGuide);
  const data = await getThumb(projectDir(project.id), rel, w, pixel);
  res.setHeader("Content-Type", "image/webp");
  // Revalidate every time (ETag → 304): a re-sliced GIF keeps its path but changes content.
  res.setHeader("Cache-Control", "private, no-cache");
  res.send(data);
});

/** Disk space used by the project folder. */
projectsRouter.get("/api/projects/:id/storage", async (req, res) => {
  await loadProject(pid(req));
  res.json({ bytes: await projectDiskUsage(pid(req)) });
});

/** Delete files no asset or reference owns. Refused while a job may be writing new files. */
projectsRouter.post("/api/projects/:id/cleanup", async (req, res) => {
  const project = await loadProject(pid(req));
  if (runningJobFor(project.id)) return void res.status(409).json({ error: "该项目有任务在运行，请稍后再清理" });
  res.json(await removeOrphanFiles(project));
});

/** Whole-project backup: metadata, conversation, usage log and every file. */
projectsRouter.get("/api/projects/:id/backup.zip", async (req, res) => {
  const { filename, zip } = await buildBackup(pid(req));
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", attachment("backup.zip", filename));
  res.send(zip);
});

const backupUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.BACKUP_MAX_MB ?? 500) * 1024 * 1024, files: 1 },
});

/** Restore a backup as a new project. */
projectsRouter.post("/api/projects/import", backupUpload.single("backup"), async (req, res) => {
  if (!req.file) return void res.status(400).json({ error: "请选择备份文件（.zip）" });
  try {
    const { project, skipped } = await importBackup(req.file.buffer);
    res.json({ project, skipped });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
