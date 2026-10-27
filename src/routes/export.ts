import { Router } from "express";
import { buildAtlasExport, buildExport } from "../export/bundle.js";
import { loadProject } from "../store/index.js";
import { attachment, pid } from "./util.js";

/** ?ids=a,b,c selects specific assets. */
const idsParam = (q: unknown) =>
  typeof q === "string" && q ? q.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 1000) : undefined;

export const exportRouter = Router();

/** ?status=all includes unapproved assets; ?sizes=1 adds common game sizes; ?unity=1 adds Unity .meta files. */
exportRouter.get("/api/projects/:id/export.zip", async (req, res) => {
  const project = await loadProject(pid(req));
  const all = req.query.status === "all";
  const godotRoot = typeof req.query.godot === "string" ? req.query.godot.slice(0, 200) : undefined;
  const ids = idsParam(req.query.ids);
  const tag = typeof req.query.tag === "string" && req.query.tag ? req.query.tag : undefined;
  const out = await buildExport(project, { all, ids, tag, sizes: !!req.query.sizes, godotRoot, unity: !!req.query.unity });
  if (!out) return void res.status(400).json({ error: ids ? "所选素材不存在" : tag ? `没有带「${tag}」标签的${all ? "" : "已通过"}素材` : all ? "项目还没有素材" : "还没有已通过的素材" });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", attachment("assets.zip", out.filename));
  res.send(out.zip);
});

/** Texture atlas: ?status=all, ?max=<sprite px, 16-1024>, ?size=<page px: 512/1024/2048/4096>. */
exportRouter.get("/api/projects/:id/export-atlas.zip", async (req, res) => {
  const project = await loadProject(pid(req));
  const all = req.query.status === "all";
  const maxSprite = Number(req.query.max ?? 256);
  const maxSize = Number(req.query.size ?? 2048);
  if (!Number.isInteger(maxSprite) || maxSprite < 16 || maxSprite > 1024) return void res.status(400).json({ error: "单个精灵尺寸需为 16-1024" });
  if (![512, 1024, 2048, 4096].includes(maxSize)) return void res.status(400).json({ error: "图集页尺寸需为 512/1024/2048/4096" });
  if (maxSprite + 4 > maxSize) return void res.status(400).json({ error: "单个精灵尺寸不能超过图集页尺寸" });
  const tag = typeof req.query.tag === "string" && req.query.tag ? req.query.tag : undefined;
  const out = await buildAtlasExport(project, { all, ids: idsParam(req.query.ids), tag, maxSprite, maxSize });
  if (!out) return void res.status(400).json({ error: "没有可打包的素材（背景图不进图集）" });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", attachment("atlas.zip", out.filename));
  res.send(out.zip);
});
