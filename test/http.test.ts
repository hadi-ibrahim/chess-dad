/**
 * HTTP retry behaviour. `fetchWithBackoff` rides out Lichess's aggressive
 * anonymous throttling, so the decisions that matter are: which statuses retry,
 * how many times, and whether the server's `Retry-After` is honoured over our own
 * exponential guess. `globalThis.fetch` is stubbed throughout — no network.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseRetryAfterMs, sleep, fetchWithBackoff, USER_AGENT } from "@/lib/http";

/** A queued-response fetch stub. Each call returns the next response factory. */
function stubFetch(factories: Array<() => Response | Promise<Response>>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const factory = factories[Math.min(i, factories.length - 1)];
    i++;
    return factory();
  }) as typeof fetch;
  return {
    calls,
    get attempts() {
      return calls.length;
    },
    restore() {
      globalThis.fetch = original;
    },
  };
}

/** Run `fn` with `globalThis.fetch` replaced, always restoring it. */
async function withStubbedFetch<T>(
  factories: Array<() => Response>,
  fn: (stub: ReturnType<typeof stubFetch>) => Promise<T>
): Promise<T> {
  const stub = stubFetch(factories);
  try {
    return await fn(stub);
  } finally {
    stub.restore();
  }
}

const res = (status: number, headers: Record<string, string> = {}) =>
  new Response(null, { status, headers });

describe("parseRetryAfterMs", () => {
  test("reads delta-seconds", () => {
    assert.equal(parseRetryAfterMs("5"), 5000);
    assert.equal(parseRetryAfterMs("0"), 0);
    assert.equal(parseRetryAfterMs("1.5"), 1500);
    assert.equal(parseRetryAfterMs(" 10 "), 10000); // Number() trims
  });

  test("clamps negative values to zero", () => {
    assert.equal(parseRetryAfterMs("-3"), 0);
    assert.equal(parseRetryAfterMs("-0.5"), 0);
  });

  test("reads an HTTP-date relative to now", () => {
    const tenSeconds = parseRetryAfterMs(new Date(Date.now() + 10_000).toUTCString());
    assert.ok(tenSeconds !== null && tenSeconds > 8500 && tenSeconds <= 10_000, `got ${tenSeconds}`);
  });

  test("a date in the past is zero, not negative", () => {
    assert.equal(parseRetryAfterMs(new Date(Date.now() - 60_000).toUTCString()), 0);
  });

  test("garbage, Infinity and missing values are null", () => {
    assert.equal(parseRetryAfterMs(null), null);
    assert.equal(parseRetryAfterMs(""), null);
    assert.equal(parseRetryAfterMs("soon"), null);
    assert.equal(parseRetryAfterMs("5s"), null);
    assert.equal(parseRetryAfterMs("Infinity"), null);
    assert.equal(parseRetryAfterMs("5,000"), null);
  });

  test("whitespace-only is treated as zero seconds, not missing", () => {
    // Number("   ") is 0, which is finite, so this returns 0 rather than null.
    assert.equal(parseRetryAfterMs("   "), 0);
  });
});

describe("sleep", () => {
  test("resolves after at least the requested delay", async () => {
    const start = performance.now();
    await sleep(30);
    const elapsed = performance.now() - start;
    assert.ok(elapsed >= 25, `sleep(30) returned after ${elapsed}ms`);
  });

  test("resolves to undefined and a zero delay still yields", async () => {
    assert.equal(await sleep(0), undefined);
  });
});

describe("fetchWithBackoff", () => {
  test("returns a 2xx immediately, without retrying", async () => {
    await withStubbedFetch([() => res(200)], async (stub) => {
      const r = await fetchWithBackoff("https://example.test/games", {}, { baseDelayMs: 1 });
      assert.equal(r.status, 200);
      assert.equal(stub.attempts, 1);
    });
  });

  test("does not retry ordinary client errors", async () => {
    for (const status of [301, 400, 401, 403, 404, 422]) {
      await withStubbedFetch([() => res(status)], async (stub) => {
        const r = await fetchWithBackoff("https://example.test/x", {}, { baseDelayMs: 1 });
        assert.equal(r.status, status);
        assert.equal(stub.attempts, 1, `status ${status} should not retry`);
      });
    }
  });

  test("retries a 500 and returns the eventual success", async () => {
    await withStubbedFetch([() => res(500), () => res(200)], async (stub) => {
      const r = await fetchWithBackoff("https://example.test/x", {}, { baseDelayMs: 1 });
      assert.equal(r.status, 200);
      assert.equal(stub.attempts, 2);
    });
  });

  test("retries a 429 and returns the eventual success", async () => {
    await withStubbedFetch([() => res(429), () => res(200)], async (stub) => {
      const r = await fetchWithBackoff("https://example.test/x", {}, { baseDelayMs: 1 });
      assert.equal(r.status, 200);
      assert.equal(stub.attempts, 2);
    });
  });

  test("makes retries + 1 attempts in total, then returns the last failure", async () => {
    await withStubbedFetch(
      [() => res(500), () => res(503), () => res(502), () => res(504)],
      async (stub) => {
        const r = await fetchWithBackoff("https://example.test/x", {}, { retries: 3, baseDelayMs: 1 });
        assert.equal(r.status, 504);
        assert.equal(stub.attempts, 4);
      }
    );
  });

  test("retries: 0 means exactly one attempt", async () => {
    await withStubbedFetch([() => res(500)], async (stub) => {
      const r = await fetchWithBackoff("https://example.test/x", {}, { retries: 0, baseDelayMs: 1 });
      assert.equal(r.status, 500);
      assert.equal(stub.attempts, 1);
    });
  });

  test("passes the same url and init to every attempt", async () => {
    const init: RequestInit = { headers: { "user-agent": USER_AGENT } };
    await withStubbedFetch([() => res(500), () => res(200)], async (stub) => {
      await fetchWithBackoff("https://example.test/games?p=1", init, { baseDelayMs: 1 });
      assert.equal(stub.calls.length, 2);
      assert.deepEqual(stub.calls[0], { url: "https://example.test/games?p=1", init });
      assert.deepEqual(stub.calls[1], { url: "https://example.test/games?p=1", init });
    });
  });

  test("reports each retry with an increasing attempt number and exponential delay", async () => {
    const retries: Array<{ attempt: number; delayMs: number; status: number }> = [];
    await withStubbedFetch(
      [() => res(500), () => res(503), () => res(200)],
      async () => {
        await fetchWithBackoff(
          "https://example.test/x",
          {},
          { retries: 2, baseDelayMs: 10, maxDelayMs: 10_000, onRetry: (info) => retries.push(info) }
        );
      }
    );
    assert.deepEqual(retries, [
      { attempt: 1, delayMs: 10, status: 500 },
      { attempt: 2, delayMs: 20, status: 503 },
    ]);
  });

  test("honours Retry-After over the exponential guess", async () => {
    const retries: Array<{ attempt: number; delayMs: number; status: number }> = [];
    const start = performance.now();
    await withStubbedFetch(
      [() => res(429, { "retry-after": "0.02" }), () => res(200)],
      async (stub) => {
        const r = await fetchWithBackoff(
          "https://example.test/x",
          {},
          {
            retries: 1,
            baseDelayMs: 60_000, // if this were used the test would hang
            maxDelayMs: 100_000,
            onRetry: (info) => retries.push(info),
          }
        );
        assert.equal(r.status, 200);
        assert.equal(stub.attempts, 2);
      }
    );
    const elapsed = performance.now() - start;
    assert.deepEqual(retries, [{ attempt: 1, delayMs: 20, status: 429 }]);
    assert.ok(elapsed < 5000, `Retry-After was not honoured; waited ${elapsed}ms`);
  });

  test("clamps a huge Retry-After to maxDelayMs", async () => {
    const retries: Array<{ delayMs: number }> = [];
    await withStubbedFetch(
      [() => res(429, { "retry-after": "3600" }), () => res(200)],
      async () => {
        await fetchWithBackoff("https://example.test/x", {}, {
          retries: 1,
          maxDelayMs: 50,
          onRetry: (info) => retries.push(info),
        });
      }
    );
    assert.deepEqual(retries, [{ attempt: 1, delayMs: 50, status: 429 }]);
  });

  test("clamps the exponential backoff to maxDelayMs too", async () => {
    const delays: number[] = [];
    await withStubbedFetch(
      [() => res(500), () => res(500), () => res(200)],
      async () => {
        await fetchWithBackoff("https://example.test/x", {}, {
          retries: 2,
          baseDelayMs: 1000,
          maxDelayMs: 25,
          onRetry: (info) => delays.push(info.delayMs),
        });
      }
    );
    assert.deepEqual(delays, [25, 25]);
  });

  test("a network rejection propagates and is not retried", async () => {
    const boom = () => {
      throw new Error("ECONNRESET");
    };
    await withStubbedFetch([boom as unknown as () => Response], async (stub) => {
      await assert.rejects(
        () => fetchWithBackoff("https://example.test/x", {}, { baseDelayMs: 1 }),
        /ECONNRESET/
      );
      assert.equal(stub.attempts, 1, "a thrown fetch must not be retried");
    });
  });
});

describe("USER_AGENT", () => {
  test("identifies the app", () => {
    assert.match(USER_AGENT, /^ChessDad\//);
  });
});
