import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { useTempDataDir } from "./helpers.js";

useTempDataDir();
process.env.ACCESS_TOKEN = "s3cret-token";
const { createApp } = await import("../src/app.js");
const { sessionValue } = await import("../src/auth.js");

let base = "";
let server: import("node:http").Server;
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const get = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { headers, redirect: "manual" });
const login = (token: string) =>
  fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });

describe("access token", () => {
  it("leaves the health check and the login page open", async () => {
    assert.equal((await get("/healthz")).status, 200);
    assert.equal((await get("/login.html")).status, 200);
    assert.equal((await get("/js/login.js")).status, 200);
    assert.equal((await get("/css/base.css")).status, 200);
  });

  it("blocks the API with 401 and redirects pages to login", async () => {
    const api = await get("/api/config");
    assert.equal(api.status, 401);
    assert.equal((await api.json()).login, true);
    for (const page of ["/", "/index.html", "/js/main.js"]) {
      const res = await get(page);
      assert.equal(res.status, 302, page);
      assert.equal(res.headers.get("location"), "/login.html");
    }
  });

  it("rejects a wrong token", async () => {
    assert.equal((await login("nope")).status, 401);
    assert.equal((await login("")).status, 401);
  });

  it("a correct token sets an HttpOnly session cookie that opens everything", async () => {
    const res = await login("s3cret-token");
    assert.equal(res.status, 200);
    const cookie = res.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.doesNotMatch(cookie, /s3cret-token/, "the raw token is never stored in the cookie");
    const session = cookie.split(";")[0];
    const cfg = await get("/api/config", { cookie: session });
    assert.equal(cfg.status, 200);
    assert.equal((await cfg.json()).auth, true);
    assert.equal((await get("/", { cookie: session })).status, 200);
  });

  it("accepts a Bearer token for scripts", async () => {
    assert.equal((await get("/api/projects", { authorization: "Bearer s3cret-token" })).status, 200);
    assert.equal((await get("/api/projects", { authorization: "Bearer wrong" })).status, 401);
  });

  it("a forged or stale cookie is refused", async () => {
    assert.equal((await get("/api/config", { cookie: `gaa_session=${sessionValue("other")}` })).status, 401);
    assert.equal((await get("/api/config", { cookie: "gaa_session=" })).status, 401);
  });

  it("logout clears the cookie", async () => {
    const res = await fetch(base + "/api/logout", { method: "POST", headers: { cookie: `gaa_session=${sessionValue("s3cret-token")}` } });
    assert.match(res.headers.get("set-cookie")!, /Max-Age=0/);
  });
});
