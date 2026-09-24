---
type: Playbook
title: Game Import
description: How Chess Dad fetches and parses games from Lichess and Chess.com, including rate limits, tokens, and move-format handling.
tags: [import, lichess, chesscom, api, rate-limits]
status: stable
generated: { by: chessdad/1.0, at: 2026-09-22 }
updated: { by: "process:okf-code-sync", at: 2026-09-23 }
sources:
  - id: lichess-export
    resource: https://lichess.org/api
    title: Lichess API — export games of a user
  - id: lichess-rate-limits
    resource: https://lichess.org/api
    title: Lichess API — rate limits and Retry-After
  - id: chesscom-api
    resource: https://www.chess.com/news/view/published-data-api
    title: Chess.com Published-Data API
  - id: lichess-importer-code
    resource: src/lib/importers/lichess.ts
    title: Chess Dad — Lichess fetching, throttling, and move parsing
  - id: chesscom-importer-code
    resource: src/lib/importers/chesscom.ts
    title: Chess Dad — Chess.com archives, clocks, and variant filtering
---

# Overview

An import runs as a queued `import` [job](job-queue.md) rather than inside the
HTTP request: games are fetched from the site's public API and replayed with
chess.js into per-ply positions, so every game can later be analysed and
reviewed.[^lichess-export][^chesscom-api] With `analyzeAfter`, the import also
enqueues analysis for the imported games that have moves and are not yet
analysed. `max` is clamped to 1–200 (default `MAX_GAMES_PER_SOURCE`, 100).

# Lichess

`GET /api/games/user/{username}` streams NDJSON — one game per line — filtered by
`perfType` (bullet, blitz, rapid, classical) and capped by `max`. Each game
carries both players and their ratings, the ECO code and opening name, the time
control, and the move list.

The `moves` field is space-separated and may arrive as **either** spelling:

* **UCI** — `e2e4`, `e7e8q`
* **SAN** — `Nf3`, `O-O`, `Qxd1+`

Lichess has served SAN for this field, so the importer tries UCI first and falls
back to SAN. Assuming UCI alone silently produced games with zero moves.

# Rate limits and tokens

Anonymous game exports are throttled to a few requests per minute, and the
throttle is frequently **masked as a `404`** even for accounts that exist.[^lichess-rate-limits]
The importer therefore:

* retries after a wait on both `429` (honouring `Retry-After`) and a masked `404`;
* tells "user not found" apart from throttling by checking the profile endpoint;
* rejects a bad token immediately on `401`/`403`, pointing at the token page;
* accepts a personal API token — stored per profile or from `LICHESS_TOKEN` — whose
  authenticated limits are several times higher. A supplied token is stored in
  the `settings` table, so it survives restarts without an env change.

# Chess.com

The archives endpoint lists monthly game URLs; games are read newest-first from
the most recent months until `max` is reached, skipping non-chess variants
(`rules != "chess"`). The API **requires a `User-Agent`** header and rejects
requests without one with `403`. Chess.com supplies full PGN, which is parsed
with chess.js, and `[%clk …]` annotations become clock times.

# Idempotence and repair

Games are keyed by `(source, external_id)`. Re-importing refreshes game metadata
and fills any missing positions *without* overwriting existing analysis, so a
re-import repairs games that were previously stored without moves.

[^lichess-export]: The Lichess export endpoint and its query parameters.
[^chesscom-api]: The Chess.com published-data API, including the required `User-Agent`.
[^lichess-rate-limits]: Lichess documents per-IP anonymous limits and the `Retry-After` header.
