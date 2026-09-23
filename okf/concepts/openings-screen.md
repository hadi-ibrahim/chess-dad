---
type: Reference
title: Openings Screen
description: How the opening trainer steps through a line, practises it as either colour, and distinguishes a real deviation from simply running out of theory.
tags: [openings, training, ui, repertoire]
status: draft
generated: { by: "process:okf-code-sync", at: 2026-09-23 }
updated: { by: "process:okf-code-sync", at: 2026-09-23 }
sources:
  - id: openings-screen-code
    resource: src/app/openings/page.tsx
    title: ChessMentor — opening trainer (step, practise, hints, line states)
  - id: openings-lib-code
    resource: src/lib/openings.ts
    title: ChessMentor — the hand-written theory set
  - id: openings-entities
    resource: okf/entities/
    title: ChessMentor — opening theory notes
---

# Overview

The trainer (`/openings`) works through the theory set in `src/lib/openings.ts`:
one hand-written main line per opening, each with an ECO code, a name, and a
Wikipedia reference. It has two modes — **stepping** through the line and
**practising** it as either colour — and it accepts `?eco=C50` so another screen
can open a specific line (the insights opening table links here).

# Stepping

`⏮ ◀ ▶ ⏭` move one ply at a time through the whole line; the move list marks the
current ply, and the transport stops at either end rather than clamping silently.

# Practising

Practising seeds the board with the line's first move when the player takes Black,
then waits for the player's moves. Correct moves are followed automatically by the
opponent's replies from the line. Three outcomes are distinguished, and this
distinction is the point of the screen:

* **In theory** — the move matched the line; progress is shown as `n / total`.
* **Deviation** — the move is legal but not the line. The destination is tinted
  rose with an `✗` badge, the panel names both moves ("You played d4; the line
  plays e4"), and the position is recoverable: **Play it for me** applies the
  line's move, **Try again** rewinds to the previous player turn.
* **Line complete** — the player reached the end of the stored line. This is *not*
  a deviation: the panel reports `total / total plies, no deviation` and offers
  **Practise again** or **Next opening**.

A line with no move for the chosen colour cannot be practised: those controls are
disabled with the reason, instead of offering a drill that is unwinnable by
construction.

# Hints and controls

The hint has the same two stages as the [puzzles screen](puzzles-screen.md): the
origin square is ringed in amber, then the destination is tinted and the line's
move drawn as a green arrow. Practice mode also offers **Undo**, **Play it for
me**, **Switch side** and **Reset**. Every square is focusable, so a line can be
played by clicking or with `Tab` + `Enter` as well as by dragging.

# Your repertoire

Each opening is joined with the player's own results (`games` by ECO: games,
wins, draws, losses, score percentage, average accuracy) and with its review
schedule in `opening_reviews`. The screen opens scoped to **Your repertoire** —
the lines you have actually played, most played first — with **Due** and **All**
alongside it, and each row carries its record and a due chip. "Due" means an
opening you play whose next review has arrived; a line you have never had on the
board is not overdue.

Finishing a line cleanly records a success; a deviation records a miss. The
schedule is the same simplified SM-2 curve the puzzles use (first success 1 day,
second 6, then `interval * ease`; a miss resets to 1 day and drops the ease by
0.2, floored at 1.3), stored per ECO in `opening_reviews` and recorded once per
attempt so a retry does not double-count.

# Known limits

The set is one scripted line per opening (25 openings, ~5 plies each), so
"leaving theory" means "this move differs from the one stored line", not "this
move is not played by masters". Opponent alternatives, a repertoire subset, and a
spaced-repetition queue for openings are not implemented; the `ideas` field on an
opening is never populated, and the theory notes under `okf/entities/` are not
surfaced in the UI. `POST /api/openings` (deviation detection) exists but the
screen computes deviations client-side.
