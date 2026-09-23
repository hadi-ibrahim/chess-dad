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
    title: Chess Dad — puzzles screen (filters, hints, feedback)
  - id: puzzles-lib-code
    resource: src/lib/puzzles.ts
    title: Chess Dad — puzzle listing, SRS recording, source-position context
  - id: puzzles-api-code
    resource: src/app/api/puzzles/route.ts
    title: Chess Dad — GET/POST /api/puzzles
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
`due_at` has passed (or is unset) and is **on by default**. Categories are
client-side filters over the single `GET /api/puzzles` payload; changing one
resets the drill set and the board.

The drill set is ordered as a review queue, not as an import list: never-reviewed
positions first (`due_at` unset), then the most overdue, then the lowest `ease`.
Answering a puzzle does not reshuffle the queue mid-session — its new `due_at`
only removes it from the set the next time one is built — so the explanation just
earned stays on screen until the player advances.

The rail renders at most 60 rows at a time with a **Show more** control rather
than every puzzle, showing each entry's `solved_count` / `fail_count`, and it
grows and scrolls itself to keep the active row visible (without moving the
page).

# Solving

The board renders `fen` with the side to move at the bottom, and the status strip
names the opponent's last move (`prev_san`) so the position has context. A move can
be played by dragging or by clicking a piece and then its destination; every square
is a real button, so `Tab` + `Enter` solves a puzzle without a pointer. Dragging a
piece:

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

**Show solution** draws the same arrow without requiring the move. When a drill
ends — solved, assisted or revealed — the solution is **played out on the board**
(`fen` advances, green arrow and `✓`), and the panel names the move, states what
was played in the game with its classification and centipawn loss, repeats the
source position's explanation and lesson, and links back to that game's review.

# Playing it out

Resolving a drill starts a short continuation from the engine line cached for the
puzzle's FEN (`engine_cache.pv`): the solution is played on the board, the engine's
reply follows from the line automatically, and the player answers with the next
line move — two moves each, capped by `MAX_LINE_PLIES`. A move off the line is
named but costs nothing, because the drill is already scored; **Show me the rest**
plays the remainder and the panel closes with the line complete. The continuation
teaches conversion rather than only recognition.

# Spaced-repetition credit

Only an unassisted solve counts as correct. A puzzle finished after a hint, after
a wrong attempt, or via **Show solution** is recorded as a miss by
`recordPuzzleAnswer`, which shortens its interval so the position returns sooner;
the screen words this as "with a hint — this drill comes back sooner", not as a
failure. Counters update from the POST response rather than refetching the whole
library.

# Keyboard

`H` advances the hint, `R` resets the current drill, `N` and `P` move to the next
and previous puzzle in the filtered set. Every control is a real button and every
square is focusable, so the whole loop works from the keyboard. The action row is
sticky at the bottom of the viewport on small screens, where the board pushes it
below the fold. A session line counts clean solves and hinted solves as you go.

# Known limits

The motif filter runs client-side over the whole `GET /api/puzzles` payload (1,842
rows), so changing category costs no round trip but the payload grows with the
library. The theme chip is visible before the attempt, which gives the answer class
away. There is no session boundary: the queue is every due drill (1,828 of them),
so "done" has no shape, and the rail renders 60 rows at a time behind **Show
more**.

