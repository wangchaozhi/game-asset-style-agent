import type { Request, Response } from "express";
import { loadProject } from "../store/index.js";
import type { Asset, Project } from "../store/types.js";
import { msg } from "../i18n.js";

export const pid = (req: Request) => String(req.params.id);

/** Load the project and the asset named in the URL; sends 404 and returns null if the asset is missing. */
export async function findAsset(req: Request, res: Response): Promise<{ project: Project; asset: Asset } | null> {
  const project = await loadProject(pid(req));
  const asset = project.assets.find((a) => a.id === req.params.assetId);
  if (!asset) {
    res.status(404).json({ error: msg("err.noAsset") });
    return null;
  }
  return { project, asset };
}

/** Content-Disposition with an ASCII fallback plus the real UTF-8 name. */
export const attachment = (fallback: string, name: string) =>
  `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
