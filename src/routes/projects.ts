import { Router } from "express";
import multer from "multer";
import path from "node:path";
import { runningJobFor } from "../agent/index.js";
import { StyleGuideInput } from "../agent/schemas.js";
import {
  clearConversation, createProject, deleteProject, listProjects, loadConversation, loadProject, newId, projectDir, readProjectFile, writeProjectFile,
  buildBackup, importBackup, isProjectFile, loadStyleHistory, projectDiskUsage, recordStyleVersion, removeOrphanFiles, styleDiff,
  updateProject,
} from "../store/index.js";
import { THUMB_WIDTHS, getThumb } from "../image/thumbs.js";
import { isPixelArt } from "../image/sizes.js";
import type { Project } from "../store/types.js";
import { attachment, pid } from "./util.js";

export const projectsRouter = Router();

projectsRouter.get("/api/projects", async (_req, res) => {
  const all = await listProjects();
  res.json(all.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, assets: p.assets.length, cover: p.refs[0]?.file })));
});

/** Create a project; { styleFrom: "<projectId>" } copies that project's style guide and reference images (with notes). */
projectsRouter.post("/api/projects", async (req, res) => {
  const fromId = req.body?.styleFrom ? String(req.body.styleFrom) : null;
  const source = fromId ? (await listProjects()).find((p) => p.id === fromId) : null;
  if (fromId && !source) return void res.status(404).json({ error: "要复用风格的项目不存在" });
  const created = await createProject(String(req.body?.name ?? "").slice(0, 80));
  if (!source) return void res.json(created);
  const refs = await Promise.all(
    source.refs.map(async (r) => {
      const id = newId("ref");
      const file = `refs/${id}.png`;
      await writeProjectFile(created.id, file, await readProjectFile(source.id, r.file));
      return { ...r, id, file };
    }),
  );
  const p = await updateProject(created.id, (p) => {
    p.refs = refs;
    p.styleGuide = source.styleGuide;
  });
  if (source.styleGuide) await recordStyleVersion(created.id, source.styleGuide, "import");
  res.json(p);
});

projectsRouter.get("/api/projects/:id", async (req, res) => {
  res.json(await loadProject(pid(req)));
});

projectsRouter.patch("/api/projects/:id", async (req, res) => {
  let cleared = null as Project["styleGuide"];
  const p = await updateProject(pid(req), (p) => {
    if (typeof req.body?.name === "string") p.name = req.body.name.slice(0, 80);
    if (req.body?.resetStyle) {
      cleared = p.styleGuide;
      p.styleGuide = null;
    }
  });
  // Clearing keeps the old guide restorable from the history.
  if (cleared) await recordStyleVersion(p.id, cleared, "import", cleared);
  res.json(p);
});

projectsRouter.delete("/api/projects/:id", async (req, res) => {
  // A running job would keep writing into the deleted folder.
  if (runningJobFor(pid(req))) return void res.status(409).json({ error: "该项目有任务在运行，请先停止" });
  await deleteProject(pid(req));
  res.json({ ok: true });
});

projectsRouter.put("/api/projects/:id/style-guide", async (req, res) => {
  const parsed = StyleGuideInput.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return void res.status(400).json({ error: `风格指南字段无效：${issue.path.join(".")} ${issue.message}` });
  }
  let previous = null as typeof parsed.data | null;
  const project = await updateProject(pid(req), (p) => {
    previous = p.styleGuide;
    p.styleGuide = parsed.data;
  });
  await recordStyleVersion(project.id, parsed.data, "user", previous);
  res.json(project);
});

/** Saved style guide versions, newest first, with the fields that differ from the current guide. */
projectsRouter.get("/api/projects/:id/style-history", async (req, res) => {
  const project = await loadProject(pid(req));
  const list = await loadStyleHistory(project.id);
  res.json(
    list
      .map((v, index) => ({ index, ...v, changed: styleDiff(v.styleGuide, project.styleGuide) }))
      .reverse(),
  );
});

/** Make an earlier version current again (recorded as a new version). */
projectsRouter.post("/api/projects/:id/style-history/:index/restore", async (req, res) => {
  const list = await loadStyleHistory(pid(req));
  const v = list[Number(req.params.index)];
  if (!v || !/^\d+$/.test(String(req.params.index))) return void res.status(404).json({ error: "没有这个历史版本" });
  const project = await updateProject(pid(req), (p) => void (p.styleGuide = v.styleGuide));
  await recordStyleVersion(project.id, v.styleGuide, "restore");
  res.json(project);
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
  if (!isProjectFile(rel)) return void res.status(400).end();
  res.sendFile(path.join(projectDir(pid(req)), rel));
});

/** Cached WebP thumbnail of a reference or asset file: ?w=160|320|640 (default 320). */
projectsRouter.get("/api/projects/:id/thumbs/*rel", async (req, res) => {
  const rel = ([] as string[]).concat(req.params.rel as string | string[]).join("/");
  if (!isProjectFile(rel)) return void res.status(400).end();
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
