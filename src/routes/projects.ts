import { Router } from "express";
import path from "node:path";
import { StyleGuideInput } from "../agent/schemas.js";
import {
  clearConversation, createProject, deleteProject, listProjects, loadConversation, loadProject, projectDir, updateProject,
} from "../store/index.js";
import { pid } from "./util.js";

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
