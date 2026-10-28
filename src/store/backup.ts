import fs from "node:fs/promises";
import path from "node:path";
import { StyleGuideInput } from "../agent/schemas.js";
import { createZip, type ZipEntry } from "../export/zip.js";
import { readZip } from "../export/unzip.js";
import { projectDir, newId, readJson, writeAtomic } from "./fs.js";
import { isProjectFile, loadProject } from "./projects.js";
import type { Asset, Project, RefImage, TrashedAsset } from "./types.js";
import { msg } from "../i18n.js";

export const BACKUP_FORMAT = "game-asset-agent/project-backup";
const DATA_FILES = ["conversation.json", "usage.json", "style-history.json"] as const;

/** Everything needed to recreate the project elsewhere: metadata, history, usage and all files. */
export async function buildBackup(projectId: string): Promise<{ filename: string; zip: Buffer }> {
  const project = await loadProject(projectId);
  const dir = projectDir(projectId);
  const entries: ZipEntry[] = [
    { name: "backup-meta.json", data: Buffer.from(JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString() }, null, 2)) },
    { name: "project.json", data: Buffer.from(JSON.stringify(project, null, 2)) },
  ];
  for (const f of DATA_FILES) {
    const data = await fs.readFile(path.join(dir, f)).catch(() => null);
    if (data) entries.push({ name: f, data });
  }
  for (const sub of ["refs", "assets"]) {
    for (const name of (await fs.readdir(path.join(dir, sub)).catch(() => [])).sort()) {
      entries.push({ name: `${sub}/${name}`, data: await fs.readFile(path.join(dir, sub, name)) });
    }
  }
  const safe = project.name.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "") || "project";
  return { filename: `${safe}_backup.zip`, zip: createZip(entries) };
}

/**
 * Restore a backup as a new project (fresh id, so it never overwrites an existing one).
 * Unknown or unsafe paths are ignored; assets whose image file is missing are dropped;
 * an invalid style guide is cleared rather than trusted.
 */
export async function importBackup(zip: Buffer, opts: { maxBytes?: number } = {}): Promise<{ project: Project; skipped: string[] }> {
  const entries = readZip(zip, { maxTotalBytes: opts.maxBytes ?? 2 * 1024 * 1024 * 1024 });
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  const meta = parse(byName.get("backup-meta.json"));
  if ((meta as { format?: string } | null)?.format !== BACKUP_FORMAT) throw new Error(msg("err.notBackup"));
  const src = parse(byName.get("project.json")) as Partial<Project> | null;
  if (!src || !Array.isArray(src.refs) || !Array.isArray(src.assets)) throw new Error(msg("err.badBackupJson"));

  const skipped: string[] = [];
  const hasFile = (rel: unknown): rel is string => typeof rel === "string" && isProjectFile(rel) && byName.has(rel);
  const refs = (src.refs as RefImage[]).filter((r) => hasFile(r?.file) || (skipped.push(msg("backup.ref", { id: r?.id ?? "?" })), false));
  // Every path an asset carries must point into the backup; drop optional ones that don't.
  const cleanAsset = <T extends Asset>(a: T): T => {
    const c = { ...a };
    if (c.originalFile !== undefined && !hasFile(c.originalFile)) delete c.originalFile;
    if (c.gif !== undefined && !hasFile(c.gif)) delete c.gif;
    if (c.frames !== undefined && !(Array.isArray(c.frames) && c.frames.every(hasFile))) {
      delete c.frames;
      delete c.gif;
    }
    return c;
  };
  const assets = (src.assets as Asset[])
    .filter((a) => hasFile(a?.file) || (skipped.push(msg("backup.asset", { name: a?.name ?? a?.id ?? "?" })), false))
    .map(cleanAsset);
  const trash = (Array.isArray(src.trash) ? (src.trash as TrashedAsset[]) : [])
    .filter((a) => hasFile(a?.file) && typeof a.deletedAt === "string")
    .map(cleanAsset);
  const styleGuide = src.styleGuide ? (StyleGuideInput.safeParse(src.styleGuide).data ?? null) : null;
  if (src.styleGuide && !styleGuide) skipped.push(msg("backup.badStyle"));

  const project: Project = {
    id: newId("prj"),
    name: msg("project.restored", { name: String(src.name ?? msg("project.imported")).slice(0, 70) }),
    createdAt: new Date().toISOString(),
    refs,
    styleGuide,
    ...(typeof src.conventions === "string" && src.conventions.trim() ? { conventions: src.conventions.trim().slice(0, 2000) } : {}),
    assets,
    ...(trash.length ? { trash } : {}),
  };
  const dir = projectDir(project.id);
  await fs.mkdir(path.join(dir, "refs"), { recursive: true });
  await fs.mkdir(path.join(dir, "assets"), { recursive: true });
  for (const e of entries) {
    if (isProjectFile(e.name)) await fs.writeFile(path.join(dir, e.name), e.data);
    else if ((DATA_FILES as readonly string[]).includes(e.name) && parse(e.data) !== null) await fs.writeFile(path.join(dir, e.name), e.data);
  }
  await writeAtomic(path.join(dir, "project.json"), JSON.stringify(project, null, 2));
  // Runs cut off before the backup can never finish here either.
  const usage = await readJson<{ status: string }[]>(path.join(dir, "usage.json"));
  if (Array.isArray(usage) && usage.some((r) => r.status === "running")) {
    for (const r of usage) if (r.status === "running") r.status = "interrupted";
    await writeAtomic(path.join(dir, "usage.json"), JSON.stringify(usage, null, 2));
  }
  return { project, skipped };
}

function parse(data: Buffer | undefined): unknown {
  if (!data) return null;
  try {
    return JSON.parse(data.toString("utf8"));
  } catch {
    return null;
  }
}
