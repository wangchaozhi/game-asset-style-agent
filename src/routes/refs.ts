import { Router } from "express";
import multer from "multer";
import { toPng } from "../image/io.js";
import { newId, removeRefFile, updateProject, writeProjectFile } from "../store/index.js";
import { pid } from "./util.js";
import { msg } from "../i18n.js";

export const refsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 8 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(png|jpeg|webp|gif)$/.test(file.mimetype)),
});

refsRouter.post("/api/projects/:id/refs", upload.array("images", 8), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) return void res.status(400).json({ error: msg("err.noImages") });
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

refsRouter.delete("/api/projects/:id/refs/:refId", async (req, res) => {
  const refId = String(req.params.refId);
  const project = await updateProject(pid(req), (p) => void (p.refs = p.refs.filter((r) => r.id !== refId)));
  await removeRefFile(project.id, refId);
  res.json(project);
});

/** Set or clear a reference's note (what to take from it); ≤ 200 characters. */
refsRouter.patch("/api/projects/:id/refs/:refId", async (req, res) => {
  if (typeof req.body?.note !== "string") return void res.status(400).json({ error: msg("err.noteString") });
  const note = req.body.note.trim().slice(0, 200);
  let found = false;
  const project = await updateProject(pid(req), (p) => {
    const r = p.refs.find((x) => x.id === req.params.refId);
    if (!r) return;
    found = true;
    if (note) r.note = note;
    else delete r.note;
  });
  if (!found) return void res.status(404).json({ error: msg("err.noRef") });
  res.json(project);
});
