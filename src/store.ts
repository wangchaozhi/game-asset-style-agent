import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "data");
const PROJECTS_DIR = path.join(DATA_DIR, "projects");

export interface PaletteColor {
  hex: string;
  role: string;
}

export interface StyleGuide {
  summary: string;
  palette: PaletteColor[];
  rendering: string;
  line_and_edges: string;
  lighting_and_shading: string;
  perspective: string;
  proportions: string;
  texture_and_detail: string;
  mood: string;
  avoid: string[];
  prompt_prefix: string;
}

export interface RefImage {
  id: string;
  file: string; // relative to project dir
  mime: string;
  originalName: string;
}

export type AssetStatus = "pending_review" | "approved" | "rejected";

export interface Asset {
  id: string;
  name: string;
  assetType: string;
  prompt: string;
  file: string; // relative to project dir
  mime: string;
  status: AssetStatus;
  score?: number;
  notes?: string;
  runId: string;
  provider: string;
  createdAt: string;
  /** sprite_sheet only: sliced frame files and GIF preview, relative to project dir */
  frames?: string[];
  gif?: string;
  fps?: number;
  /** set once the background has been cut out; the untouched model output */
  originalFile?: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  refs: RefImage[];
  styleGuide: StyleGuide | null;
  assets: Asset[];
}

export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(5).toString("hex")}`;

export const projectDir = (id: string) => {
  if (!/^prj_[0-9a-f]+$/.test(id)) throw new Error("invalid project id");
  return path.join(PROJECTS_DIR, id);
};

// Serialize writes per project so concurrent tool calls don't clobber project.json.
const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(id, next.catch(() => undefined));
  return next;
}

export async function loadProject(id: string): Promise<Project> {
  const raw = await fs.readFile(path.join(projectDir(id), "project.json"), "utf8");
  return JSON.parse(raw) as Project;
}

async function saveProject(p: Project) {
  const file = path.join(projectDir(p.id), "project.json");
  await fs.writeFile(file + ".tmp", JSON.stringify(p, null, 2));
  await fs.rename(file + ".tmp", file);
}

export function updateProject(id: string, mutate: (p: Project) => void | Promise<void>): Promise<Project> {
  return withLock(id, async () => {
    const p = await loadProject(id);
    await mutate(p);
    await saveProject(p);
    return p;
  });
}

export async function createProject(name: string): Promise<Project> {
  const p: Project = {
    id: newId("prj"),
    name: name || "未命名项目",
    createdAt: new Date().toISOString(),
    refs: [],
    styleGuide: null,
    assets: [],
  };
  await fs.mkdir(path.join(projectDir(p.id), "refs"), { recursive: true });
  await fs.mkdir(path.join(projectDir(p.id), "assets"), { recursive: true });
  await saveProject(p);
  return p;
}

export async function listProjects(): Promise<Project[]> {
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
  const ids = (await fs.readdir(PROJECTS_DIR)).filter((d) => d.startsWith("prj_"));
  const all = await Promise.all(ids.map((id) => loadProject(id).catch(() => null)));
  return all
    .filter((p): p is Project => p !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteProject(id: string) {
  await fs.rm(projectDir(id), { recursive: true, force: true });
}

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const extFor = (mime: string) => EXT[mime] ?? "png";

export async function writeProjectFile(projectId: string, rel: string, data: Buffer) {
  await fs.writeFile(path.join(projectDir(projectId), rel), data);
}

export async function readProjectFile(projectId: string, rel: string): Promise<Buffer> {
  return fs.readFile(path.join(projectDir(projectId), rel));
}
