import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authGate } from "./auth.js";
import { config } from "./config.js";
import { apiRouter } from "./routes/index.js";
import { securityHeaders } from "./security.js";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

/** Build the Express app (no listening), so tests can mount it on an ephemeral port. */
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // Behind a reverse proxy, TRUST_PROXY (e.g. "1" or "loopback") lets req.ip be the real client for rate limiting.
  if (process.env.TRUST_PROXY) app.set("trust proxy", /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
  app.use(securityHeaders);
  app.use(express.json({ limit: "1mb" }));
  // Liveness probe for Docker / load balancers; never behind auth.
  app.get("/healthz", (_req, res) => void res.json({ ok: true }));
  const token = config.accessToken;
  if (token) app.use(authGate(token));
  app.use(express.static(publicDir));
  app.use(apiRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const code = (err as NodeJS.ErrnoException)?.code === "ENOENT" ? 404 : 500;
    res.status(code).json({ error: err instanceof Error ? err.message : String(err) });
  });
  return app;
}
