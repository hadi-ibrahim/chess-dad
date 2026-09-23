---
type: Metric
title: Accuracy
description: How ChessMentor computes a per-move and per-game accuracy percentage.
tags: [accuracy, metric, analysis, evaluation]
status: stable
generated: { by: chessmentor/1.0, at: 2026-09-22 }
updated: { by: "process:okf-code-sync", at: 2026-09-23 }
sources:
  - id: lichess-accuracy
    resource: https://lichess.org/page/accuracy
    title: Lichess — Accuracy
  - id: accuracy-code
    resource: src/lib/analysis.ts
    title: ChessMentor — winProb() and moveAccuracy()
---

# Overview

Accuracy measures how closely a player's moves match the engine's optimal play,
normalized so a completely winning position cannot inflate the score. It is
computed from the change in **win probability** caused by the move.

# Computation

1. Convert the centipawn evaluation to a win probability with the logistic curve
   (centipawns are clamped to ±1000 first, so a decisive score cannot saturate
   the curve):

   ```
   win(cp) = 1 / (1 + 10^(-cp / 400))
   ```

2. A move's accuracy depends on the win probability it loses:

   ```
   accuracy = 103.1668 * exp(-0.04354 * loss) - 3.1669   (clamped 0–100)
   ```

   where `loss` is the drop in win probability, in percentage points.

3. Game accuracy is the average over the player's own moves (a checkmating move
   scores 100).[^lichess-accuracy]

[^lichess-accuracy]: The exponential accuracy formula is the one documented by
  Lichess; ChessMentor reuses it under the same open spirit.
