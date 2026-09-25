/**
 * The logger.
 *
 * Two properties matter more than formatting: it must never throw (a logger that
 * can fail a request is worse than none), and it must never write a credential.
 * Both are tested directly, including the awkward inputs — circular objects,
 * BigInt, and nested secrets.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { log, throttle, logFields } from "@/lib/log";

const realWrite = process.stdout.write.bind(process.stdout);
let captured: string[] = [];

function capture() {
  captured = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (chunk: unknown) => {
    captured.push(String(chunk));
    return true;
  };
}

function restore() {
  (process.stdout as unknown as { write: typeof realWrite }).write = realWrite;
}

const lines = () => captured.join("").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

const originalLevel = process.env.LOG_LEVEL;

describe("log", () => {
  beforeEach(() => {
    delete process.env.LOG_LEVEL;
    capture();
  });

  afterEach(() => {
    restore();
    if (originalLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLevel;
  });

  test("writes one JSON object per line with a timestamp and level", () => {
    log.info("hello", { a: 1 });
    const [line] = lines();
    assert.equal(line.msg, "hello");
    assert.equal(line.level, "info");
    assert.equal(line.a, 1);
    assert.equal(line.service, "chessdad");
    assert.ok(!Number.isNaN(Date.parse(line.t)), "timestamp should be ISO-8601");
  });

  test("honours LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "warn";
    log.debug("no");
    log.info("no");
    log.warn("yes");
    log.error("yes");
    const msgs = lines().map((l) => l.msg);
    assert.deepEqual(msgs, ["yes", "yes"]);
  });

  test("keeps token COUNTS while redacting token credentials", () => {
    // The redaction rule matches any key containing "token", which used to swallow
    // `promptTokens` and hide the LLM cost telemetry entirely.
    log.info("llm: call", {
      promptTokens: 289,
      completionTokens: 196,
      totalTokens: 485,
      cumulativeTokens: 7280,
      inputTokens: 1,
      outputTokens: 2,
      maxTokens: 4096,
      usedTokens: 3,
      // ...while anything that could BE a credential still goes.
      token: "lip_secret",
      accessTokens: "bearer-secret",
      refreshToken: "rt-secret",
      apiKey: "sk-secret",
    });
    const [line] = lines();
    assert.equal(line.promptTokens, 289);
    assert.equal(line.completionTokens, 196);
    assert.equal(line.totalTokens, 485);
    assert.equal(line.cumulativeTokens, 7280);
    assert.equal(line.inputTokens, 1);
    assert.equal(line.outputTokens, 2);
    assert.equal(line.maxTokens, 4096);
    assert.equal(line.usedTokens, 3);
    assert.equal(line.token, "[redacted]");
    assert.equal(line.accessTokens, "[redacted]");
    assert.equal(line.refreshToken, "[redacted]");
    assert.equal(line.apiKey, "[redacted]");
    const raw = captured.join("");
    for (const secret of ["lip_secret", "bearer-secret", "rt-secret", "sk-secret"]) {
      assert.ok(!raw.includes(secret), `log leaked ${secret}`);
    }
  });

  test("child() stamps every line with extra fields", () => {
    log.child({ component: "worker", jobId: 7 }).info("started");
    const [line] = lines();
    assert.equal(line.component, "worker");
    assert.equal(line.jobId, 7);
    assert.equal(line.msg, "started");
  });

  test("serialises an Error instead of losing it to JSON", () => {
    log.error("boom", { err: new Error("kaboom") });
    const [line] = lines();
    assert.equal(line.err.name, "Error");
    assert.equal(line.err.message, "kaboom");
    assert.ok(typeof line.err.stack === "string" && line.err.stack.length > 0);
  });

  test("redacts anything whose key looks like a credential", () => {
    log.info("import", {
      lichessToken: "lip_supersecret",
      apiKey: "sk-live-123",
      Authorization: "Bearer abc",
      password: "hunter2",
      cookie: "cd_profile=xyz",
      // not a secret: must survive untouched
      tokenCount: undefined,
      username: "rooronoa",
    });
    const raw = captured.join("");
    for (const secret of ["lip_supersecret", "sk-live-123", "Bearer abc", "hunter2", "cd_profile=xyz"]) {
      assert.ok(!raw.includes(secret), `log leaked ${secret}`);
    }
    const [line] = lines();
    assert.equal(line.lichessToken, "[redacted]");
    assert.equal(line.username, "rooronoa");
  });

  test("redacts secrets nested inside objects and arrays", () => {
    log.info("nested", { accounts: [{ name: "a", token: "topsecret" }] });
    assert.ok(!captured.join("").includes("topsecret"));
  });

  test("survives circular references", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    assert.doesNotThrow(() => log.info("circular", { a }));
    assert.ok(captured.join("").includes("[circular]"));
  });

  test("survives BigInt and other awkward values", () => {
    // BigInt(10) rather than 10n: the project targets ES2017, where the literal
    // form is a compile error.
    assert.doesNotThrow(() => log.info("odd", { big: BigInt(10), fn: () => 1, sym: Symbol("s") }));
    assert.equal(lines().length, 1);
  });

  test("never throws, even if serialisation fails", () => {
    const hostile = {
      get boom(): never {
        throw new Error("getter exploded");
      },
    };
    assert.doesNotThrow(() => log.info("hostile", hostile));
  });

  test("logFields normalises deeply but bounded", () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    const out = logFields(deep) as Record<string, unknown>;
    // Beyond the depth cap the value is replaced rather than followed forever.
    assert.ok(JSON.stringify(out).includes("[depth]"));
  });
});

describe("throttle", () => {
  test("allows the first call and suppresses the next", () => {
    const key = `t-${Math.random()}`;
    assert.equal(throttle(key, 60_000), true);
    assert.equal(throttle(key, 60_000), false);
    assert.equal(throttle(key, 60_000), false);
  });

  test("separate keys are independent", () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    assert.equal(throttle(a), true);
    assert.equal(throttle(b), true);
    assert.equal(throttle(a), false);
  });

  test("allows again once the window has passed", async () => {
    const key = `w-${Math.random()}`;
    assert.equal(throttle(key, 10), true);
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(throttle(key, 10), true);
  });

  test("the key map stays bounded", () => {
    // Blew past maxKeys; must not grow without limit (the leak this codebase
    // already had once, in the library-sync throttle).
    for (let i = 0; i < 260; i++) throttle(`flood-${i}`, 60_000, 50);
    // Still functional afterwards.
    assert.equal(throttle(`after-${Math.random()}`), true);
  });
});
