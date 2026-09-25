/**
 * The provider catalogue and the boundaries that protect the AI request.
 *
 * Two things here are security-relevant and are tested as such: `validateBaseUrl`
 * is the SSRF gate on the only URL a user types, and `sanitizeConnection` is what
 * turns an untrusted request body into a connection the server will actually use.
 * `ratingBand` is correctness: it is the cache key that keeps one player's lesson
 * from being served to another.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDERS,
  connectionLabel,
  emptyConnection,
  normaliseConnection,
  normaliseConnections,
  positionKeyString,
  providerMeta,
  ratingBand,
  sanitizeConnection,
  validateBaseUrl,
  type LlmConnection,
} from "@/lib/llm-providers";

describe("provider catalogue", () => {
  test("ids are unique and every entry is complete", () => {
    const ids = PROVIDERS.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const p of PROVIDERS) {
      assert.ok(p.label && p.short, `${p.id} needs a name`);
      assert.ok(p.note, `${p.id} needs a note`);
      if (p.keyRequired) assert.ok(p.keyUrl, `${p.id} needs a key URL`);
      if (p.baseUrlRequired) assert.equal(p.defaultBaseUrl, null);
      if (p.defaultModel) assert.ok(p.defaultModel.length > 0);
    }
  });

  test("the four required brands are present, plus a local and a custom option", () => {
    for (const id of ["openai", "anthropic", "google", "deepseek", "ollama", "custom"]) {
      assert.ok(providerMeta(id), `missing provider ${id}`);
    }
    assert.equal(providerMeta("nope"), null);
    assert.equal(providerMeta(null), null);
  });

  test("emptyConnection uses the provider's default model", () => {
    const c = emptyConnection("deepseek", "fixed");
    assert.equal(c.id, "fixed");
    assert.equal(c.model, providerMeta("deepseek")!.defaultModel);
    assert.equal(c.thinking, false);
    assert.ok(emptyConnection("openai").id.length > 0);
  });

  test("connectionLabel prefers the user's name, then the model", () => {
    const base: LlmConnection = {
      id: "1",
      provider: "anthropic",
      label: "",
      model: "claude-sonnet-4-5",
      apiKey: "",
      baseUrl: "",
      thinking: false,
    };
    assert.equal(connectionLabel(base), "Claude · claude-sonnet-4-5");
    assert.equal(connectionLabel({ ...base, label: "Work Claude" }), "Work Claude · claude-sonnet-4-5");
  });

  test("normaliseConnection drops unknown providers and coerces fields", () => {
    assert.equal(normaliseConnection(null), null);
    assert.equal(normaliseConnection({ provider: "nope" }), null);
    const ok = normaliseConnection({ id: "x", provider: "openai", model: 5, apiKey: null, thinking: 1 });
    assert.equal(ok?.provider, "openai");
    assert.equal(ok?.model, "5");
    assert.equal(ok?.apiKey, "");
    assert.equal(ok?.thinking, true);
    assert.deepEqual(normaliseConnections("nope"), []);
    assert.equal(normaliseConnections([{ provider: "ollama" }]).length, 1);
  });
});

describe("ratingBand", () => {
  test("rounds to the nearest 200", () => {
    assert.equal(ratingBand(1200), 1200);
    assert.equal(ratingBand(1099), 1000);
    assert.equal(ratingBand(1100), 1200);
    assert.equal(ratingBand(1210), 1200);
    assert.equal(ratingBand(1290), 1200);
  });

  test("clamps to a sane range and tolerates garbage", () => {
    assert.equal(ratingBand(100), 400);
    assert.equal(ratingBand(4000), 2800);
    assert.equal(ratingBand(Number.NaN), 1200);
    assert.equal(ratingBand(Number.POSITIVE_INFINITY), 1200);
  });
});

describe("positionKeyString", () => {
  const key = { fen: "f", playedUci: "e2e4", classification: "blunder", ratingBand: 1200 };

  test("changes when any part of the identity changes", () => {
    const base = positionKeyString(key);
    assert.notEqual(base, positionKeyString({ ...key, fen: "g" }));
    assert.notEqual(base, positionKeyString({ ...key, playedUci: "d2d4" }));
    assert.notEqual(base, positionKeyString({ ...key, classification: "mistake" }));
    assert.notEqual(base, positionKeyString({ ...key, ratingBand: 1400 }));
  });

  test("is stable for the same key", () => {
    assert.equal(positionKeyString(key), positionKeyString({ ...key }));
  });
});

describe("sanitizeConnection", () => {
  test("rejects a missing or unknown provider", () => {
    assert.equal(sanitizeConnection(null).ok, false);
    const bad = sanitizeConnection({ provider: "not-a-provider", model: "x" });
    assert.equal(bad.ok, false);
    assert.match(bad.ok === false ? bad.error : "", /Unknown provider/);
  });

  test("fills the provider default model when none is given", () => {
    const out = sanitizeConnection({ provider: "openai", apiKey: "sk-1" });
    assert.equal(out.ok, true);
    assert.equal(out.ok === true ? out.connection.model : "", "gpt-5");
    assert.equal(out.ok === true ? out.connection.baseUrl : "", "https://api.openai.com/v1");
  });

  test("requires a key where the provider needs one", () => {
    const out = sanitizeConnection({ provider: "anthropic", model: "claude-sonnet-4-5" });
    assert.equal(out.ok, false);
    assert.match(out.ok === false ? out.error : "", /API key/);
  });

  test("a local provider needs no key and gets its default host", () => {
    const out = sanitizeConnection({ provider: "ollama", model: "llama3.1" });
    assert.equal(out.ok, true);
    assert.equal(out.ok === true ? out.connection.baseUrl : "", "http://localhost:11434");
    assert.equal(out.ok === true ? out.connection.apiKey : "", "");
  });

  test("a custom endpoint must supply a base URL and a model", () => {
    const noBase = sanitizeConnection({ provider: "custom", model: "m" });
    assert.equal(noBase.ok, false);
    const noModel = sanitizeConnection({ provider: "custom", baseUrl: "https://openrouter.ai/api/v1" });
    assert.equal(noModel.ok, false);
    const ok = sanitizeConnection({
      provider: "custom",
      model: "meta-llama/llama-3-70b",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-or-1",
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.ok === true ? ok.connection.baseUrl : "", "https://openrouter.ai/api/v1");
  });

  test("a rejected base URL fails the whole connection", () => {
    const out = sanitizeConnection({
      provider: "custom",
      model: "m",
      baseUrl: "http://169.254.169.254/latest/meta-data",
    });
    assert.equal(out.ok, false);
  });

  test("trims and caps untrusted strings", () => {
    const out = sanitizeConnection({
      provider: "openai",
      model: `  ${"m".repeat(200)}  `,
      apiKey: "  sk-1  ",
      label: "x".repeat(200),
    });
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.connection.apiKey, "sk-1");
      assert.ok(out.connection.model.length <= 120);
      assert.ok(out.connection.label.length <= 60);
    }
  });
});

describe("validateBaseUrl", () => {
  test("accepts a public https endpoint and strips a trailing slash", () => {
    assert.deepEqual(validateBaseUrl("https://api.example.com/v1/"), {
      ok: true,
      url: "https://api.example.com/v1",
    });
  });

  test("allows http only for a local server", () => {
    assert.equal(validateBaseUrl("http://localhost:11434").ok, true);
    assert.equal(validateBaseUrl("http://127.0.0.1:8080").ok, true);
    const remote = validateBaseUrl("http://api.example.com/v1");
    assert.equal(remote.ok, false);
    assert.match(remote.ok === false ? remote.error : "", /https/);
  });

  test("refuses cloud metadata endpoints", () => {
    for (const url of [
      "http://169.254.169.254/latest/meta-data",
      "https://169.254.169.254/",
      "http://metadata.google.internal/computeMetadata/v1",
    ]) {
      assert.equal(validateBaseUrl(url, { allowPrivate: true }).ok, false, url);
    }
  });

  test("refuses private addresses unless the caller opts in", () => {
    assert.equal(validateBaseUrl("https://192.168.1.10/v1").ok, false);
    assert.equal(validateBaseUrl("https://10.0.0.5/v1").ok, false);
    assert.equal(validateBaseUrl("https://192.168.1.10/v1", { allowPrivate: true }).ok, true);
  });

  test("rejects nonsense schemes and unparseable values", () => {
    assert.equal(validateBaseUrl("").ok, false);
    assert.equal(validateBaseUrl("not a url").ok, false);
    assert.equal(validateBaseUrl("ftp://example.com").ok, false);
  });
});
