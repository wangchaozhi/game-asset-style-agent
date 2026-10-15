import type { Server } from "node:http";
import { jobs } from "./agent/index.js";
import { flushUsageWrites, listProjects, markInterruptedRuns } from "./store/index.js";

/** On startup: runs left "running" by a previous process can never finish, so mark them interrupted. */
export async function recoverInterruptedRuns(): Promise<number> {
  let total = 0;
  for (const p of await listProjects()) total += await markInterruptedRuns(p.id);
  return total;
}

/** Abort every running job and wait (up to timeoutMs) for each to record its final state. */
export async function stopAllJobs(timeoutMs = 5000): Promise<number> {
  const running = [...jobs.values()].filter((j) => !j.finished);
  if (!running.length) return 0;
  const settled = running.map(
    (j) =>
      new Promise<void>((resolve) => {
        const onEvent = (e: { type: string }) => e.type === "done" && resolve();
        j.listeners.add(onEvent);
        j.abort.abort();
      }),
  );
  await Promise.race([Promise.all(settled), new Promise((r) => setTimeout(r, timeoutMs).unref())]);
  await flushUsageWrites();
  return running.length;
}

/** SIGINT / SIGTERM: stop accepting connections, stop jobs cleanly, then exit. */
export function installShutdownHandlers(server: Server, log = console.log) {
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return process.exit(1); // second signal: give up waiting
    closing = true;
    log(`${signal} 收到，正在停止…`);
    server.close();
    server.closeAllConnections?.();
    const n = await stopAllJobs();
    if (n) log(`已中止 ${n} 个进行中的任务`);
    await flushUsageWrites();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
