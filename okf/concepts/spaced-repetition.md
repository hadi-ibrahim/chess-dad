---
type: Playbook
title: Spaced Repetition
description: The scheduling policy for re-serving a player's own missed positions as puzzles.
tags: [spaced-repetition, sm2, puzzles, memory]
status: stable
generated: { by: chessmentor/1.0, at: 2026-09-22 }
sources:
  - id: sm2
    resource: https://en.wikipedia.org/wiki/SuperMemo
    title: SuperMemo — SM-2 algorithm
---

# Overview

Personal puzzles are the player's own missed positions. Spaced repetition
re-serves each puzzle just before it would be forgotten, so training time goes
to the patterns that are still weak.[^sm2]

# Schedule (simplified SM-2)

| Event | New interval | Ease factor |
|-------|--------------|-------------|
| First success | 1 day | +0.1 |
| Second success | 6 days | +0.1 |
| Later success | `interval * ease` | +0.1 (max 2.5) |
| Failure | reset to 1 day | −0.2 (min 1.3) |

Each puzzle stores its `ease` factor, current `interval`, repetition count, and
`due_at` timestamp. The dashboard shows solved/failed counts so progress is
visible.

[^sm2]: The schedule is a simplified form of the SM-2 algorithm, adapted for
  chess positions rather than flashcards.
