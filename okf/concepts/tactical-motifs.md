---
type: Reference
title: Tactical Motifs
description: The pattern taxonomy Chess Dad uses to tag critical mistakes and personal puzzles.
tags: [tactics, motifs, puzzles, training]
status: stable
generated: { by: chessdad/1.0, at: 2026-09-22 }
updated: { by: "process:okf-code-sync", at: 2026-09-23 }
sources:
  - id: lichess-practice
    resource: https://lichess.org/practice
    title: Lichess — Practice (tactical themes)
  - id: motif-code
    resource: src/lib/analysis.ts
    title: Chess Dad — detectMotif() motif tags
---

# Overview

A **tactical motif** is a reusable attacking or winning pattern. When a move
loses a pawn's worth of evaluation or more (`cp_loss ≥ 100`), Chess Dad tags
it with the motif that best explains what was missed, so the mistake becomes a
trainable drill.[^lichess-practice] The tag is stored on the position and reused
as the personal puzzle's `theme`.

# Motif catalogue

These are the only tags the detector produces; the first that applies wins.

* **Missed mate** — the side to move had a forced mate (`mate_before > 0`).
* **Hanging piece** — the move walked a piece onto the square the opponent's
  best reply captures on.
* **Missed capture** — the engine's best move captured a piece worth at least a
  knight (3 pawns) that the player did not take.
* **Tactical** — a large loss (≥ 100 centipawns) explained by none of the above;
  the catch-all. In the weakness profile a mistake that ended up with no tag at
  all is counted under `positional`.

A position below 100 centipawns of loss with no forced mate is left untagged
(`motif` is null) and never reaches the weakness profile.

# How to train

Solve themed puzzle sets for the motif you miss most often, then replay the
exact game position and find the best move without the engine. Spaced repetition
re-serves your own missed positions until the pattern is automatic.

[^lichess-practice]: Lichess's practice module groups tactics by theme;
  Chess Dad uses its own, smaller tag set to label its own puzzles.
