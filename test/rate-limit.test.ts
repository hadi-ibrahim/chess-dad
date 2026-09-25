/**
 * The per-IP throttle on the expensive routes.
 *
 * It is a fixed window over an in-process map, so the decisions worth pinning are:
 * how many requests fit, when the window resets, that keys do not bleed into each
 * other, and — importantly — that it fails *open* when no caller address can be
 * determined, because a shared "unknown" bucket would let a proxy misconfiguration
 * lock every user out.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS,
  clientIp,
  enforceRateLimit,
  rateLimit,
  resetRateLimits,
} from "@/lib/rate-limit";

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/x", { headers });
}

describe("rateLimit", () => {
  beforeEach(() => resetRateLimits());

  test("allows exactly `limit` requests in the window, then blocks", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) {
      assert.equal(rateLimit("k", 3, 1000, now).ok, true, `request ${i + 1} should pass`);
    }
    const blocked = rateLimit("k", 3, 1000, now);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.remaining, 0);
    assert.ok(blocked.retryAfterSeconds >= 1);
  });

  test("the window resets once it expires", () => {
    assert.equal(rateLimit("k", 1, 1000, 0).ok, true);
    assert.equal(rateLimit("k", 1, 1000, 500).ok, false);
    assert.equal(rateLimit("k", 1, 1000, 1000).ok, true);
  });

  test("keys are independent", () => {
    assert.equal(rateLimit("a", 1, 1000, 0).ok, true);
    assert.equal(rateLimit("b", 1, 1000, 0).ok, true);
    assert.equal(rateLimit("a", 1, 1000, 0).ok, false);
    assert.equal(rateLimit("b", 1, 1000, 0).ok, false);
  });

  test("remaining counts down, and retryAfter counts down with the window", () => {
    assert.equal(rateLimit("k", 3, 10_000, 0).remaining, 2);
    assert.equal(rateLimit("k", 3, 10_000, 0).remaining, 1);
    assert.equal(rateLimit("k", 1, 10_000, 4_000).retryAfterSeconds, 6);
  });
});

describe("clientIp", () => {
  test("takes the first entry of an x-forwarded-for chain", () => {
    assert.equal(clientIp(request({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
  });

  test("falls back to x-real-ip", () => {
    assert.equal(clientIp(request({ "x-real-ip": "198.51.100.4" })), "198.51.100.4");
  });

  test("returns null when there is nothing to key on", () => {
    assert.equal(clientIp(request()), null);
  });
});

describe("enforceRateLimit", () => {
  beforeEach(() => resetRateLimits());

  test("returns a 429 with Retry-After once the scope limit is passed", () => {
    const req = request({ "x-forwarded-for": "203.0.113.1" });
    for (let i = 0; i < LIMITS.analyze.limit; i++) {
      assert.equal(enforceRateLimit(req, "analyze"), null, `request ${i + 1} should pass`);
    }
    const blocked = enforceRateLimit(req, "analyze");
    assert.ok(blocked, "the next request should be blocked");
    assert.equal(blocked!.status, 429);
    assert.ok(blocked!.headers.get("retry-after"));
  });

  test("a different address has its own budget", () => {
    const first = request({ "x-forwarded-for": "203.0.113.1" });
    const second = request({ "x-forwarded-for": "203.0.113.2" });
    for (let i = 0; i < LIMITS.analyze.limit; i++) enforceRateLimit(first, "analyze");
    assert.equal(enforceRateLimit(first, "analyze")?.status, 429);
    assert.equal(enforceRateLimit(second, "analyze"), null);
  });

  test("scopes do not share a budget", () => {
    const req = request({ "x-forwarded-for": "203.0.113.3" });
    for (let i = 0; i < LIMITS.analyze.limit; i++) enforceRateLimit(req, "analyze");
    assert.equal(enforceRateLimit(req, "analyze")?.status, 429);
    assert.equal(enforceRateLimit(req, "jobs"), null, "the jobs scope is untouched");
  });

  test("fails open when no address can be determined", () => {
    // A shared "unknown" bucket would lock everybody out behind a proxy that does
    // not report an address, which is worse than having no limit.
    const req = request();
    for (let i = 0; i < LIMITS.analyze.limit + 5; i++) {
      assert.equal(enforceRateLimit(req, "analyze"), null);
    }
  });
});
