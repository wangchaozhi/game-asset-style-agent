import path from "node:path";
import type { StyleGuide } from "./types.js";
import { createKeyedQueue, projectDir, readJson, writeAtomic } from "./fs.js";

export interface StyleVersion {
  at: string;
  /** who produced this version */
  source: "agent" | "user" | "restore" | "import";
  styleGuide: StyleGuide;
}

const MAX_VERSIONS = 50;
const file = (projectId: string) => path.join(projectDir(projectId), "style-history.json");
const queue = createKeyedQueue();

/** Oldest first. */
export async function loadStyleHistory(projectId: string): Promise<StyleVersion[]> {
  const list = await readJson<StyleVersion[]>(file(projectId));
  return Array.isArray(list) ? list : [];
}

/**
 * Record a style guide version; identical consecutive versions are not duplicated.
 * `previous` is the guide being replaced: if the history is still empty (a project from before
 * history existed), it is saved first so the overwrite stays reversible.
 */
export function recordStyleVersion(
  projectId: string,
  styleGuide: StyleGuide,
  source: StyleVersion["source"],
  previous?: StyleGuide | null,
): Promise<void> {
  return queue(projectId, async () => {
    const list = await loadStyleHistory(projectId);
    if (!list.length && previous) list.push({ at: new Date(0).toISOString(), source: "import", styleGuide: previous });
    const last = list.at(-1);
    if (last && JSON.stringify(last.styleGuide) === JSON.stringify(styleGuide)) return;
    list.push({ at: new Date().toISOString(), source, styleGuide });
    await writeAtomic(file(projectId), JSON.stringify(list.slice(-MAX_VERSIONS), null, 2));
  });
}

/** Names of the top-level fields that differ between two style guides. */
export function styleDiff(a: StyleGuide | null, b: StyleGuide | null): string[] {
  if (!a || !b) return a === b ? [] : ["*"];
  return (Object.keys({ ...a, ...b }) as (keyof StyleGuide)[]).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}
