---
type: Reference
title: Weakness Definitions
description: The recurring-mistake categories ChessMentor profiles across a player's games.
tags: [weakness, profiling, insights, improvement]
status: stable
generated: { by: chessmentor/1.0, at: 2026-09-22 }
updated: { by: "process:okf-code-sync", at: 2026-09-23 }
sources:
  - id: weakness-code
    resource: src/lib/weaknesses.ts
    title: ChessMentor — computeWeaknesses() weakness profile
  - id: phase-code
    resource: src/lib/chess-core.ts
    title: ChessMentor — detectPhase() phase rule
---

# Overview

ChessMentor's value is **pattern over incident**: one blunder is noise, but the
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
  average centipawn loss.
* **Time management** — average centipawn loss on moves played with under 30
  seconds left on the clock, compared with moves played at 30 seconds or more
  (a direct comparison, not a statistical correlation).
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
