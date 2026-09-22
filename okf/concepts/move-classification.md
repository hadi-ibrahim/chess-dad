---
type: Reference
title: Move Classification
description: The labels ChessMentor applies to every move, derived from centipawn loss and the engine's best move.
tags: [analysis, classification, centipawn-loss, engine]
status: stable
generated: { by: chessmentor/1.0, at: 2026-09-22 }
sources:
  - id: chesscom-review
    resource: https://www.chess.com/terms/game-review-chess
    title: Chess.com — Game Review
---

# Overview

Every move in an analyzed game is labelled by comparing the move the player
made against the engine's best move, using **centipawn loss** (how much the
move worsened the player's position, in hundredths of a pawn).[^chesscom-review]

# Labels and thresholds

| Label | Condition |
|-------|-----------|
| Book | Within opening theory (first ~12 plies) with minimal loss |
| Forced | The only legal move available |
| Best | The engine's top move |
| Brilliant | A sound material sacrifice that is the engine's best move |
| Great | Within 10 centipawns of best |
| Good | 10–50 centipawn loss |
| Inaccuracy | 50–100 centipawn loss |
| Mistake | 100–300 centipawn loss |
| Blunder | Over 300 centipawn loss |
| Miss | A forced mate or a winning tactic (≥ +2.00) was available and missed |

# Centipawn loss

For a position where side S is to move with evaluation `E_before` (from S's
perspective), and the position after S's move has evaluation `E_after` (from the
opponent's perspective), centipawn loss is:

```
cp_loss = max(0, E_before - (-E_after))
```

A move that checkmates the opponent is always classified **Best**.

[^chesscom-review]: Chess.com's Game Review uses a comparable centipawn-loss
  model to grade moves; ChessMentor's thresholds are its own open-source
  approximation, not a copy.
