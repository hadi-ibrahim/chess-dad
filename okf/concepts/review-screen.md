---
type: Reference
title: Review Screen
description: How the per-game review screen flags critical moves, separates the player's mistakes from the opponent's, and presents the coach's verdict.
tags: [review, ui, classification, critical-moments, coaching]
status: draft
generated: { by: "process:okf-code-sync", at: 2026-09-23 }
updated: { by: "process:ai-providers", at: 2026-09-25 }
sources:
  - id: review-screen-code
    resource: "src/app/review/[id]/GameReview.tsx"
    title: Chess Dad — GameReview screen
  - id: review-colors-code
    resource: src/components/colors.ts
    title: Chess Dad — classification colours, labels, glyphs
  - id: review-movelist-code
    resource: src/components/MoveList.tsx
    title: Chess Dad — move list rendering
  - id: critical-code
    resource: src/lib/analysis.ts
    title: Chess Dad — is_critical computation
---

# Overview

The review screen (`/review/[id]`) is where an analysed game becomes a lesson.
It loads the game and its stored per-ply positions from `GET /api/games/:id`,
draws the board, and presents three linked views: the engine's verdict on the
selected move, the list of critical moments, and the full move list.

# What the board shows

The board renders the position **before** the selected move (`positions[ply].fen`,
not `fen_after`), so the engine's suggested move and the move actually played
both start from the square the piece still occupies. The played move is drawn as
an arrow in the move's classification colour, with the destination square
outlined and the classification glyph marked on it; when the engine preferred a
different move and the move is an error, that best move is drawn as a green
arrow.

# Critical moments

A position is flagged when its stored `is_critical` is `1`. Analysis sets that
flag when the centipawn loss exceeds 100 or the move was a `miss`.

The screen splits those flagged plies into two tabs:

* **Your mistakes** — flagged plies where `color === playerColor`, sorted by
  centipawn loss (worst first, which is what the rail's copy promises). Keyboard
  stepping still follows move order, so `Shift` + arrow walks the game rather than
  jumping around the list. The summary offers **Review the costliest moment** and
  **First mistake**.
* **Their mistakes** — flagged plies by the opponent, shown as chances to
  punish: each row also shows the move the player replied with (the next ply).

Both tabs mark the selected ply, show the classification glyph and centipawn
loss, and show the motif and phase.

# The coach panel

Selecting a ply replaces the game summary with the engine's verdict:

* the move number and whether it was **your move** or **their move**;
* the classification badge — label *and* glyph, in the classification colour,
  never colour alone;
* the centipawn loss (for error classes only), the phase, and the clock at that
  ply, plus a **played under 30s — time pressure** chip when an error move was
  played with under 30 seconds left;
* what was played, what the engine wanted for comparison, and the evaluation
  before → after from the player's perspective;
* the coach's `explanation`, `key_lesson`, and `drill_suggestion` (with a
  **Train this** link to the puzzles page). When no written note exists the
  panel says the engine preferred a different move instead.

Before any ply is selected the panel is a game summary: result, accuracy, counts
of the player's mistakes/blunders/missed wins, how many chances the opponent
gave, phase and motif tallies, and jump buttons to the costliest and first
mistakes.

# Deeper analysis (AI)

Below the coach panel sits an opt-in **Deeper analysis (AI)** section. The engine
coach above is always the baseline and is never replaced; an AI reading is stored
*beside* it in `ai_explanations` and shown as a second opinion.

* The provider is a connection saved on the [Profiles screen](profiles-screen.md).
  The profile's default connection is preselected; the rest are in the dropdown.
* **Explain this move** explains only the selected ply; **Explain all flagged
  moves** explains every critical moment in the game (capped at 40 positions).
  Both post the chosen connection — key included — to `POST /api/games/:id/ai`,
  which uses it for that request's outbound calls and stores nothing about it.
* A cached answer for the *same* provider and model is returned without a request,
  so re-running a provider is free; the notice says how many came from cache.
* Every reading ever stored for the position is kept and offered as a chip
  (`Claude · claude-opus-5-5`, `GPT · gpt-6-astra`, …). Selecting one shows that
  text, which is the point of the feature: what Claude said last week stays
  viewable after GPT answers today.
* The wait is shown as elapsed seconds (`Asking… 47s`), because a reasoning model
  can take a minute. Transient provider errors (a Gemini 503, a rate limit) are
  retried behind the scenes; a run that reaches its time budget stops and says so,
  and running it again continues for free from the cache.
* A generated answer that names a move that is not legal in the position is
  discarded rather than shown or cached — the same guard the offline coach has
  always had. The failure is reported in the panel, and the engine read stays.
* With no provider configured the section links to Profiles and the rest of the
  screen is unaffected.

# The move list and evaluation graph

The move list pairs White and Black plies per move number. Each move is coloured
by its classification and carries its glyph and, for error classes, its
centipawn loss; a dot on the row marks its worst classification. The evaluation
graph plots the evaluation from the player's perspective, marks every error and
brilliancy with a coloured dot, and jumps to a ply when clicked.

# Navigation and analysis controls

The transport steps a ply at a time; the keyboard does the same with the arrow
keys, while `Shift` + arrows jump to the previous/next critical move, `Home` and
`End` go to the ends, `F` flips the board, and `Escape` returns to the start.
Per-game notes are kept in the browser, keyed to the game id.

The screen honours `?ply=<n>` (`/review/356?ply=35`) and opens with that ply
selected — the games library's "turning point" column links straight there. The
evaluation bar keeps its numeric label only from `sm` up, so a 390px screen gives
the extra pixels to the position; the bar itself still announces the value to
assistive technology.

`Analyze` / `Re-run engine` runs `POST /api/games/:id/analyze` for this game
directly (not through the queue) at the chosen depth — the screen offers quick
(10), standard (14), and deep (18). Re-running an already analysed game asks for
confirmation because it replaces the stored engine analysis. It is deliberately
labelled as the *engine* run so it is not confused with the AI re-analysis above,
which never touches the engine data.
