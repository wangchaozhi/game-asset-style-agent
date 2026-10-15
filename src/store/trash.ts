import { removeAssetFiles } from "./files.js";
import { listProjects, updateProject } from "./projects.js";
import type { Project } from "./types.js";

// Mutators below run inside updateProject() so they are atomic with the project write.

/** Move assets to the trash. Returns how many moved. */
export function moveToTrash(p: Project, ids: Set<string>, now = new Date().toISOString()): number {
  const moving = p.assets.filter((a) => ids.has(a.id));
  if (!moving.length) return 0;
  p.assets = p.assets.filter((a) => !ids.has(a.id));
  p.trash = [...(p.trash ?? []), ...moving.map((a) => ({ ...a, deletedAt: now }))];
  return moving.length;
}

/** Move trashed assets back to the library. Returns how many came back. */
export function restoreFromTrash(p: Project, ids: Set<string>): number {
  const back = (p.trash ?? []).filter((a) => ids.has(a.id));
  if (!back.length) return 0;
  p.trash = (p.trash ?? []).filter((a) => !ids.has(a.id));
  p.assets.push(...back.map(({ deletedAt: _d, ...a }) => a));
  return back.length;
}

/** Remove assets for good from the library or the trash. Returns the removed ids (delete their files next). */
export function takeForPurge(p: Project, ids: Set<string>): string[] {
  const gone = [...p.assets, ...(p.trash ?? [])].filter((a) => ids.has(a.id)).map((a) => a.id);
  p.assets = p.assets.filter((a) => !ids.has(a.id));
  p.trash = (p.trash ?? []).filter((a) => !ids.has(a.id));
  return gone;
}

/** Permanently delete trashed assets older than `days` (0 = everything in the trash). */
export async function purgeExpiredTrash(days = Number(process.env.TRASH_DAYS ?? 7), now = Date.now()): Promise<number> {
  let total = 0;
  for (const project of await listProjects()) {
    if (!project.trash?.length) continue;
    let gone: string[] = [];
    await updateProject(project.id, (p) => {
      const expired = new Set((p.trash ?? []).filter((a) => now - Date.parse(a.deletedAt) >= days * 86_400_000).map((a) => a.id));
      gone = takeForPurge(p, expired);
    });
    if (gone.length) await removeAssetFiles(project.id, gone);
    total += gone.length;
  }
  return total;
}
