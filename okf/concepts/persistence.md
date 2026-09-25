---
type: Reference
title: Persistence
description: The local-first SQLite data model behind Chess Dad — the global game library, the account links that make it personal, the analysis queue, puzzles, caches, and the sessions that are never written down.
tags: [storage, sqlite, schema, local-first, privacy, identity]
status: stable
generated: { by: chessdad/1.0, at: 2026-09-22 }
updated: { by: "process:ai-providers", at: 2026-09-25 }
sources:
  - id: schema-code
    resource: src/lib/db.ts
    title: Chess Dad — SQLite schema, library view, and migration
  - id: analysis-code
    resource: src/lib/analysis.ts
    title: Chess Dad — position writes and engine cache use
  - id: progress-code
    resource: src/lib/okf-progress.ts
    title: Chess Dad — per-account progress bundle writer
  - id: identity-code
    resource: src/lib/identity.ts
    title: Chess Dad — reading the acting profile out of the browser cookie
  - id: session-code
    resource: src/lib/session.ts
    title: Chess Dad — the in-memory token session
---

# Overview

Chess Dad is local-first: everything lives in a single SQLite file (Node's
built-in `node:sqlite`, WAL mode, foreign keys on) and nothing leaves the machine
except the Lichess/Chess.com reads and an optional AI call to a provider the user
configured. One file is easy to back up, and personal game history stays private.

It is also **identity-free**. There is no user, account or profile table: the
browser carries its own profile, and the database only ever records public chess
facts — which account played which game. That is what makes the app safe to
publish without an auth system to get wrong.

# Tables

| Table | Purpose |
|-------|---------|
| `games` | A real game, whoever imported it — metadata and PGN, unique on `(source, external_id)`, with `analyzed` and per-side `accuracy_white`/`accuracy_black` |
| `library` | The only personal table for games: `(scope, game_id, player_color)`, where `scope` is an account such as `lichess:rooronoa` |
| `positions` | One row per ply: FEN, played move, engine best move, evaluation, centipawn loss, classification, motif, phase, clock, `is_critical`, and the coaching text. Reachable only through its game, so it is shared by everyone who holds that game |
| `jobs` | The durable job queue — engine analysis, and nothing else (see [Job queue](job-queue.md)) |
| `puzzles` | Drills derived from both sides' mistakes, each tagged with the `color` whose move it was. Global, like the analysis it comes from |
| `puzzle_reviews` | Per-account SM-2 state for a drill — `(scope, puzzle_id)`. Practising is personal even when the drill is shared |
| `opening_reviews` | Per-account review state for the opening trainer, keyed `(scope, eco)` |
| `engine_cache` | FEN → engine evaluation, so repeated positions are never re-searched |
| `ai_explanations` | An AI-written reading of one position, keyed by `(fen, played_uci, classification, rating_band, provider, model)`. Several rows may exist for one position — that is how a user compares providers |
| `settings` | Small app-wide key/value store. Holds no token |

# Library and identity

The chess is global and the person is a preference:

* `games` is keyed `UNIQUE(source, external_id)`. Two people who played each other
  share **one row and one analysis**; importing the same game from the other side
  adds a library link, not a duplicate engine run.
* `library` says which account holds a game and which seat they had. Its key is
  the account (`lichess:rooronoa`), not a profile row — so a second browser that
  sets up the same account is instantly holding the same library, already
  analysed. Nothing is re-fetched and nothing is re-run.
* `library_games` is a **view** joining the two, presenting the per-viewer shape
  the app reads everywhere: the viewer's `player_color`, `opponent`,
  `player_rating`, `opponent_rating` and `accuracy`, plus every column of the game
  itself. Perspective is never stored, only derived, so it cannot drift.
* `positions` and `puzzles` have no owner at all — they hang off the game.
* `puzzle_reviews` and `opening_reviews` are keyed by account, so a schedule
  follows the person between browsers rather than living in one of them.

Accounts are attached to games in two ways: an import links what it fetches, and
`linkAccountGames()` links anything already stored that the account appears in
(by matching the white/black names). The second is why setting up an existing
account in a new browser is instant.

# Migration

A database from the per-profile era is upgraded in place on first open: every game
is re-filed under the account derived from its own row (the seat `player_color`
says was the importer's), duplicates of the same `(source, external_id)` collapse
into the copy with the most analysed positions, puzzle schedules move to
`puzzle_reviews` under the owning account's scope, and `profiles` and
`profile_secrets` are dropped. Surviving game ids are preserved, and indexes live
outside the schema statement because a rebuild drops them.

# Nothing secret is stored

A Lichess token is the one secret the app handles for imports, and it never
reaches the server to be stored. It lives in the browser's `localStorage`
alongside the profile, and travels exactly once per import — posted with the
request, used for a single `Authorization` header, and gone when the response is
written. There is no session table, no session map and no cookie holding it.

AI provider keys follow the same rule. A profile's connections (provider, model,
endpoint, key) are part of the browser-owned profile object, and a key is sent
only in the body of the one AI request that uses it. The server has no provider,
model or key of its own — `config` holds no LLM values — so there is nothing to
leak from a deployment and no operator bill attached to a user's request. The
`cd_profile` cookie whitelists four public fields, so a key cannot ride along in
it. See [AI providers](ai-providers.md).

That also means a token or key survives a restart or a redeploy, because the
browser is the one keeping it, and no server-side compromise can yield one. The
deployment may still supply its own `LICHESS_TOKEN` for a headless install; that
one belongs to the operator rather than to a user. See [Game import](game-import.md).

# Caching

`engine_cache` is keyed by **FEN**, and an entry is reused only when it was
computed at least as deep as the depth being requested. Openings and
transpositions repeat across games — and across people, since the library is
shared — so analysing one game frequently makes the next one cheaper.

The deterministic coach is **not** cached at all: it is pure, offline and free,
so it is recomputed from the engine data on every analysis. `ai_explanations` is
keyed by the whole position identity — the FEN, the move played from it, the
classification, a 200-point rating band, and the provider and model. A FEN alone
does not say what was played or who was playing, so the earlier FEN-only cache
served users explanations written about somebody else's move. Per model, a
position is paid for once: asking the same model again is free, and asking a
different one is a fresh call whose answer is kept beside the first.

# Knowledge output

Aggregated progress is written back into this bundle under
[progress](../progress/) as a per-**account** document (`lichess:rooronoa` →
`progress/rooronoa.md`), so one source of truth serves both the app and an agent
reading the bundle.
