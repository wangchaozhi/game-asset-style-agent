import { Router } from "express";
import { type NameStyle, buildAtlasExport, buildExport } from "../export/bundle.js";
import { loadProject } from "../store/index.js";
import { attachment, pid } from "./util.js";
import { msg } from "../i18n.js";

/** ?ids=a,b,c selects specific assets. */
const idsParam = (q: unknown) =>
  typeof q === "string" && q ? q.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 1000) : undefined;

export const exportRouter = Router();

/** ?names=ascii: ASCII-only file names (type_01…) for names that aren't already. */
const namesParam = (q: unknown): NameStyle => (q === "ascii" ? "ascii" : "original");

/** ?status=all includes unapproved assets; ?sizes=1 adds common game sizes; ?unity=1 adds Unity .meta files. */
exportRouter.get("/api/projects/:id/export.zip", async (req, res) => {
  const project = await loadProject(pid(req));
  const all = req.query.status === "all";
  const godotRoot = typeof req.query.godot === "string" ? req.query.godot.slice(0, 200) : undefined;
  const ids = idsParam(req.query.ids);
  const tag = typeof req.query.tag === "string" && req.query.tag ? req.query.tag : undefined;
  const tileSize = req.query.tile === undefined ? undefined : Number(req.query.tile);
  if (tileSize !== undefined && (!Number.isInteger(tileSize) || tileSize < 8 || tileSize > 256)) return void res.status(400).json({ error: msg("err.tileSize") });
  const out = await buildExport(project, { all, ids, tag, sizes: !!req.query.sizes, godotRoot, unity: !!req.query.unity, tileSize, names: namesParam(req.query.names) });
  if (!out) return void res.status(400).json({ error: ids ? msg("err.noSelected") : tag ? msg(all ? "err.noTagged" : "err.noTaggedApproved", { tag }) : all ? msg("err.noAssets") : msg("err.noApproved") });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", attachment("assets.zip", out.filename));
  res.send(out.zip);
});

/** Texture atlas: ?status=all, ?max=<sprite px, 16-1024>, ?size=<page px: 512/1024/2048/4096>, ?cocos=1 adds cocos2d plists. */
exportRouter.get("/api/projects/:id/export-atlas.zip", async (req, res) => {
  const project = await loadProject(pid(req));
  const all = req.query.status === "all";
  const maxSprite = Number(req.query.max ?? 256);
  const maxSize = Number(req.query.size ?? 2048);
  if (!Number.isInteger(maxSprite) || maxSprite < 16 || maxSprite > 1024) return void res.status(400).json({ error: msg("err.maxSprite") });
  if (![512, 1024, 2048, 4096].includes(maxSize)) return void res.status(400).json({ error: msg("err.atlasSize") });
  if (maxSprite + 4 > maxSize) return void res.status(400).json({ error: msg("err.spriteTooBig") });
  const tag = typeof req.query.tag === "string" && req.query.tag ? req.query.tag : undefined;
  const out = await buildAtlasExport(project, { all, ids: idsParam(req.query.ids), tag, maxSprite, maxSize, names: namesParam(req.query.names), cocos: req.query.cocos === "1" });
  if (!out) return void res.status(400).json({ error: msg("err.nothingToPack") });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", attachment("atlas.zip", out.filename));
  res.send(out.zip);
});
