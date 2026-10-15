import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createProject,
  deleteProject,
  listProjects,
  loadProject,
  newId,
  projectDir,
  readProjectFile,
  updateProject,
  writeProjectFile,
} from "./store.js";
import { providers, toPng } from "./imageProviders.js";
import { ASSET_TYPES, type AgentEvent, jobs, sliceAssetFrames, startJob } from "./agent.js";


const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 8 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(png|jpeg|webp|gif)$/.test(file.mimetype)),
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(here, "..", "public")));

const pid = (req: Request) => String(req.params.id);

app.get("/api/config", (_req, res) => {
  res.json({
    providers: providers.map((p) => ({ id: p.id, label: p.label, available: p.available() })),
    assetTypes: ASSET_TYPES,
    demo: process.env.AGENT_MODE === "demo",
  });
});

app.get("/api/projects", async (_req, res) => {
  const all = await listProjects();
  res.json(all.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, assets: p.assets.length, cover: p.refs[0]?.file })));
});

app.post("/api/projects", async (req, res) => {
  res.json(await createProject(String(req.body?.name ?? "").slice(0, 80)));
});

app.get("/api/projects/:id", async (req, res) => {
  res.json(await loadProject(pid(req)));
});

app.patch("/api/projects/:id", async (req, res) => {
  const p = await updateProject(pid(req), (p) => {
    if (typeof req.body?.name === "string") p.name = req.body.name.slice(0, 80);
    if (req.body?.resetStyle) p.styleGuide = null;
  });
  res.json(p);
});

app.delete("/api/projects/:id", async (req, res) => {
  await deleteProject(pid(req));
  res.json({ ok: true });
});

app.post("/api/projects/:id/refs", upload.array("images", 8), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) return void res.status(400).json({ error: "没有可用的图片（支持 png/jpg/webp/gif）" });
  const p = await updateProject(pid(req), async (p) => {
    for (const f of files) {
      const id = newId("ref");
      const file = `refs/${id}.png`;
      await writeProjectFile(p.id, file, await toPng(f.buffer));
      p.refs.push({ id, file, mime: "image/png", originalName: f.originalname });
    }
  });
  res.json(p);
});

app.delete("/api/projects/:id/refs/:refId", async (req, res) => {
  res.json(await updateProject(pid(req), (p) => void (p.refs = p.refs.filter((r) => r.id !== req.params.refId))));
});

app.delete("/api/projects/:id/assets/:assetId", async (req, res) => {
  res.json(await updateProject(pid(req), (p) => void (p.assets = p.assets.filter((a) => a.id !== req.params.assetId))));
});

app.post("/api/projects/:id/assets/:assetId/slice", async (req, res) => {
  const projectId = pid(req);
  const project = await loadProject(projectId);
  const asset = project.assets.find((a) => a.id === req.params.assetId);
  if (!asset) return void res.status(404).json({ error: "素材不存在" });
  const frames = req.body?.frames ? Number(req.body.frames) : undefined;
  const fps = req.body?.fps ? Number(req.body.fps) : 8;
  if (frames !== undefined && !(frames >= 1 && frames <= 32)) return void res.status(400).json({ error: "帧数需在 1-32 之间" });
  const sliced = await sliceAssetFrames(projectId, asset, await readProjectFile(projectId, asset.file), frames, fps);
  const p = await updateProject(projectId, (p) => {
    const a = p.assets.find((x) => x.id === asset.id);
    if (a) Object.assign(a, sliced);
  });
  res.json(p.assets.find((a) => a.id === asset.id));
});

app.get("/api/projects/:id/files/*rel", (req, res) => {
  const rel = ([] as string[]).concat(req.params.rel as string | string[]).join("/");
  if (!/^(refs|assets)\/[\w.-]+$/.test(rel)) return void res.status(400).end();
  res.sendFile(path.join(projectDir(pid(req)), rel));
});

app.post("/api/projects/:id/run", async (req, res) => {
  const projectId = pid(req);
  await loadProject(projectId);
  const running = [...jobs.values()].find((j) => j.projectId === projectId && !j.finished);
  if (running) return void res.status(409).json({ error: "该项目已有任务在运行", jobId: running.id });
  const job = startJob({
    projectId,
    request: String(req.body?.request ?? "").slice(0, 4000),
    assetTypes: Array.isArray(req.body?.assetTypes) ? req.body.assetTypes.map(String) : [],
    providerId: req.body?.provider ? String(req.body.provider) : undefined,
  });
  res.json({ jobId: job.id });
});

app.post("/api/jobs/:id/stop", (req, res) => {
  jobs.get(String(req.params.id))?.abort.abort();
  res.json({ ok: true });
});

app.get("/api/jobs/:id/events", (req, res) => {
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

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const code = (err as NodeJS.ErrnoException)?.code === "ENOENT" ? 404 : 500;
  res.status(code).json({ error: err instanceof Error ? err.message : String(err) });
});

const port = Number(process.env.PORT ?? 5173);
app.listen(port, () => console.log(`Game Asset Agent → http://localhost:${port}`));
