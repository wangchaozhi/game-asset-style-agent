import "dotenv/config";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { installShutdownHandlers, recoverInterruptedRuns } from "./lifecycle.js";

const interrupted = await recoverInterruptedRuns().catch(() => 0);
if (interrupted) console.log(`上次退出时有 ${interrupted} 个运行未完成，已标记为「已中断」`);

const port = config.port;
const server = createApp().listen(port, () => console.log(`Game Asset Agent → http://localhost:${port}`));
installShutdownHandlers(server);
