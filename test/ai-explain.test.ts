/**
 * The AI dispatch: one position, one provider connection, one stored reading.
 *
 * These tests stub `fetch`, so they pin the exact wire shape each provider gets —
 * URL, auth header, and the body fields that matter (streaming, JSON mode,
 * DeepSeek's thinking switch) — without ever making a network call or needing a
 * key. The provider replies are real SSE / NDJSON streams, because that is what
 * the app now reads: a long generation must not look like a dead connection.
 *
 * They also pin the two refusals that protect the product: a connection error is
 * surfaced rather than swallowed, and an answer that names an impossible move is
 * discarded instead of cached.
 */
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createTempDatabase, removeTempDatabase, loadDb } from "./helpers/db";
import type { ExplainInput } from "@/lib/llm";
import type { LlmConnection } from "@/lib/llm-providers";

const tmp = createTempDatabase("ai");
const db = await loadDb();
const llm = await import("@/lib/llm");

const realFetch = globalThis.fetch;
let calls: { url: string; init: RequestInit }[] = [];
let responder: (url: string, init: RequestInit) => Response;

function installFetch(): void {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? {} });
    return responder(url, init ?? {});
  }) as unknown as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stream(text: string, contentType: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": contentType } });
}

/** An OpenAI/Anthropic/Gemini style SSE stream. */
function sse(events: unknown[]): Response {
  return stream(
    events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n",
    "text/event-stream"
  );
}

/** Ollama's newline-delimited JSON stream. */
function ndjson(events: unknown[]): Response {
  return stream(events.map((e) => `${JSON.stringify(e)}\n`).join(""), "application/x-ndjson");
}

/** A legal explanation: e4 and d4 are both playable in the starting position. */
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const EXPLANATION = {
  explanation: "You played e4. The engine preferred d4 instead of e4.",
  key_lesson: "Central pawns first.",
  drill_suggestion: "Play 10 queen's pawn openings.",
};

function input(overrides: Partial<ExplainInput> = {}): ExplainInput {
  return {
    fen: START,
    playedSan: "e4",
    bestSan: "d4",
    evalBeforeCp: 20,
    evalAfterCp: -10,
    classification: "inaccuracy",
    motif: null,
    openingName: "Test",
    rating: 1200,
    ...overrides,
  };
}

const KEY = { fen: START, playedUci: "e2e4", classification: "inaccuracy", ratingBand: 1200 };

function connection(overrides: Partial<LlmConnection> = {}): LlmConnection {
  return {
    id: "c1",
    provider: "openai",
    label: "",
    model: "gpt-6-astra",
    apiKey: "sk-test",
    baseUrl: "",
    thinking: false,
    timeoutMs: 0,
    ...overrides,
  };
}

function bodyOf(call: { init: RequestInit }): Record<string, unknown> {
  return JSON.parse(String(call.init.body ?? "{}")) as Record<string, unknown>;
}

beforeEach(() => {
  db.getDb().exec("DELETE FROM ai_explanations");
  installFetch();
});

after(() => {
  globalThis.fetch = realFetch;
  removeTempDatabase(tmp.dir);
});

describe("aiExplainPosition", () => {
  test("OpenAI-compatible: streams from /chat/completions and stores the row", async () => {
    responder = () =>
      sse([
        { choices: [{ delta: { content: JSON.stringify(EXPLANATION) } }] },
        { choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
      ]);

    const out = await llm.aiExplainPosition(input(), connection({ model: "gpt-4.1" }), KEY);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer sk-test");
    const body = bodyOf(calls[0]);
    assert.equal(body.model, "gpt-4.1");
    assert.equal(body.stream, true);
    assert.deepEqual(body.stream_options, { include_usage: true });
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(body.temperature, 0.4);
    assert.equal(out.explanation, EXPLANATION.explanation);
    assert.equal(out.provider, "openai");
    assert.equal(out.model, "gpt-4.1");
    assert.equal(out.cached, false);

    const stored = db.getAiExplanation(KEY, "openai", "gpt-4.1");
    assert.equal(stored?.key_lesson, "Central pawns first.");
  });

  test("an explanation split across several deltas is reassembled", async () => {
    const text = JSON.stringify(EXPLANATION);
    const half = Math.floor(text.length / 2);
    responder = () =>
      sse([
        { choices: [{ delta: { content: text.slice(0, half) } }] },
        { choices: [{ delta: { content: text.slice(half) } }] },
      ]);

    const out = await llm.aiExplainPosition(input(), connection(), KEY);
    assert.equal(out.explanation, EXPLANATION.explanation);
  });

  test("reasoning-class models omit temperature but still ask for JSON", async () => {
    // GPT-5/GPT-6 reject or ignore a temperature other than the default, so sending
    // it would turn a working provider into a 400.
    responder = () => sse([{ choices: [{ delta: { content: JSON.stringify(EXPLANATION) } }] }]);

    const out = await llm.aiExplainPosition(input(), connection({ model: "gpt-6-astra" }), KEY);
    const body = bodyOf(calls[0]);
    assert.equal(body.model, "gpt-6-astra");
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(body.temperature, undefined);
    assert.equal(out.model, "gpt-6-astra");
  });

  test("a second call for the same provider and model is a free cache hit", async () => {
    responder = () => sse([{ choices: [{ delta: { content: JSON.stringify(EXPLANATION) } }] }]);

    await llm.aiExplainPosition(input(), connection(), KEY);
    const second = await llm.aiExplainPosition(input(), connection(), KEY);

    assert.equal(calls.length, 1, "the cached answer must not call the provider again");
    assert.equal(second.cached, true);
    assert.equal(second.explanation, EXPLANATION.explanation);
  });

  test("a different model is a different call, and both readings are kept", async () => {
    responder = () => sse([{ choices: [{ delta: { content: JSON.stringify(EXPLANATION) } }] }]);

    await llm.aiExplainPosition(input(), connection({ model: "gpt-6-astra" }), KEY);
    await llm.aiExplainPosition(input(), connection({ model: "gpt-6-sol" }), KEY);

    assert.equal(calls.length, 2);
    assert.equal(db.listAiExplanationsForFens([START]).length, 2);
  });

  test("DeepSeek disables thinking unless the connection opts in", async () => {
    const deepseek = connection({ provider: "deepseek", model: "deepseek-chat", baseUrl: "" });
    responder = () => sse([{ choices: [{ delta: { content: JSON.stringify(EXPLANATION) } }] }]);

    await llm.aiExplainPosition(input(), deepseek, KEY);
    assert.equal(calls[0].url, "https://api.deepseek.com/chat/completions");
    assert.deepEqual(bodyOf(calls[0]).thinking, { type: "disabled" });

    // Clear the cache first: the reading is keyed by provider+model, so the second
    // call would otherwise be a (correct) free cache hit rather than a new request.
    db.getDb().exec("DELETE FROM ai_explanations");
    calls = [];
    await llm.aiExplainPosition(input(), { ...deepseek, thinking: true }, KEY);
    assert.equal(bodyOf(calls[0]).thinking, undefined);
    assert.equal(bodyOf(calls[0]).temperature, undefined, "thinking ignores temperature");
  });

  test("Anthropic: streams messages, x-api-key header, content deltas", async () => {
    responder = () =>
      sse([
        { type: "message_start", message: { usage: { input_tokens: 20 } } },
        { type: "content_block_delta", delta: { text: JSON.stringify(EXPLANATION) } },
        { type: "message_delta", usage: { output_tokens: 8 } },
      ]);

    const out = await llm.aiExplainPosition(
      input(),
      connection({ provider: "anthropic", model: "claude-sonnet-5" }),
      KEY
    );

    assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers["x-api-key"], "sk-test");
    assert.equal(headers["anthropic-version"], "2023-06-01");
    // Generous on purpose: adaptive thinking is billed against max_tokens, and at
    // 1024 a real position was cut off before it wrote anything.
    assert.equal(bodyOf(calls[0]).max_tokens, 8192);
    assert.equal(bodyOf(calls[0]).stream, true);
    assert.deepEqual(bodyOf(calls[0]).output_config, { effort: "low" });
    // Claude 5's adaptive thinking rejects a non-default temperature.
    assert.equal(bodyOf(calls[0]).temperature, undefined);
    assert.equal(out.model, "claude-sonnet-5");
    assert.equal(out.explanation, EXPLANATION.explanation);
  });

  test("Anthropic: effort is only sent to the families that accept it", async () => {
    // Haiku 4.5 rejects output_config.effort with a 400.
    responder = () =>
      sse([{ type: "content_block_delta", delta: { text: JSON.stringify(EXPLANATION) } }]);

    await llm.aiExplainPosition(
      input(),
      connection({ provider: "anthropic", model: "claude-opus-5-5" }),
      KEY
    );
    assert.deepEqual(bodyOf(calls[0]).output_config, { effort: "low" });

    db.getDb().exec("DELETE FROM ai_explanations");
    calls = [];
    await llm.aiExplainPosition(
      input(),
      connection({ provider: "anthropic", model: "claude-haiku-4-5-20251001" }),
      KEY
    );
    assert.equal(bodyOf(calls[0]).output_config, undefined);
  });

  test("a JSON reply wrapped in a markdown fence is still parsed", async () => {
    // Claude often fences its JSON; showing the fence and the field names instead
    // of a lesson is what the parser must not do.
    responder = () =>
      sse([
        { type: "content_block_delta", delta: { text: "```json\n" } },
        { type: "content_block_delta", delta: { text: JSON.stringify(EXPLANATION) } },
        { type: "content_block_delta", delta: { text: "\n```" } },
      ]);

    const out = await llm.aiExplainPosition(
      input(),
      connection({ provider: "anthropic", model: "claude-opus-5-5" }),
      KEY
    );
    assert.equal(out.explanation, EXPLANATION.explanation);
    assert.equal(out.key_lesson, "Central pawns first.");
  });

  test("an answer lost to the output budget says so instead of 'no explanation'", async () => {
    responder = () =>
      sse([
        { type: "content_block_delta", delta: { thinking: "long silent reasoning" } },
        {
          type: "message_delta",
          delta: { stop_reason: "max_tokens" },
          usage: { output_tokens: 8192 },
        },
      ]);

    await assert.rejects(
      () =>
        llm.aiExplainPosition(
          input(),
          connection({ provider: "anthropic", model: "claude-opus-5-5" }),
          KEY
        ),
      (e: unknown) => e instanceof llm.AiRequestError && /output budget/.test(e.message)
    );
    assert.equal(db.getAiExplanation(KEY, "anthropic", "claude-opus-5-5"), null);
  });

  test("Google: streams via streamGenerateContent and never puts the key in the URL", async () => {
    responder = () =>
      sse([
        { candidates: [{ content: { parts: [{ text: JSON.stringify(EXPLANATION) }] } }] },
        {
          usageMetadata: {
            promptTokenCount: 12,
            candidatesTokenCount: 6,
            totalTokenCount: 18,
          },
        },
      ]);

    const out = await llm.aiExplainPosition(
      input(),
      connection({ provider: "google", model: "gemini-3.8-flash" }),
      KEY
    );

    assert.equal(
      calls[0].url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse"
    );
    assert.ok(!calls[0].url.includes("sk-test"), "the key must not be in the URL");
    assert.equal((calls[0].init.headers as Record<string, string>)["x-goog-api-key"], "sk-test");
    assert.equal(out.explanation, EXPLANATION.explanation);
  });

  test("Ollama: streams NDJSON from /api/chat with no auth", async () => {
    responder = () =>
      ndjson([
        { message: { content: JSON.stringify(EXPLANATION) }, done: false },
        { done: true, prompt_eval_count: 9, eval_count: 4 },
      ]);

    await llm.aiExplainPosition(
      input(),
      connection({ provider: "ollama", model: "llama3.1", apiKey: "" }),
      KEY
    );

    assert.equal(calls[0].url, "http://localhost:11434/api/chat");
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, undefined);
    assert.equal(bodyOf(calls[0]).format, "json");
    assert.equal(bodyOf(calls[0]).stream, true);
  });

  test("a custom endpoint stays a single request and uses its base URL", async () => {
    // The one endpoint we cannot assume supports streaming.
    responder = () => json({ choices: [{ message: { content: JSON.stringify(EXPLANATION) } }] });

    await llm.aiExplainPosition(
      input(),
      connection({
        provider: "custom",
        model: "meta-llama/llama-3-70b",
        baseUrl: "https://openrouter.ai/api/v1",
      }),
      KEY
    );

    assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(bodyOf(calls[0]).stream, undefined);
  });

  test("an answer that names an impossible move is refused and never cached", async () => {
    // White's knight is on g1 and cannot reach d5 — the exact shape of the real
    // failures the guard was written for.
    responder = () =>
      sse([
        {
          choices: [
            {
              delta: {
                content: JSON.stringify({
                  explanation: "You can simply take it with Nxd5.",
                  key_lesson: "k",
                  drill_suggestion: "d",
                }),
              },
            },
          ],
        },
      ]);

    await assert.rejects(
      () => llm.aiExplainPosition(input(), connection(), KEY),
      (e: unknown) => e instanceof llm.AiRequestError && e.kind === "content"
    );
    assert.equal(db.getAiExplanation(KEY, "openai", "gpt-6-astra"), null);
  });

  test("an empty explanation is a content failure", async () => {
    responder = () => sse([{ choices: [{ delta: { content: "{}" } }] }]);
    await assert.rejects(
      () => llm.aiExplainPosition(input(), connection(), KEY),
      (e: unknown) => e instanceof llm.AiRequestError && e.kind === "content"
    );
  });

  test("a provider error is a connection failure and the key is redacted from it", async () => {
    responder = () => new Response("bad key sk-test rejected", { status: 401 });

    await assert.rejects(
      () => llm.aiExplainPosition(input(), connection(), KEY),
      (e: unknown) =>
        e instanceof llm.AiRequestError &&
        e.kind === "connection" &&
        e.message.includes("401") &&
        !e.message.includes("sk-test") &&
        e.message.includes("[redacted]")
    );
    assert.equal(db.getAiExplanation(KEY, "openai", "gpt-6-astra"), null);
  });

  test("a transient 503 is retried instead of failing the explanation", async () => {
    // "This model is currently experiencing high demand" is what Gemini returns at
    // peak; one retry is usually enough and failing the whole reading is not.
    let attempt = 0;
    responder = () => {
      attempt += 1;
      return attempt === 1
        ? new Response("high demand", { status: 503 })
        : sse([{ choices: [{ delta: { content: JSON.stringify(EXPLANATION) } }] }]);
    };

    const out = await llm.aiExplainPosition(input(), connection(), KEY);

    assert.equal(calls.length, 2);
    assert.equal(out.explanation, EXPLANATION.explanation);
    assert.equal(out.cached, false);
  });

  test("a permanent error is surfaced on the first attempt, not retried", async () => {
    // An unknown model id or a bad key would fail identically every time.
    responder = () =>
      new Response(JSON.stringify({ error: { code: 404, message: "model not found" } }), {
        status: 404,
      });

    await assert.rejects(
      () =>
        llm.aiExplainPosition(
          input(),
          connection({ provider: "google", model: "gemini-nope" }),
          KEY
        ),
      (e: unknown) =>
        e instanceof llm.AiRequestError &&
        e.kind === "connection" &&
        /404/.test(e.message) &&
        /Load models/.test(e.message)
    );
    assert.equal(calls.length, 1);
  });

  test("a non-JSON success from a one-shot endpoint is a connection failure", async () => {
    responder = () => new Response("<html>nope</html>", { status: 200 });
    await assert.rejects(
      () =>
        llm.aiExplainPosition(
          input(),
          connection({ provider: "custom", model: "m", baseUrl: "https://example.com/v1" }),
          KEY
        ),
      (e: unknown) => e instanceof llm.AiRequestError && e.kind === "connection"
    );
  });
});
