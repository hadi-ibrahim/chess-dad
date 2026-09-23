---
type: Reference
title: Persistence
description: The local-first SQLite data model behind ChessMentor — games, positions, the analysis queue, puzzles, caches, and settings.
tags: [storage, sqlite, schema, local-first, privacy]
status: stable
generated: { by: chessmentor/1.0, at: 2026-09-22 }
updated: { by: "process:okf-code-sync", at: 2026-09-23 }
sources:
  - id: schema-code
    resource: src/lib/db.ts
    title: ChessMentor — SQLite schema and data access
  - id: analysis-code
    resource: src/lib/analysis.ts
    title: ChessMentor — position writes and engine cache use
  - id: progress-code
    resource: src/lib/okf-progress.ts
    title: ChessMentor — per-user progress bundle writer
---

# Overview

ChessMentor is local-first: everything lives in a single SQLite file (Node's
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
| `engine_cache` | FEN → engine evaluation, so repeated positions are never re-searched |
| `llm_cache` | FEN → coaching explanation, so repeated positions are never re-explained |
| `settings` | Small key/value store (for example, the Lichess token) |
| `profiles` | The linked Lichess and Chess.com usernames (single row) |

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
