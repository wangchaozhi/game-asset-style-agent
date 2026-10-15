import "dotenv/config";
import { createApp } from "./app.js";
import { config } from "./config.js";

const port = config.port;
createApp().listen(port, () => console.log(`Game Asset Agent → http://localhost:${port}`));
