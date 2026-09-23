---
type: Reference
title: Move Classification
description: The labels ChessMentor applies to every move, derived from centipawn loss and the engine's best move.
tags: [analysis, classification, centipawn-loss, engine]
status: stable
generated: { by: chessmentor/1.0, at: 2026-09-22 }
updated: { by: "process:okf-code-sync", at: 2026-09-23 }
sources:
  - id: chesscom-review
    resource: https://www.chess.com/terms/game-review-chess
    title: Chess.com — Game Review
  - id: classification-code
    resource: src/lib/analysis.ts
    title: ChessMentor — classifyMove() thresholds and centipawn loss
  - id: classification-glyphs
    resource: src/components/colors.ts
    title: ChessMentor — review-UI classification colours and glyphs
---

# Overview

Every move in an analyzed game is labelled by comparing the move the player
made against the engine's best move, using **centipawn loss** (how much the
move worsened the player's position, in hundredths of a pawn).[^chesscom-review]
The complete label set is `book`, `best`, `great`, `good`, `inaccuracy`,
`mistake`, `blunder`, `miss`, `forced`, and `brilliant`.

# Labels and thresholds

| Label | Condition |
|-------|-----------|
| Book | Still inside the first 12 plies (position index `< 12`) with `cp_loss ≤ 25` |
| Forced | The only legal move available (`legalMoveCount == 1`) |
| Best | Delivers checkmate, or `cp_loss ≤ 10` and it *is* the engine's top move |
| Brilliant | As Best, and the engine's top move is a material sacrifice |
| Great | `cp_loss ≤ 10` but not the engine's top move |
| Good | 10–50 centipawn loss |
| Inaccuracy | 50–100 centipawn loss |
| Mistake | 100–300 centipawn loss |
| Blunder | Over 300 centipawn loss |
| Miss | A forced mate or a winning position (≥ +2.00) was available and missed |

A **brilliant** sacrifice is the engine's top move when that move captures a
piece worth less than the piece being moved — the mover gives up more material
value than they take.

# Order of evaluation

The checks run in the order below and the **first match wins**, so a forced
move is `forced` even when it also loses material, and a checkmating move is
always `best`:

1. the move delivers checkmate → `best`;
2. it is the only legal move → `forced`;
3. the mover had a forced mate but played another move → `miss`;
4. the mover was winning (`eval_before ≥ +2.00`) and lost ≥ 150 centipawns →
   `miss`;
5. the first 12 plies with `cp_loss ≤ 25` → `book`;
6. `cp_loss ≤ 10` → `brilliant` (top move + sacrifice), `best` (top move), or
   `great` (another move);
7. `cp_loss ≤ 50` → `good`; `cp_loss ≤ 100` → `inaccuracy`; `cp_loss ≤ 300` →
   `mistake`; otherwise `blunder`.

# Centipawn loss

For a position where side S is to move with evaluation `E_before` (from S's
perspective), and the position after S's move has evaluation `E_after` (from the
opponent's perspective), centipawn loss is:

```
cp_loss = max(0, E_before - (-E_after))
```

Engine scores come from the side-to-move's perspective, and mate scores are
mapped to ±100,000 centipawns so they sort above any ordinary evaluation.

A move that checkmates the opponent is always classified **Best**.

# Annotation glyphs

The review screen shows each classification as a label *plus* a standard chess
annotation glyph, drawn in that label's colour — never colour alone. Only errors
and a brilliancy carry a glyph; neutral moves (`best`, `great`, `good`, `book`,
`forced`) show the label and colour only.

| Label | Glyph | On-screen meaning |
|-------|-------|-------------------|
| Brilliant | `!!` | A sound sacrifice that is also the engine's choice |
| Inaccuracy | `?!` | 50–100 centipawns lost |
| Mistake | `?` | 100–300 centipawns lost |
| Blunder | `??` | Over 300 centipawns lost |
| Miss | `!?` | A forced mate or winning tactic was available — `!?` rather than `×`, which reads as capture notation beside SAN |

[^chesscom-review]: Chess.com's Game Review uses a comparable centipawn-loss
  model to grade moves; ChessMentor's thresholds are its own open-source
  approximation, not a copy.
