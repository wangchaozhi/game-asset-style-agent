import fs from "node:fs/promises";
import path from "node:path";
import type { Project } from "./types.js";
import { createKeyedQueue, newId, projectDir, projectsDir, writeAtomic } from "./fs.js";

// Serialize writes per project so concurrent tool calls don't clobber project.json.
const withLock = createKeyedQueue();

const projectFile = (id: string) => path.join(projectDir(id), "project.json");

export async function loadProject(id: string): Promise<Project> {
  return JSON.parse(await fs.readFile(projectFile(id), "utf8")) as Project;
}

const saveProject = (p: Project) => writeAtomic(projectFile(p.id), JSON.stringify(p, null, 2));

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
  await fs.mkdir(projectsDir(), { recursive: true });
  const ids = (await fs.readdir(projectsDir())).filter((d) => d.startsWith("prj_"));
  const all = await Promise.all(ids.map((id) => loadProject(id).catch(() => null)));
  return all.filter((p): p is Project => p !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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

/** Project files are always a flat name under refs/ or assets/; anything else is refused. */
export const PROJECT_FILE = /^(refs|assets)\/[\w.-]+$/;

export const isProjectFile = (rel: string) => PROJECT_FILE.test(rel) && !rel.split("/").some((part) => part === "." || part === "..");

/** Absolute path of a project file, refusing paths that could leave the project directory. */
export function projectFilePath(projectId: string, rel: string): string {
  if (!isProjectFile(rel)) throw new Error(`invalid project file path: ${rel}`);
  return path.join(projectDir(projectId), rel);
}

export async function writeProjectFile(projectId: string, rel: string, data: Buffer) {
  await fs.writeFile(projectFilePath(projectId, rel), data);
}

export async function readProjectFile(projectId: string, rel: string): Promise<Buffer> {
  return fs.readFile(projectFilePath(projectId, rel));
}
