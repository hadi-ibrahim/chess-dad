---
type: Reference
title: Weakness Definitions
description: The recurring-mistake categories Chess Dad profiles across a player's games.
tags: [weakness, profiling, insights, improvement]
status: stable
generated: { by: chessdad/1.0, at: 2026-09-22 }
updated: { by: "process:okf-code-sync", at: 2026-09-23 }
sources:
  - id: weakness-code
    resource: src/lib/weaknesses.ts
    title: Chess Dad — computeWeaknesses() weakness profile
  - id: phase-code
    resource: src/lib/chess-core.ts
    title: Chess Dad — detectPhase() phase rule
---

# Overview

Chess Dad's value is **pattern over incident**: one blunder is noise, but the
same mistake across fifty games is a weakness worth training. Each weakness is a
category aggregated over every analyzed game.

# Weakness categories

* **Tactical motifs missed** — the tags from [Tactical motifs](tactical-motifs.md)
  (`missed-mate`, `hung-piece`, `missed-capture`, `tactical`), counted over the
  player's own blunders, mistakes, and misses; a mistake with no tag falls back
  to `positional`.
* **Phase-specific weakness** — whether mistakes cluster in the opening,
  middlegame, or endgame. A position is `opening` below ply 16, `endgame` once
  no queens remain or at most six rooks/bishops/knights are left on the board,
  and `middlegame` in between. The weakest phase is the one with the highest
  error rate (blunders + mistakes + misses per 100 moves), with median centipawn
  loss as the tiebreak. A mean would be dominated by a single missed mate, since
  mate scores are stored as ±100000 centipawns; every average here clamps a
  move's loss at 1000 cp first.
* **Time management** — median and (clamped) average centipawn loss on moves played with under 30
  seconds left on the clock, compared with moves played at 30 seconds or more
  (a direct comparison, not a statistical correlation).
* **Scope** — `GET /api/insights?window=` accepts `30`, `100`, `month` or `all`;
  every aggregate above is computed over that window, so "am I improving?" is
  answerable rather than only all-time totals. The window's game count is the
  denominator for per-game figures.
* **Opening performance** — win/draw/loss, win rate, and average game accuracy
  by ECO code, capped at the 30 most-played openings.
* **Color-specific** — games, wins, draws, and losses as White versus Black.

# How it is used

The [insights dashboard](../../src/app/insights/page.tsx) surfaces these
categories as stat cards, an accuracy trend, a recurring-motif bar chart, a
phase-performance grid, an opening-performance table, a time-management panel,
and a colour-performance panel. Each of the player's own blunders, mistakes, and
misses with an engine best move is also turned into a personal
[puzzle](spaced-repetition.md) tagged with its motif.

Phase cards therefore lead with the error rate and show the median loss, because
those two survive a mate score in the sample; the mean is shown last, clamped.
Accuracy is averaged per game, not per move — a game's accuracy is a rating, so
weighting it by move count overstated it (`accSum` ran per position row).
