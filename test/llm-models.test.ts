/**
 * The provider model catalogue.
 *
 * Four wire kinds answer four different shapes, and the Profiles picker depends on
 * all of them being normalized the same way. These tests stub `fetch`, so they pin
 * the URL, the auth header and the parsing without a network call or a key.
 */
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { listProviderModels } from "@/lib/llm-models";
import type { LlmConnection } from "@/lib/llm-providers";

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

function connection(overrides: Partial<LlmConnection> = {}): LlmConnection {
  return {
    id: "c1",
    provider: "openai",
    label: "",
    model: "gpt-6-astra",
    apiKey: "sk-test",
    baseUrl: "",
    thinking: false,
    ...overrides,
  };
}

function headersOf(call: { init: RequestInit }): Record<string, string> {
  return (call.init.headers ?? {}) as Record<string, string>;
}

beforeEach(installFetch);
after(() => {
  globalThis.fetch = realFetch;
});

describe("listProviderModels", () => {
  test("OpenAI-compatible: GET /models with bearer auth, parsed and sorted", async () => {
    responder = () =>
      json({ data: [{ id: "gpt-6-sol" }, { id: "gpt-6-astra" }, { id: "gpt-6-astra" }, {}] });

    const out = await listProviderModels(connection());

    assert.equal(calls[0].url, "https://api.openai.com/v1/models");
    assert.equal(headersOf(calls[0]).Authorization, "Bearer sk-test");
    assert.deepEqual(
      out.map((m) => m.id),
      ["gpt-6-astra", "gpt-6-sol"]
    );
  });

  test("DeepSeek uses its own base and the same shape", async () => {
    responder = () => json({ data: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }] });
    await listProviderModels(connection({ provider: "deepseek", model: "deepseek-chat" }));
    assert.equal(calls[0].url, "https://api.deepseek.com/models");
  });

  test("a custom endpoint lists from the connection's base URL", async () => {
    responder = () => json({ data: [{ id: "meta-llama/llama-3-70b" }] });
    await listProviderModels(
      connection({ provider: "custom", model: "m", baseUrl: "https://openrouter.ai/api/v1" })
    );
    assert.equal(calls[0].url, "https://openrouter.ai/api/v1/models");
  });

  test("Anthropic: /models?limit=100 with the version header, display names kept", async () => {
    responder = () =>
      json({
        data: [
          { id: "claude-sonnet-5", display_name: "Claude Sonnet 5" },
          { id: "claude-opus-5-5", display_name: "Claude Opus 5.5" },
        ],
      });

    const out = await listProviderModels(connection({ provider: "anthropic", model: "claude-opus-5-5" }));

    assert.equal(calls[0].url, "https://api.anthropic.com/v1/models?limit=100");
    const headers = headersOf(calls[0]);
    assert.equal(headers["x-api-key"], "sk-test");
    assert.equal(headers["anthropic-version"], "2023-06-01");
    assert.deepEqual(out, [
      { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    ]);
  });

  test("Google: strips the models/ prefix and keeps only generateContent models", async () => {
    responder = () =>
      json({
        models: [
          {
            name: "models/gemini-3.8-flash",
            displayName: "Gemini 3.8 Flash",
            supportedGenerationMethods: ["generateContent"],
          },
          { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
          // No capability list at all: keep it rather than hide a usable model.
          { name: "models/gemini-3.1-pro", displayName: "Gemini 3.1 Pro" },
        ],
      });

    const out = await listProviderModels(connection({ provider: "google", model: "gemini-3.8-flash" }));

    assert.equal(
      calls[0].url,
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200"
    );
    assert.equal(headersOf(calls[0])["x-goog-api-key"], "sk-test");
    assert.deepEqual(
      out.map((m) => m.id),
      ["gemini-3.1-pro", "gemini-3.8-flash"]
    );
  });

  test("Ollama: /api/tags with no auth", async () => {
    responder = () => json({ models: [{ name: "llama3.1" }, { model: "qwen2.5" }] });
    const out = await listProviderModels(
      connection({ provider: "ollama", model: "llama3.1", apiKey: "" })
    );
    assert.equal(calls[0].url, "http://localhost:11434/api/tags");
    assert.equal(headersOf(calls[0]).Authorization, undefined);
    assert.deepEqual(
      out.map((m) => m.id),
      ["llama3.1", "qwen2.5"]
    );
  });

  test("a provider error surfaces and the key is redacted", async () => {
    responder = () => new Response("invalid key sk-test", { status: 401 });
    await assert.rejects(
      () => listProviderModels(connection()),
      (e: unknown) =>
        e instanceof Error &&
        e.message.includes("401") &&
        !e.message.includes("sk-test") &&
        e.message.includes("[redacted]")
    );
  });

  test("a non-JSON success is reported rather than crashing", async () => {
    responder = () => new Response("<html>nope</html>", { status: 200 });
    await assert.rejects(() => listProviderModels(connection()), /not JSON/);
  });
});
