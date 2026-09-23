---
type: Playbook
title: Spaced Repetition
description: The scheduling policy for re-serving a player's own missed positions as puzzles.
tags: [spaced-repetition, sm2, puzzles, memory]
status: stable
generated: { by: chessmentor/1.0, at: 2026-09-22 }
updated: { by: "process:okf-code-sync", at: 2026-09-23 }
sources:
  - id: sm2
    resource: https://en.wikipedia.org/wiki/SuperMemo
    title: SuperMemo — SM-2 algorithm
  - id: srs-code
    resource: src/lib/puzzles.ts
    title: ChessMentor — recordPuzzleAnswer() SM-2 update
  - id: puzzle-creation-code
    resource: src/lib/analysis.ts
    title: ChessMentor — personal puzzle creation criteria
---

# Overview

Personal puzzles are the player's own missed positions. Spaced repetition
re-serves each puzzle just before it would be forgotten, so training time goes
to the patterns that are still weak.[^sm2]

A puzzle is created from one of the player's own moves classified `blunder`,
`mistake`, or `miss` that has an engine best move, and only when no puzzle
already exists for that FEN — so the same position is never duplicated, even
across games.

# Schedule (simplified SM-2)

| Event | New interval | Ease factor |
|-------|--------------|-------------|
| First success | 1 day | +0.1 (max 2.5) |
| Second success | 6 days | +0.1 (max 2.5) |
| Later success | `max(1, round(interval * ease))` | +0.1 (max 2.5) |
| Failure | reset to 1 day | −0.2 (min 1.3) |

Each puzzle stores its `ease` factor (starting at 2.5), current
`interval_days`, repetition count, and `due_at` timestamp; a failure resets the
repetition count, and `due_at` is the current time plus the new interval. The
puzzles view shows each card's solved/failed counts alongside its repetitions,
interval, and ease state.

[^sm2]: The schedule is a simplified form of the SM-2 algorithm, adapted for
  chess positions rather than flashcards.
