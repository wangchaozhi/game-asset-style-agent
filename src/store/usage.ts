import path from "node:path";
import type { RunUsage } from "../usage/types.js";
import { createKeyedQueue, projectDir, readJson, writeAtomic } from "./fs.js";

// Per-project run usage log: data/projects/<id>/usage.json
const usageFile = (projectId: string) => path.join(projectDir(projectId), "usage.json");
const queue = createKeyedQueue();

export async function loadUsage(projectId: string): Promise<RunUsage[]> {
  const list = await readJson<RunUsage[]>(usageFile(projectId));
  return Array.isArray(list) ? list : [];
}

/** Insert or replace the run with the same jobId. Writes are serialized per project. */
export function saveRunUsage(projectId: string, run: RunUsage): Promise<void> {
  return queue(projectId, async () => {
    const list = await loadUsage(projectId);
    const i = list.findIndex((r) => r.jobId === run.jobId);
    if (i >= 0) list[i] = run;
    else list.push(run);
    await writeAtomic(usageFile(projectId), JSON.stringify(list, null, 2));
  });
}
