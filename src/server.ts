import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createProject,
  deleteProject,
  clearConversation,
  listProjects,
  loadConversation,
  loadProject,
  newId,
  projectDir,
  readProjectFile,
  updateProject,
  writeProjectFile,
} from "./store.js";
import { providers, toPng } from "./imageProviders.js";
import { removeBackground } from "./postprocess.js";
import { analyzeSeams, tilePreview } from "./tiles.js";
import { createZip, type ZipEntry } from "./zip.js";
import { SIZE_PRESETS, isPixelArt, parseSize, resizeAsset } from "./sizes.js";
import { ASSET_TYPES, type AgentEvent, StyleGuideInput, jobs, sliceAssetFrames, startJob } from "./agent.js";
import { usageRouter } from "./routes/usage.js";


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

app.use(usageRouter);

app.get("/api/config", (_req, res) => {
  res.json({
    providers: providers.map((p) => ({ id: p.id, label: p.label, available: p.available() })),
    assetTypes: ASSET_TYPES,
    sizePresets: SIZE_PRESETS,
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

app.put("/api/projects/:id/style-guide", async (req, res) => {
  const parsed = StyleGuideInput.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return void res.status(400).json({ error: `风格指南字段无效：${issue.path.join(".")} ${issue.message}` });
  }
  res.json(await updateProject(pid(req), (p) => void (p.styleGuide = parsed.data)));
});

app.get("/api/projects/:id/conversation", async (req, res) => {
  const conv = await loadConversation(pid(req));
  res.json({ runs: conv?.runs ?? [], bytes: conv ? JSON.stringify(conv.messages).length : 0 });
});

app.delete("/api/projects/:id/conversation", async (req, res) => {
  await clearConversation(pid(req));
  res.json({ ok: true });
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

app.patch("/api/projects/:id/assets/:assetId", async (req, res) => {
  const status = req.body?.status;
  if (!["approved", "rejected", "pending_review"].includes(status)) return void res.status(400).json({ error: "无效的状态" });
  let asset;
  await updateProject(pid(req), (p) => {
    asset = p.assets.find((a) => a.id === req.params.assetId);
    if (!asset) return;
    asset.status = status;
    asset.reviewer = "user";
    if (typeof req.body?.notes === "string") asset.notes = req.body.notes.slice(0, 2000);
  });
  if (!asset) return void res.status(404).json({ error: "素材不存在" });
  res.json(asset);
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

app.post("/api/projects/:id/assets/:assetId/cutout", async (req, res) => {
  const projectId = pid(req);
  const project = await loadProject(projectId);
  const asset = project.assets.find((a) => a.id === req.params.assetId);
  if (!asset) return void res.status(404).json({ error: "素材不存在" });
  const tolerance = Math.max(1, Math.min(120, Number(req.body?.tolerance ?? 28)));
  const restore = !!req.body?.restore;
  const originalFile = asset.originalFile ?? `assets/${asset.id}_orig.${asset.file.split(".").pop()}`;
  if (!asset.originalFile) await writeProjectFile(projectId, originalFile, await readProjectFile(projectId, asset.file));
  let file = originalFile;
  if (!restore) {
    file = `assets/${asset.id}_cut${Date.now().toString(36)}.png`;
    await writeProjectFile(projectId, file, await removeBackground(await readProjectFile(projectId, originalFile), tolerance));
  }
  const sliced = asset.frames?.length
    ? await sliceAssetFrames(projectId, asset, await readProjectFile(projectId, file), asset.frames.length, asset.fps)
    : {};
  const p = await updateProject(projectId, (p) => {
    const a = p.assets.find((x) => x.id === asset.id);
    if (a) Object.assign(a, { originalFile, file, mime: restore ? asset.mime : "image/png" }, sliced);
  });
  res.json(p.assets.find((a) => a.id === asset.id));
});

app.get("/api/projects/:id/assets/:assetId/seams", async (req, res) => {
  const projectId = pid(req);
  const project = await loadProject(projectId);
  const asset = project.assets.find((a) => a.id === req.params.assetId);
  if (!asset) return void res.status(404).json({ error: "素材不存在" });
  res.json(await analyzeSeams(await readProjectFile(projectId, asset.file)));
});

app.get("/api/projects/:id/assets/:assetId/tiled.png", async (req, res) => {
  const projectId = pid(req);
  const project = await loadProject(projectId);
  const asset = project.assets.find((a) => a.id === req.params.assetId);
  if (!asset) return void res.status(404).json({ error: "素材不存在" });
  const n = Number(req.query.n ?? 3);
  if (!Number.isInteger(n) || n < 2 || n > 6) return void res.status(400).json({ error: "平铺数需为 2-6 的整数" });
  res.setHeader("Content-Type", "image/png");
  res.send(await tilePreview(await readProjectFile(projectId, asset.file), n));
});

app.get("/api/projects/:id/assets/:assetId/sized.png", async (req, res) => {
  const projectId = pid(req);
  const project = await loadProject(projectId);
  const asset = project.assets.find((a) => a.id === req.params.assetId);
  if (!asset) return void res.status(404).json({ error: "素材不存在" });
  const size = parseSize(String(req.query.size ?? ""));
  if (!size) return void res.status(400).json({ error: "尺寸格式应为 32 或 1280x720（8–4096）" });
  const pixel = req.query.kernel ? req.query.kernel === "nearest" : isPixelArt(project.styleGuide);
  const png = await resizeAsset(await readProjectFile(projectId, asset.file), {
    ...size, assetType: asset.assetType, pixel, frames: asset.frames?.length,
  });
  res.setHeader("Content-Type", "image/png");
  if (req.query.download) {
    res.setHeader("Content-Disposition", `attachment; filename="asset.png"; filename*=UTF-8''${encodeURIComponent(`${asset.name}@${req.query.size}.png`)}`);
  }
  res.send(png);
});

app.get("/api/projects/:id/export.zip", async (req, res) => {
  const projectId = pid(req);
  const project = await loadProject(projectId);
  const all = req.query.status === "all";
  const assets = project.assets.filter((a) => all || a.status === "approved");
  if (!assets.length) return void res.status(400).json({ error: all ? "项目还没有素材" : "还没有已通过的素材" });

  const entries: ZipEntry[] = [];
  const used = new Set<string>();
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "") || "asset";
  const unique = (base: string) => {
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}_${i}`;
    used.add(name);
    return name;
  };
  const manifest = [];
  for (const a of assets) {
    const dir = a.assetType;
    const base = unique(`${dir}/${safe(a.name)}`);
    const ext = a.file.split(".").pop();
    const files: Record<string, string | string[]> = { image: `${base}.${ext}` };
    entries.push({ name: `${base}.${ext}`, data: await readProjectFile(projectId, a.file) });
    if (req.query.sizes) {
      files.sizes = [];
      const original = await readProjectFile(projectId, a.file);
      for (const spec of SIZE_PRESETS[a.assetType] ?? []) {
        const n = `${base}@${spec}.png`;
        files.sizes.push(n);
        entries.push({
          name: n,
          data: await resizeAsset(original, {
            ...parseSize(spec)!, assetType: a.assetType, pixel: isPixelArt(project.styleGuide), frames: a.frames?.length,
          }),
        });
      }
    }
    if (a.gif) {
      files.gif = `${base}.gif`;
      entries.push({ name: `${base}.gif`, data: await readProjectFile(projectId, a.gif) });
    }
    if (a.frames?.length) {
      files.frames = [];
      for (const [i, f] of a.frames.entries()) {
        const n = `${base}_frames/${String(i).padStart(2, "0")}.png`;
        files.frames.push(n);
        entries.push({ name: n, data: await readProjectFile(projectId, f) });
      }
    }
    manifest.push({
      id: a.id, name: a.name, type: a.assetType, status: a.status, score: a.score ?? null,
      notes: a.notes ?? null, prompt: a.prompt, provider: a.provider, createdAt: a.createdAt, fps: a.fps ?? null, files,
    });
  }
  for (const [i, r] of project.refs.entries()) {
    entries.push({ name: `_references/ref_${i + 1}.png`, data: await readProjectFile(projectId, r.file) });
  }
  const json = (v: unknown) => Buffer.from(JSON.stringify(v, null, 2));
  entries.push({ name: "style-guide.json", data: json(project.styleGuide) });
  entries.push({
    name: "manifest.json",
    data: json({ project: project.name, exportedAt: new Date().toISOString(), count: manifest.length, assets: manifest }),
  });

  const zip = createZip(entries);
  const filename = `${safe(project.name)}_assets.zip`;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="assets.zip"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(zip);
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
    continueConversation: req.body?.continueConversation !== false,
    redraw: req.body?.redraw?.assetId
      ? { assetId: String(req.body.redraw.assetId), feedback: String(req.body.redraw.feedback ?? "").slice(0, 2000) }
      : undefined,
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
