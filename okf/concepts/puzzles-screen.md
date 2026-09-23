---
type: Reference
title: Puzzles Screen
description: How the training screen turns your own mistakes into filtered drills, with two-stage hints and honest spaced-repetition credit.
tags: [puzzles, training, ui, spaced-repetition, hints]
status: draft
generated: { by: "process:okf-code-sync", at: 2026-09-23 }
updated: { by: "process:okf-code-sync", at: 2026-09-23 }
sources:
  - id: puzzles-screen-code
    resource: src/app/puzzles/page.tsx
    title: ChessMentor — puzzles screen (filters, hints, feedback)
  - id: puzzles-lib-code
    resource: src/lib/puzzles.ts
    title: ChessMentor — puzzle listing, SRS recording, source-position context
  - id: puzzles-api-code
    resource: src/app/api/puzzles/route.ts
    title: ChessMentor — GET/POST /api/puzzles
---

# Overview

The training screen (`/puzzles`) drills the positions the player got wrong. Each
puzzle carries its `fen`, the engine's `solution_uci` and `solution_san`, its
motif tag (`theme`), its spaced-repetition state, and the game it came from. The
list endpoint joins the source game and the source `positions` row, so a drill can
also show the coach's `explanation` and `key_lesson` for the mistake it was built
from.

# Choosing what to drill

Puzzles are grouped by their `theme` — the motif the analysis detected — with a
count per category, plus a **Due now** toggle that filters to puzzles whose
`due_at` has passed (or is unset). Categories are client-side filters over the
single `GET /api/puzzles` payload; changing one resets the drill set and the
board. The rail renders at most 60 rows at a time with a **Show more** control
rather than every puzzle, and shows each entry's `solved_count` / `fail_count`.

# Solving

The board renders `fen` with the side to move at the bottom. Dragging a piece:

* plays the **solution** (`lan === solution_uci`) — the drill is solved;
* plays any other **legal** move — the attempt is drawn on the board (from/to
  squares tinted rose, an `✗` badge on the destination) with the move named in
  the feedback panel, and the board locks so the attempt cannot be compounded;
* plays an **illegal** move — the piece snaps back and the panel says the move is
  not legal in this position.

Promotion always assumes a queen.

# Hints

The hint control has two stages, so it teaches rather than reveals:

1. **Which piece** — the solution's origin square is ringed in amber.
2. **Where to** — the destination is tinted and the solution is drawn as a green
   arrow.

**Show solution** draws the same arrow without requiring the move, and the
feedback panel then names the move, repeats the source position's explanation and
lesson, and links back to that game's review.

# Spaced-repetition credit

Only an unassisted solve counts as correct. A puzzle finished after a hint, after
a wrong attempt, or via **Show solution** is recorded as a miss by
`recordPuzzleAnswer`, which shortens its interval so the position returns sooner;
the screen words this as "with a hint — this drill comes back sooner", not as a
failure. Counters update from the POST response rather than refetching the whole
library.

# Keyboard

`H` advances the hint, `R` resets the current drill, `N` moves to the next puzzle
in the filtered set. Every control is a real button, so tab and Enter work
throughout.
