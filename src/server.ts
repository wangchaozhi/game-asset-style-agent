import "dotenv/config";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { cleanOrphanFiles, installShutdownHandlers, recoverInterruptedRuns } from "./lifecycle.js";

const interrupted = await recoverInterruptedRuns().catch(() => 0);
if (interrupted) console.log(`上次退出时有 ${interrupted} 个运行未完成，已标记为「已中断」`);
const orphans = await cleanOrphanFiles().catch(() => ({ removed: 0, bytes: 0 }));
if (orphans.removed) console.log(`已清理 ${orphans.removed} 个无主文件（${(orphans.bytes / 1048576).toFixed(1)} MB）`);

const port = config.port;
const server = createApp().listen(port, () => console.log(`Game Asset Agent → http://localhost:${port}`));
installShutdownHandlers(server);
