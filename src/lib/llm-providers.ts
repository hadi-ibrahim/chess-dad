/**
 * The LLM provider catalogue, shared by the browser and the server.
 *
 * This module is deliberately **client-safe**: it holds no secrets, imports
 * nothing server-only, and is the one place both sides agree on what a provider
 * is. The Profiles screen renders the picker from it; the server builds the HTTP
 * request from it. A user's API key is never stored here — it lives in
 * localStorage beside their profile and is passed in the body of one AI request.
 *
 * Providers are grouped into four *kinds* because that is what actually differs
 * in the wire protocol, not the brand:
 *
 *   openai     → `POST {base}/chat/completions` (OpenAI, DeepSeek, OpenRouter, …)
 *   anthropic  → `POST {base}/messages` with an `x-api-key` header
 *   google     → `POST {base}/models/{model}:generateContent`
 *   ollama     → `POST {base}/api/chat`
 *
 * Adding a model is typing its id; adding a *provider* means adding an entry here.
 */

export type ProviderId = "openai" | "anthropic" | "google" | "deepseek" | "ollama" | "custom";
export type ProviderKind = "openai" | "anthropic" | "google" | "ollama";

export interface ProviderMeta {
  id: ProviderId;
  /** Full name for the picker. */
  label: string;
  /** Terse name for chips and connection labels. */
  short: string;
  kind: ProviderKind;
  /** Used when the model field is left empty. Free text is always allowed. */
  defaultModel: string;
  /** Suggestions only — the model input accepts any id the provider has. */
  models: string[];
  /** Where the user creates a key. `null` when no key is needed. */
  keyUrl: string | null;
  keyRequired: boolean;
  /** The endpoint used when the connection does not override it. */
  defaultBaseUrl: string | null;
  /** Custom endpoints are the whole point of `custom`, so this is mandatory there. */
  baseUrlRequired: boolean;
  /** Whether the provider accepts `response_format: { type: "json_object" }`. */
  supportsJsonMode: boolean;
  /** DeepSeek only: reasoning can be switched off at the request level. */
  supportsThinkingToggle: boolean;
  /** One line shown under the picker. */
  note: string;
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: "openai",
    label: "OpenAI (GPT)",
    short: "GPT",
    kind: "openai",
    defaultModel: "gpt-6-astra",
    models: [
      "gpt-6-astra",
      "gpt-6-sol",
      "gpt-6-luna",
      "gpt-5.6-sol",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.1",
      "gpt-5",
      "gpt-5-mini",
    ],
    keyUrl: "https://platform.openai.com/api-keys",
    keyRequired: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    baseUrlRequired: false,
    supportsJsonMode: true,
    supportsThinkingToggle: false,
    note: "Keys start with sk-. The list is a hint — type any id OpenAI offers, including a newer one.",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    short: "Claude",
    kind: "anthropic",
    defaultModel: "claude-opus-5-5",
    models: [
      "claude-opus-5-5",
      "claude-fable-5-1",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
    ],
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyRequired: true,
    defaultBaseUrl: "https://api.anthropic.com/v1",
    baseUrlRequired: false,
    supportsJsonMode: false,
    supportsThinkingToggle: false,
    note: "Keys start with sk-ant-. Claude 5 has adaptive thinking, so the request omits temperature, which thinking rejects.",
  },
  {
    id: "google",
    label: "Google (Gemini)",
    short: "Gemini",
    kind: "google",
    defaultModel: "gemini-3.8-flash",
    models: [
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
    ],
    keyUrl: "https://aistudio.google.com/app/apikey",
    keyRequired: true,
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    baseUrlRequired: false,
    supportsJsonMode: true,
    supportsThinkingToggle: false,
    note: "The key is sent as a header, never in the URL. Flash models can be busy at peak times — retries are automatic, and Load models lists exactly what your key supports.",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    short: "DeepSeek",
    kind: "openai",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    keyUrl: "https://platform.deepseek.com/api_keys",
    keyRequired: true,
    defaultBaseUrl: "https://api.deepseek.com",
    baseUrlRequired: false,
    supportsJsonMode: true,
    supportsThinkingToggle: true,
    note: "Reasoning is OFF by default here: it is billed as output and can blow past any sane timeout.",
  },
  {
    id: "ollama",
    label: "Ollama (local model)",
    short: "Ollama",
    kind: "ollama",
    defaultModel: "qwen3:1.7b",
    models: ["qwen3:1.7b", "llama3.1", "qwen2.5", "gemma3"],
    keyUrl: null,
    keyRequired: false,
    defaultBaseUrl: "http://localhost:11434",
    baseUrlRequired: false,
    supportsJsonMode: true,
    supportsThinkingToggle: false,
    note: "No key. Runs on your machine (or a LAN box) — localhost and private addresses are allowed.",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    short: "Custom",
    kind: "openai",
    defaultModel: "",
    models: [],
    keyUrl: null,
    keyRequired: false,
    defaultBaseUrl: null,
    baseUrlRequired: true,
    supportsJsonMode: false,
    supportsThinkingToggle: false,
    note: "OpenRouter, Groq, Together, vLLM, LM Studio… Give the full base URL, including /v1.",
  },
];

export function providerMeta(id: string | null | undefined): ProviderMeta | null {
  if (!id) return null;
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

export function providerLabel(id: string): string {
  return providerMeta(id)?.label ?? id;
}

/** What a connection is called in a list. A user-set label always wins. */
export function connectionLabel(c: LlmConnection): string {
  const meta = providerMeta(c.provider);
  const model = (c.model || meta?.defaultModel || "").trim();
  const base = meta?.short ?? c.provider;
  const name = c.label.trim() || base;
  return model ? `${name} · ${model}` : name;
}

// ---------------------------------------------------------------------------
// Connections (what the browser stores per profile)
// ---------------------------------------------------------------------------

/** A saved provider connection. The key is part of it; nothing stores this server-side. */
export interface LlmConnection {
  /** Stable within the profile's list, so the editor can target a row. */
  id: string;
  provider: ProviderId;
  /** Optional user-facing name ("Work Claude"). Empty means "use the provider name". */
  label: string;
  /** Free text: any model id the provider currently offers. Empty means the default. */
  model: string;
  apiKey: string;
  /** Empty means the provider default. Required for `custom`. */
  baseUrl: string;
  /** DeepSeek only; off unless the user explicitly turns it on. */
  thinking: boolean;
  /**
   * Per-call timeout in ms. `0` means "use the server default". This exists
   * because a reasoning model can legitimately think for minutes, and the person
   * who chose it is the one who knows how long to wait.
   */
  timeoutMs: number;
}

/** Ten seconds is the shortest worth offering, ten minutes the longest. */
export const TIMEOUT_MIN_MS = 10_000;
export const TIMEOUT_MAX_MS = 600_000;

/** Coerce a stored or posted timeout into range; `0` means "use the default". */
export function clampTimeout(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(TIMEOUT_MAX_MS, Math.max(TIMEOUT_MIN_MS, Math.round(ms)));
}

/** One entry in a provider's model catalogue, as its list endpoint returns it. */
export interface ModelOption {
  id: string;
  /** A friendlier name, when the provider has one worth showing. */
  label?: string;
}

export function emptyConnection(provider: ProviderId = "openai", id = ""): LlmConnection {
  const meta = providerMeta(provider) ?? PROVIDERS[0];
  return {
    id: id || newConnectionId(),
    provider: meta.id,
    label: "",
    model: meta.defaultModel,
    apiKey: "",
    baseUrl: "",
    thinking: false,
    timeoutMs: 0,
  };
}

/** `crypto.randomUUID` exists in the browser and in Node 22; fall back if not. */
export function newConnectionId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Defensive read of a stored connection: a hand-edited localStorage entry, or one
 * written by an older version, is coerced into a well-formed connection rather
 * than trusted. Returns null when the provider is unknown, so junk rows disappear.
 */
export function normaliseConnection(value: unknown): LlmConnection | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const meta = providerMeta(typeof v.provider === "string" ? v.provider : null);
  if (!meta) return null;
  return {
    id: String(v.id ?? "") || newConnectionId(),
    provider: meta.id,
    label: String(v.label ?? "").slice(0, 60),
    model: String(v.model ?? "").slice(0, 120),
    apiKey: String(v.apiKey ?? "").slice(0, 400),
    baseUrl: String(v.baseUrl ?? "").slice(0, 300),
    thinking: Boolean(v.thinking),
    timeoutMs: clampTimeout(Number(v.timeoutMs) || 0),
  };
}

export function normaliseConnections(value: unknown): LlmConnection[] {
  if (!Array.isArray(value)) return [];
  return value.map(normaliseConnection).filter((c): c is LlmConnection => c !== null);
}

export type ConnectionCheck =
  | { ok: true; connection: LlmConnection }
  | { ok: false; error: string };

/**
 * Validate an untrusted connection (from a request body) and fill in defaults.
 *
 * This runs on the server before any outbound request: it is the boundary that
 * turns "whatever the browser sent" into a URL the server is willing to fetch.
 */
export function sanitizeConnection(raw: unknown): ConnectionCheck {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "No provider configuration was sent. Add one on the Profiles tab." };
  }
  const r = raw as Record<string, unknown>;
  const meta = providerMeta(typeof r.provider === "string" ? r.provider : null);
  if (!meta) return { ok: false, error: `Unknown provider: ${String(r.provider ?? "(none)")}` };

  const model = String(r.model ?? "").trim().slice(0, 120) || meta.defaultModel;
  if (!model) return { ok: false, error: `${meta.label} needs a model name.` };

  const apiKey = String(r.apiKey ?? "").trim().slice(0, 400);
  if (meta.keyRequired && !apiKey) {
    return { ok: false, error: `${meta.label} needs an API key. Add one on the Profiles tab.` };
  }

  let baseUrl = String(r.baseUrl ?? "").trim();
  if (baseUrl) {
    const checked = validateBaseUrl(baseUrl, { allowPrivate: meta.kind === "ollama" });
    if (!checked.ok) return { ok: false, error: checked.error };
    baseUrl = checked.url;
  } else if (meta.baseUrlRequired) {
    return {
      ok: false,
      error: `${meta.label} needs a base URL — for example https://openrouter.ai/api/v1.`,
    };
  } else {
    baseUrl = meta.defaultBaseUrl ?? "";
  }

  return {
    ok: true,
    connection: {
      id: String(r.id ?? "").slice(0, 80),
      provider: meta.id,
      label: String(r.label ?? "").trim().slice(0, 60),
      model,
      apiKey,
      baseUrl,
      thinking: Boolean(r.thinking),
      timeoutMs: clampTimeout(Number(r.timeoutMs) || 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Base URL policy (SSRF guard)
// ---------------------------------------------------------------------------

export interface BaseUrlOptions {
  /** Local model runners legitimately live on a private address. */
  allowPrivate?: boolean;
}

export type BaseUrlCheck = { ok: true; url: string } | { ok: false; error: string };

const METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata",
  "169.254.169.254",
  "fd00:ec2::254",
]);

function ipv4Parts(host: string): number[] | null {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null;
}

function isPrivateAddress(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "");
  if (bare === "localhost" || bare === "::1" || /^127\./.test(bare)) return true;
  const v4 = ipv4Parts(bare);
  if (v4) {
    const [a, b] = v4;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  const lower = bare.toLowerCase();
  return lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd");
}

/**
 * Decide whether the server may fetch this base URL.
 *
 * The AI request is the only place the app fetches a host that a user typed, so
 * this is the SSRF boundary. The rules are deliberately simple to reason about:
 *
 *   * https everywhere, http only for a local server;
 *   * cloud metadata endpoints are always refused;
 *   * private/loopback/link-local addresses are refused *unless* the caller
 *     opted in (Ollama, which is local by definition).
 *
 * A public hostname that resolves to a private address is not caught here —
 * blocking that needs resolution-time checks and a denylist that goes stale.
 * This app runs behind the operator's own access gate; see the OKF notes.
 */
export function validateBaseUrl(raw: string, opts: BaseUrlOptions = {}): BaseUrlCheck {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return { ok: false, error: "A base URL is required." };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "That base URL is not a valid URL." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "The base URL must start with https:// (http:// only for a local server)." };
  }

  const host = url.hostname.toLowerCase();
  if (METADATA_HOSTS.has(host)) {
    return { ok: false, error: "That host is not allowed." };
  }

  const bare = host.replace(/^\[|\]$/g, "");
  const local = bare === "localhost" || bare === "127.0.0.1" || bare === "::1" || /^127\./.test(bare);
  if (url.protocol === "http:" && !local) {
    return { ok: false, error: "http:// is only allowed for a local server. Use https:// for a remote one." };
  }
  // A local model runner is a first-class use (Ollama, LM Studio, vLLM on the same
  // box), so loopback is always allowed. Other private ranges — a LAN box, a cloud
  // metadata endpoint — are refused unless the provider opted in.
  if (isPrivateAddress(host) && !local && !opts.allowPrivate) {
    return { ok: false, error: "That address is not reachable from the public internet. Use https:// with a public host." };
  }
  return { ok: true, url: trimmed };
}

// ---------------------------------------------------------------------------
// Position identity for the AI cache
// ---------------------------------------------------------------------------

/**
 * The AI cache key.
 *
 * A FEN alone does not determine what was played from it, nor who was playing —
 * two users reaching the same position choose different moves, and the same
 * mistake is a different lesson for a 900 than for a 2100. Keying on all four
 * fields (plus provider and model) is what stops one user being served an
 * explanation written about somebody else's move.
 */
export interface AiExplanationKey {
  fen: string;
  playedUci: string;
  classification: string;
  ratingBand: number;
}

const RATING_MIN = 400;
const RATING_MAX = 2800;
const RATING_BAND = 200;

/** Round a rating to a 200-point band, so near-identical players share one call. */
export function ratingBand(rating: number): number {
  if (!Number.isFinite(rating)) return 1200;
  const clamped = Math.min(RATING_MAX, Math.max(RATING_MIN, rating));
  return Math.round(clamped / RATING_BAND) * RATING_BAND;
}

/** A canonical, collision-free string for a key, used to group rows in memory. */
export function positionKeyString(key: AiExplanationKey): string {
  return `${key.fen}\u0000${key.playedUci}\u0000${key.classification}\u0000${key.ratingBand}`;
}
