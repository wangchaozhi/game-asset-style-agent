import "dotenv/config";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { cleanOrphanFiles, installShutdownHandlers, purgeExpiredTrash, recoverInterruptedRuns } from "./lifecycle.js";

const interrupted = await recoverInterruptedRuns().catch(() => 0);
if (interrupted) console.log(`上次退出时有 ${interrupted} 个运行未完成，已标记为「已中断」`);
const purged = await purgeExpiredTrash().catch(() => 0);
if (purged) console.log(`回收站中 ${purged} 个过期素材已彻底删除`);
// Twice a day, purge trash items past TRASH_DAYS without waiting for a restart.
setInterval(() => void purgeExpiredTrash().catch(() => 0), 12 * 3600_000).unref();
const orphans = await cleanOrphanFiles().catch(() => ({ removed: 0, bytes: 0 }));
if (orphans.removed) console.log(`已清理 ${orphans.removed} 个无主文件（${(orphans.bytes / 1048576).toFixed(1)} MB）`);

const port = config.port;
// Log the bound port, not the requested one: PORT=0 picks a free port (used by the process test).
const server = createApp().listen(port, () => console.log(`Game Asset Agent → http://localhost:${(server.address() as AddressInfo).port}`));
installShutdownHandlers(server);
