import crypto from "node:crypto";
import { type NextFunction, type Request, type Response, Router } from "express";

export const COOKIE = "gaa_session";
const MAX_AGE_S = 30 * 24 * 3600;

/** Files the login page itself needs before the visitor is signed in. */
const PUBLIC_PATHS = new Set(["/login.html", "/js/login.js", "/css/base.css", "/css/login.css", "/healthz", "/api/login"]);

/** The cookie holds an HMAC of the token, never the token itself. */
export const sessionValue = (token: string) => crypto.createHmac("sha256", token).update("gaa-session-v1").digest("hex");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function isAuthorized(req: Request, token: string) {
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
  if (bearer && safeEqual(bearer, token)) return true;
  const cookie = readCookie(req, COOKIE);
  return !!cookie && safeEqual(cookie, sessionValue(token));
}

/**
 * Login routes plus a gate in front of everything else.
 * API calls without a session get 401; page loads are sent to the login page.
 */
export function authGate(token: string) {
  const router = Router();

  router.post("/api/login", (req, res) => {
    const given = typeof req.body?.token === "string" ? req.body.token : "";
    if (!safeEqual(given, token)) return void res.status(401).json({ error: "访问令牌不正确" });
    const secure = req.secure ? "; Secure" : "";
    res.setHeader("Set-Cookie", `${COOKIE}=${sessionValue(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure}`);
    res.json({ ok: true });
  });

  router.post("/api/logout", (_req, res) => {
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (PUBLIC_PATHS.has(req.path) || req.path === "/favicon.ico" || isAuthorized(req, token)) return next();
    if (req.path.startsWith("/api/")) return void res.status(401).json({ error: "需要登录", login: true });
    res.redirect(302, "/login.html");
  });

  return router;
}
