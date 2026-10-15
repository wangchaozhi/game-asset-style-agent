import type { NextFunction, Request, Response } from "express";

/**
 * Content-Security-Policy for the bundled UI: scripts only from this origin (no inline JS),
 * inline style attributes allowed (the UI sets colours and sizes inline), images may be data:/blob:.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
}

/**
 * Fixed-window limiter for failed logins, per client IP. A success clears the IP's count.
 * In memory only: fine for the single-instance deployment this app supports.
 */
export function createLoginLimiter(opts: { max?: number; windowMs?: number; now?: () => number } = {}) {
  const max = opts.max ?? Number(process.env.LOGIN_MAX_ATTEMPTS ?? 10);
  const windowMs = opts.windowMs ?? 10 * 60_000;
  const now = opts.now ?? Date.now;
  const fails = new Map<string, { count: number; since: number }>();

  const entry = (ip: string) => {
    const e = fails.get(ip);
    if (e && now() - e.since >= windowMs) {
      fails.delete(ip);
      return undefined;
    }
    return e;
  };
  return {
    /** ms until the IP may try again, or 0 if it is not blocked */
    blockedFor(ip: string): number {
      const e = entry(ip);
      return e && e.count >= max ? e.since + windowMs - now() : 0;
    },
    fail(ip: string) {
      const e = entry(ip) ?? { count: 0, since: now() };
      e.count++;
      fails.set(ip, e);
      // Keep memory bounded if someone sprays from many addresses.
      if (fails.size > 10_000) fails.delete(fails.keys().next().value!);
    },
    succeed(ip: string) {
      fails.delete(ip);
    },
  };
}
