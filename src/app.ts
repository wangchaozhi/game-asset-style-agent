import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiRouter } from "./routes/index.js";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

/** Build the Express app (no listening), so tests can mount it on an ephemeral port. */
export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(publicDir));
  app.use(apiRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const code = (err as NodeJS.ErrnoException)?.code === "ENOENT" ? 404 : 500;
    res.status(code).json({ error: err instanceof Error ? err.message : String(err) });
  });
  return app;
}
