import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CSP, createLoginLimiter } from "../src/security.js";

describe("login limiter", () => {
  it("blocks an IP after max failures until the window passes", () => {
    let t = 0;
    const l = createLoginLimiter({ max: 3, windowMs: 1000, now: () => t });
    for (let i = 0; i < 3; i++) {
      assert.equal(l.blockedFor("1.1.1.1"), 0);
      l.fail("1.1.1.1");
    }
    assert.equal(l.blockedFor("1.1.1.1"), 1000);
    assert.equal(l.blockedFor("2.2.2.2"), 0, "other IPs are unaffected");
    t = 600;
    assert.equal(l.blockedFor("1.1.1.1"), 400);
    t = 1000;
    assert.equal(l.blockedFor("1.1.1.1"), 0, "window expired");
  });

  it("a successful login clears the count", () => {
    const l = createLoginLimiter({ max: 2, windowMs: 1000, now: () => 0 });
    l.fail("ip");
    l.succeed("ip");
    l.fail("ip");
    assert.equal(l.blockedFor("ip"), 0);
  });
});

describe("CSP", () => {
  it("allows no inline or third-party scripts and no framing", () => {
    assert.match(CSP, /script-src 'self'(;|$)/);
    assert.match(CSP, /frame-ancestors 'none'/);
    assert.match(CSP, /object-src 'none'/);
  });
});
