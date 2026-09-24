---
type: Reference
title: Persistence
description: The local-first SQLite data model behind Chess Dad — games, positions, the analysis queue, puzzles, caches, and settings.
tags: [storage, sqlite, schema, local-first, privacy]
status: stable
generated: { by: chessdad/1.0, at: 2026-09-22 }
updated: { by: "process:okf-code-sync", at: 2026-09-23 }
sources:
  - id: schema-code
    resource: src/lib/db.ts
    title: Chess Dad — SQLite schema and data access
  - id: analysis-code
    resource: src/lib/analysis.ts
    title: Chess Dad — position writes and engine cache use
  - id: progress-code
    resource: src/lib/okf-progress.ts
    title: Chess Dad — per-user progress bundle writer
---

# Overview

Chess Dad is local-first: everything lives in a single SQLite file (Node's
built-in `node:sqlite`, WAL mode, foreign keys on) and nothing leaves the machine
except the Lichess/Chess.com reads and an optional LLM call. One file is easy to
back up, and personal game history stays private.

# Tables

| Table | Purpose |
|-------|---------|
| `games` | Imported game metadata and PGN — one row per game, unique on `(source, external_id)` |
| `positions` | One row per ply: FEN, played move, engine best move, evaluation, centipawn loss, classification, motif, phase, clock, `is_critical`, and the coaching text |
| `jobs` | The durable job queue — imports and analysis (see [Job queue](job-queue.md)) |
| `puzzles` | Personal puzzles built from your own mistakes, with SM-2 scheduling state |
| `opening_reviews` | Per-ECO review state for the opening trainer — the same simplified SM-2 fields as `puzzles` |
| `engine_cache` | FEN → engine evaluation, so repeated positions are never re-searched |
| `llm_cache` | FEN → coaching explanation, so repeated positions are never re-explained |
| `profiles` | One row per person: linked Lichess and Chess.com usernames plus a display name. Was a single pinned row before profiles. |
| `profile_secrets` | Per-profile Lichess token. Kept in its own table so a `SELECT *` on `profiles` can never serialise it. |
| `settings` | Small app-wide key/value store. No longer holds the token. |

# Profiles and scoping

Every row that represents a person's own chess is reached through a profile:

* `games.profile_id` — the owning profile. `UNIQUE(profile_id, source,
  external_id)`, not `UNIQUE(source, external_id)`: two people who played each
  other both import the same game, and the old global key let the second import
  overwrite the first player's colour, opponent and rating.
* `positions` and `puzzles` have no profile of their own — they are reached
  through `games`, so every query joins to the owning game.
* `opening_reviews` is keyed `(profile_id, eco)`; review schedules are per player.

A pre-profile database is upgraded in place on first open: the three tables that
hard-coded a single user are rebuilt, and every existing row is attributed to
profile 1, which the old schema guaranteed was the only one. Rebuilds copy ids
verbatim so `positions.game_id` and `puzzles.game_id` keep pointing at the right
games. Indexes live outside the schema statement because a rebuild drops them.

# Caching

Both caches are keyed by **FEN**. Openings and transpositions repeat constantly
across a player's games, so analysing one game frequently makes the next one
cheaper — and a shared position is only ever explained once. An engine cache
entry is only reused when it was computed at least as deep as the depth being
requested.

# Knowledge output

Aggregated user progress is written back into this bundle under
[progress](../progress/) as a per-user document, so one source of truth serves
both the app and an agent reading the bundle.
