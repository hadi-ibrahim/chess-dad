---
type: Reference
title: Lessons Screen
description: How the beginner lessons screen teaches the basics of chess — one short lesson and one verified puzzle at a time — and how its puzzles are validated.
tags: [lessons, onboarding, ui, beginners, puzzles]
status: draft
generated: { by: "process:okf-code-sync", at: 2026-09-24 }
updated: { by: "process:okf-code-sync", at: 2026-09-24 }
sources:
  - id: lessons-content-code
    resource: src/lib/lessons.ts
    title: Chess Dad — lesson content and puzzle definitions
  - id: lessons-screen-code
    resource: src/app/lessons/page.tsx
    title: Chess Dad — lessons screen (grouping, progress, deep links)
  - id: lesson-puzzle-code
    resource: src/components/LessonPuzzle.tsx
    title: Chess Dad — the tiny-puzzle component (board and quiz)
---

# Overview

The lessons screen (`/lessons`, nav label **Learn**) is the app's on-ramp: a
beginner's introduction to chess, written for someone who has just imported their
first games and does not yet know what `??` or `+1.5` mean. It is deliberately
plain-language — one idea per paragraph — and every lesson ends with one small
puzzle, so nothing is learned without being tried.

It is **static content**. The lessons are hand-authored in `src/lib/lessons.ts`
and are not derived from the [OKF bundle](../index.md); the bundle documents the
app for its maintainers, and this screen teaches chess to its players. The two are
separate audiences.

# What it teaches

Thirteen lessons in four groups, in this order:

* **Basics** — reading a move (the notation), the annotation symbols, castling,
  en passant, promotion.
* **The engine** — what Stockfish is, and what a centipawn is.
* **Why we study** — why openings matter, why endgames matter.
* **Tactics** — the fork, the pin and the skewer, the discovered attack,
  attraction (including the smothered mate).

Each lesson carries `body` (paragraphs), an optional `terms` list rendered as a
"Worth remembering" reference, and exactly one `puzzle`.

# Two kinds of puzzle

A lesson's puzzle is a discriminated union on `kind`:

* **`move`** — a `fen`, the `solutionUci` / `solutionSan`, a `prompt`, a `hint`
  and an `explain`. The board is playable: drag a piece, or tap it and tap its
  destination, and every square is a real button so `Tab` + `Enter` works too.
* **`quiz`** — a `question`, `options`, the `answer` index, an `explain`, and an
  optional `fen` shown beside the question. This is used where a board move would
  not fit: what an engine is, and how to read an evaluation.

Playing a move is judged by `move.lan === solutionUci`, the same rule the
[Puzzles screen](puzzles-screen.md) uses. A correct move is **played on the board**
(the board is driven by a `boardFen` state that advances to the post-solution
position) with a green arrow and a `✓`.

Unlike the drill screen, a legal-but-wrong move does **not** lock the board: it is
tinted rose with an `✗`, the hint reveals itself, and the player may simply try
again. This is a teaching surface, not an assessment — there is no scoring, no
spaced repetition, and no failure state. An illegal move snaps the piece back.

Promotion assumes the promotion piece named in the solution (`solutionUci[4]`), so
the promotion lesson auto-queens; there is no underpromotion picker.

# One instance per lesson

The puzzle is keyed on the lesson's id (`key={lessonId}` in `LessonPuzzleView`).
That is load-bearing, not decoration. React reuses a component instance when the
same type renders in the same position, so without the key every piece of puzzle
state — `solved`, `revealed`, the wrong attempt, and the board's own position —
follows the reader into the *next* lesson: it opens already solved, with its
answer drawn on the previous lesson's board and the board locked. The fault only
appears between two puzzles of the same kind (move→move, quiz→quiz), because a
change of kind swaps the component type and remounts anyway — which is exactly
what makes it easy to miss. Do not remove the key, and keep it derived from the
lesson, not the puzzle object, which has no stable identity of its own.

# Verifying a puzzle

**Every puzzle is verified before it ships**, by `npm run verify:lessons`
(`scripts/verify-lessons.mjs`). A lesson with a wrong answer is worse than no
lesson, because it teaches the error with authority — and a *position* can be
wrong even when the solution is right.

The script reads the real content out of `src/lib/lessons.ts` and, for every
lesson, checks that:

* the position is **legal** — one king each, kings not adjacent, no pawn on a back
  rank, and the side *not* to move is not in check. That last one is the subtle
  one: a white queen on `a1` with a black king on `h8` is already checking down the
  long diagonal, so the position is illegal and renders as "the queen has already
  checked the king" — the answer looks like it was played for you;
* the position is live — not already mate or stalemate, and not without legal moves;
* the solution is legal, and its UCI and SAN match chess.js exactly — the board
  compares `move.lan` against `solutionUci`, so anything else silently rejects the
  right move;
* the annotation tells the truth: a `#` really is checkmate, a `+` really is check;
* for a mate in one, there is **only one** — otherwise a player who finds a
  different, equally correct mate is told they are wrong. This is why the endgame
  lesson's queen starts on `a2` and not `a1`: from `a4` both `Qa8#` and `Qe8#`
  mate, and from `a1` the position was illegal as well.

Add a lesson by editing `lessons.ts` and running the script. Do not ship a puzzle
it has not passed.

# Progress and navigation

Progress is a list of completed lesson ids in `localStorage` under
`cd_lessons_done`, drawn as a bar and a `✓` per row in the nav. A lesson counts as
done when its puzzle is solved, revealed, or (for a quiz) answered — at that point
the explanation is on screen and the lesson has been read. Nothing is sent to the
server, consistent with the local-first rule that the deployment remembers nobody
(see [Profiles screen](profiles-screen.md)).

Lessons can be deep-linked with `?lesson=<id>`. Switching lessons uses
`history.replaceState` rather than the router, so the board keeps its state and the
page does not re-render through a navigation.

# Replaced the knowledge screen

This screen replaced `/knowledge`, which rendered the raw OKF bundle as markdown —
legible to a maintainer, meaningless to a new player. The bundle itself is
untouched and still very much in use: the offline coach reads
`concepts/coaching-rules.md` through `readCoachingRules()` in
[Coaching rules](coaching-rules.md), and analysis regenerates per-account progress
documents through `writeProgressBundle()` (see [Persistence](persistence.md)).

The `GET /api/okf` route was removed with the screen, since the screen was its only
consumer; the bundle is read from the filesystem, not over HTTP. Removing it also
closed an unauthenticated path-traversal read (the handler passed a query
parameter straight into the reader). `readOkfDoc` now confines every read to the
bundle directory and allows only `.md` files, so the guarantee survives if a route
is ever wired to it again. The `POST /api/okf/progress` route is unaffected.

# Known limits

Progress lives in one browser and is lost with site data; there is no cross-device
record. Promotion assumes the solution's piece, so an alternative underpromotion
cannot be entered. The content is static, so adding a lesson means editing
`lessons.ts` — there is no generator — and then running `npm run verify:lessons`.
That script is the only thing standing between a typo and a lesson that confidently
teaches a wrong answer, and it covers the lessons alone, not the rest of the app.
