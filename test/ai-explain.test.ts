/**
 * The AI dispatch: one position, one provider connection, one stored reading.
 *
 * These tests stub `fetch`, so they pin the exact wire shape each provider gets —
 * URL, auth header, and the body fields that matter (JSON mode, DeepSeek's
 * thinking switch) — without ever making a network call or needing a key. They
 * also pin the two refusals that protect the product: a connection error is
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
    model: "gpt-5",
    apiKey: "sk-test",
    baseUrl: "",
    thinking: false,
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
  test("OpenAI-compatible: URL, bearer auth, JSON mode and a stored row", async () => {
    responder = () =>
      json({
        choices: [{ message: { content: JSON.stringify(EXPLANATION) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

    const out = await llm.aiExplainPosition(input(), connection({ model: "gpt-4.1" }), KEY);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer sk-test");
    const body = bodyOf(calls[0]);
    assert.equal(body.model, "gpt-4.1");
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(body.temperature, 0.4);
    assert.equal(out.explanation, EXPLANATION.explanation);
    assert.equal(out.provider, "openai");
    assert.equal(out.model, "gpt-4.1");
    assert.equal(out.cached, false);

    const stored = db.getAiExplanation(KEY, "openai", "gpt-4.1");
    assert.equal(stored?.key_lesson, "Central pawns first.");
  });

  test("reasoning-class models omit temperature but still ask for JSON", async () => {
    // GPT-5/GPT-6 reject or ignore a temperature other than the default, so sending
    // it would turn a working provider into a 400.
    responder = () => json({ choices: [{ message: { content: JSON.stringify(EXPLANATION) } }] });

    const out = await llm.aiExplainPosition(input(), connection({ model: "gpt-6-astra" }), KEY);
    const body = bodyOf(calls[0]);
    assert.equal(body.model, "gpt-6-astra");
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(body.temperature, undefined);
    assert.equal(out.model, "gpt-6-astra");
  });

  test("a second call for the same provider and model is a free cache hit", async () => {
    responder = () => json({ choices: [{ message: { content: JSON.stringify(EXPLANATION) } }] });

    await llm.aiExplainPosition(input(), connection(), KEY);
    const second = await llm.aiExplainPosition(input(), connection(), KEY);

    assert.equal(calls.length, 1, "the cached answer must not call the provider again");
    assert.equal(second.cached, true);
    assert.equal(second.explanation, EXPLANATION.explanation);
  });

  test("a different model is a different call, and both readings are kept", async () => {
    responder = () => json({ choices: [{ message: { content: JSON.stringify(EXPLANATION) } }] });

    await llm.aiExplainPosition(input(), connection({ model: "gpt-5" }), KEY);
    await llm.aiExplainPosition(input(), connection({ model: "gpt-5-mini" }), KEY);

    assert.equal(calls.length, 2);
    assert.equal(db.listAiExplanationsForFens([START]).length, 2);
  });

  test("DeepSeek disables thinking unless the connection opts in", async () => {
    const deepseek = connection({ provider: "deepseek", model: "deepseek-chat", baseUrl: "" });
    responder = () => json({ choices: [{ message: { content: JSON.stringify(EXPLANATION) } }] });

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

  test("Anthropic: messages endpoint, x-api-key header, content blocks", async () => {
    responder = () =>
      json({
        content: [{ type: "text", text: JSON.stringify(EXPLANATION) }],
        usage: { input_tokens: 20, output_tokens: 8 },
      });

    const out = await llm.aiExplainPosition(
      input(),
      connection({ provider: "anthropic", model: "claude-sonnet-5" }),
      KEY
    );

    assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers["x-api-key"], "sk-test");
    assert.equal(headers["anthropic-version"], "2023-06-01");
    assert.equal(bodyOf(calls[0]).max_tokens, 1024);
    // Claude 5's adaptive thinking rejects a non-default temperature.
    assert.equal(bodyOf(calls[0]).temperature, undefined);
    assert.equal(out.model, "claude-sonnet-5");
  });

  test("Google: the key is a header and never appears in the URL", async () => {
    responder = () =>
      json({
        candidates: [{ content: { parts: [{ text: JSON.stringify(EXPLANATION) }] } }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6, totalTokenCount: 18 },
      });

    const out = await llm.aiExplainPosition(
      input(),
      connection({ provider: "google", model: "gemini-3.8-flash" }),
      KEY
    );

    assert.equal(
      calls[0].url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent"
    );
    assert.ok(!calls[0].url.includes("sk-test"), "the key must not be in the URL");
    assert.equal((calls[0].init.headers as Record<string, string>)["x-goog-api-key"], "sk-test");
    assert.equal(out.explanation, EXPLANATION.explanation);
  });

  test("Ollama: local chat endpoint, no auth, JSON format", async () => {
    responder = () => json({ message: { content: JSON.stringify(EXPLANATION) }, prompt_eval_count: 9, eval_count: 4 });

    await llm.aiExplainPosition(
      input(),
      connection({ provider: "ollama", model: "llama3.1", apiKey: "" }),
      KEY
    );

    assert.equal(calls[0].url, "http://localhost:11434/api/chat");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, undefined);
    assert.equal(bodyOf(calls[0]).format, "json");
  });

  test("a custom OpenAI-compatible endpoint uses the connection's base URL", async () => {
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
  });

  test("an answer that names an impossible move is refused and never cached", async () => {
    // White's knight is on g1 and cannot reach d5 — the exact shape of the real
    // failures the guard was written for.
    responder = () =>
      json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                explanation: "You can simply take it with Nxd5.",
                key_lesson: "k",
                drill_suggestion: "d",
              }),
            },
          },
        ],
      });

    await assert.rejects(
      () => llm.aiExplainPosition(input(), connection(), KEY),
      (e: unknown) => e instanceof llm.AiRequestError && e.kind === "content"
    );
    assert.equal(db.getAiExplanation(KEY, "openai", "gpt-5"), null);
  });

  test("an empty explanation is a content failure", async () => {
    responder = () => json({ choices: [{ message: { content: "{}" } }] });
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
    assert.equal(db.getAiExplanation(KEY, "openai", "gpt-5"), null);
  });

  test("a non-JSON success is a connection failure", async () => {
    responder = () => new Response("<html>nope</html>", { status: 200 });
    await assert.rejects(
      () => llm.aiExplainPosition(input(), connection(), KEY),
      (e: unknown) => e instanceof llm.AiRequestError && e.kind === "connection"
    );
  });
});
