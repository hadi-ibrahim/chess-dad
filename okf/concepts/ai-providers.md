---
type: Reference
title: AI Providers
description: How a profile adds its own AI coach — the provider kinds, where the key lives, the request that uses it, the cache key, and the guards that keep a model's answer honest.
tags: [ai, llm, providers, privacy, cache, profiles]
status: stable
generated: { by: chessdad/1.0, at: 2026-09-25 }
updated: { by: "process:ai-providers", at: 2026-09-25 }
sources:
  - id: provider-registry
    resource: src/lib/llm-providers.ts
    title: Chess Dad — the shared provider catalogue, connection validation and base-URL policy
  - id: llm-code
    resource: src/lib/llm.ts
    title: Chess Dad — provider dispatch, the deterministic coach, and the illegal-move guard
  - id: ai-route
    resource: src/app/api/games/[id]/ai/route.ts
    title: Chess Dad — POST /api/games/[id]/ai
  - id: ai-context
    resource: src/lib/ai-context.ts
    title: Chess Dad — the prompt input and AI cache key derived from a position
  - id: db-code
    resource: src/lib/db.ts
    title: Chess Dad — the ai_explanations table and its migration
  - id: profiles-code
    resource: src/lib/client-profiles.ts
    title: Chess Dad — where a profile's connections are stored in the browser
---

# Overview

Chess Dad's **baseline analysis is the engine's**, and it needs no key: every
critical position is explained by the deterministic coach in
[Coaching rules](coaching-rules.md), written into `positions.explanation` during
the analysis job. AI is a **second reading, on request** — it never replaces the
engine text and it is never required for the app to work.

AI is configured **per profile, in the browser**. There is no `LLM_PROVIDER` or
API-key environment variable any more: a profile owns a list of provider
connections on the [Profiles screen](profiles-screen.md), and a connection's key
travels only inside the one request that uses it. That is the same trust model as
the Lichess token, and it means a deployment holds no AI secret and carries no AI
bill.

# Provider kinds

The wire protocol, not the brand, is what the code branches on. Six providers
ship in `PROVIDERS`; adding a model is typing its id, adding a provider means
adding an entry to `src/lib/llm-providers.ts`.

| Provider | Kind | Endpoint | Auth | JSON output |
|---|---|---|---|---|
| `openai` | openai | `https://api.openai.com/v1/chat/completions` | `Authorization: Bearer` | `response_format: json_object` |
| `deepseek` | openai | `https://api.deepseek.com/chat/completions` | `Authorization: Bearer` | `response_format: json_object`; thinking **disabled** unless the connection opts in |
| `anthropic` | anthropic | `https://api.anthropic.com/v1/messages` | `x-api-key` + `anthropic-version` | none — the reply is parsed strictly |
| `google` | google | `https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse` | `x-goog-api-key` (a header, never `?key=`) | `responseMimeType: application/json` |
| `ollama` | ollama | `{base}/api/chat` (default `http://localhost:11434`) | none | `format: json` |
| `custom` | openai | `{base}/chat/completions` (base URL required) | Bearer if a key is given | none |

Model names are free text with a suggestion list, so a new model id works the day
it is released. DeepSeek reasoning is off by default for the reason recorded in
[Coaching rules](coaching-rules.md): reasoning tokens are billed as output, are
unbounded, and have blown past any sane timeout — paid for and then discarded.

# The request

`POST /api/games/[id]/ai` is the only place the app talks to a provider.

* The body carries the whole connection (provider, model, key, base URL,
  thinking) and an optional `ply`. No key is ever read from the environment, a
  cookie, or a table.
* With `ply` it explains that single position; without it, every flagged position
  in the game — the review screen's "Explain all flagged moves". The run is
  capped at **40 positions**, so one click cannot become an unbounded bill.
* It is not a queued job. A job would have to park the key between the request
  and the worker, which is exactly the thing the browser-held-key design exists
  to avoid. A game is roughly 6–8 calls, which fits in one request.
* A **connection** failure (bad key, unreachable host, rate limit, timeout) stops
  the run after the first failure when nothing has succeeded yet, because every
  remaining position would fail identically. A **content** failure (an empty
  answer, or one that names an illegal move) does not stop the run.

# Listing models

The static `models` array in the registry is only a hint for the moment before a
catalogue is loaded — a list in code goes stale the day a provider ships a new
model, and a `<datalist>` is a poor way to show a long one. The Profiles picker
therefore loads the real list with **`POST /api/llm/models`**, which takes the same
connection body as the analysis call and reads the provider's own endpoint:

| Kind | Endpoint |
|---|---|
| openai (OpenAI, DeepSeek, custom) | `{base}/models` |
| anthropic | `{base}/models?limit=100` |
| google | `{base}/models?pageSize=200`, keeping only `generateContent` entries |
| ollama | `{base}/api/tags` |

The result is de-duplicated, sorted, capped at 300, and returned as
`{ id, label? }`. The picker shows it as a filterable list, so a provider with a
hundred models is still usable, and any id can be typed by hand. The key is used
for this one call and stored nowhere; the base URL goes through the same
validation the analysis route uses, so this cannot probe a host the other route
would refuse.

# Where the answer lives

Each answer is one row in `ai_explanations`, and several rows may exist for the
same position:

```
(fen, played_uci, classification, rating_band, provider, model) -> explanation
```

* **Provider and model are part of the key**, so asking Claude and then GPT leaves
  two readings side by side. This is what the review screen's reading chips show —
  last week's Claude answer stays viewable after today's GPT one.
* **The FEN alone is not enough.** It does not say what was played from it, nor
  who was playing. The earlier FEN-only `llm_cache` served a user an explanation
  written about somebody else's move; that table is retired, and its AI rows are
  migrated into `ai_explanations` on first open (matched to the position by FEN)
  before it is dropped.
* **`rating_band`** is the mover's rating rounded to 200 points (clamped 400–2800),
  keeping the lesson calibrated without making every rating a distinct row.
* A cache hit for the same provider and model is returned without a call, so
  re-running a provider is free. This is the cost model: a position is paid for
  once *per model*, not once per user.
* The engine coach is **not cached** — it is pure and offline, so it is simply
  recomputed.

# Guards

* **Engine-first.** The model only explains engine data. It is told never to
  contradict the evaluation or best move.
* **Illegal-move guard.** Generated text that names a move not legal in the
  position (or immediately after the played or engine move) is **discarded**, not
  shown and not cached, and the engine read stays. Measured on real output,
  roughly one in seven explanations that named a move named an impossible one.
* **Timeout.** One provider call is capped by `LLM_TIMEOUT_MS` — 120s by default,
  because a reasoning model can legitimately think for that long — and abandoned
  past it. A connection may override it per provider (Profiles → Timeout, 10–600s),
  which is the knob for a model that is slower than the default. The call is
  **streamed** from the provider (SSE for the OpenAI kind, Anthropic and Gemini;
  NDJSON for Ollama) so a long generation is not indistinguishable from a dead
  connection; an arbitrary `custom` endpoint, which cannot be assumed to support
  streaming, stays a single request. A whole request has a second bound:
  `LLM_BATCH_BUDGET_MS` (9 minutes), after which the route stops starting new calls
  and returns the readings it already has, so a slow model yields partial results
  instead of a killed request. Re-running resumes for free, because every position
  already explained is cached.
* **No `temperature` for reasoning models.** It is omitted for the o-series,
  GPT-5/GPT-6, `gpt-chat-latest`, `deepseek-reasoner`, and for Anthropic
  entirely: reasoning-class endpoints reject or ignore a non-default value, and
  Claude 5's adaptive thinking is always on. Omitting it only gives up sampling
  control, which this coach does not need.
* **Key hygiene.** A key is sent in an HTTP header or body, never a URL, is
  redacted out of any provider error text before it is shown, and is never
  logged (the logger scrubs credential-shaped fields).
* **Base-URL policy (SSRF).** The base URL is the only URL a user types, so
  `validateBaseUrl()` requires `https` (http only for a local server), refuses
  cloud metadata endpoints, and refuses private addresses unless the provider
  opted in (`ollama`, which is local by definition).

# Known limits

* **A public hostname that resolves to a private address is not blocked.** That
  needs resolution-time checks and a denylist that goes stale. The app assumes it
  runs behind the operator's access gate; see
  [Operations](operations.md) and the repository's production notes.
* **Toggling DeepSeek reasoning does not invalidate a cached answer**, because the
  key is provider+model and not the request options. `deepseek-reasoner` is a
  separate model id and therefore a separate reading.
* **AI text is shared globally**, like the engine analysis it comments on: two
  accounts that reach the same position with the same move share one reading per
  model. The keys are not shared — only the prose.
* **A provider's own retention policy applies** to whatever position it is sent.
  The app sends engine facts (FEN, moves, evaluations, ratings) and no personal
  data.
