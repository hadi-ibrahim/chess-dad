---
type: Reference
title: Persistence
description: The local-first SQLite data model behind ChessMentor — games, positions, the analysis queue, puzzles, caches, and settings.
tags: [storage, sqlite, schema, local-first, privacy]
status: stable
generated: { by: chessmentor/1.0, at: 2026-09-22 }
---

# Overview

ChessMentor is local-first: everything lives in a single SQLite file (Node's
built-in `node:sqlite`, WAL mode) and nothing leaves the machine except the
Lichess/Chess.com reads and an optional LLM call. One file is easy to back up,
and personal game history stays private.

# Tables

| Table | Purpose |
|-------|---------|
| `games` | Imported game metadata and PGN — one row per game |
| `positions` | One row per ply: FEN, played move, engine best move, evaluation, centipawn loss, classification, motif, phase, clock |
| `analysis_jobs` | The durable analysis queue (see [Analysis queue](analysis-queue.md)) |
| `puzzles` | Personal puzzles built from your own mistakes, with SM-2 scheduling state |
| `engine_cache` | FEN → engine evaluation, so repeated positions are never re-searched |
| `llm_cache` | FEN → coaching explanation, so repeated positions are never re-explained |
| `settings` | Small key/value store (for example, the Lichess token) |
| `profiles` | The linked Lichess and Chess.com usernames |

# Caching

Both caches are keyed by **FEN**. Openings and transpositions repeat constantly
across a player's games, so analysing one game frequently makes the next one
cheaper — and a shared position is only ever explained once.

# Knowledge output

Aggregated user progress is written back into this bundle under
[progress](../progress/) as a per-user document, so one source of truth serves
both the app and an agent reading the bundle.
