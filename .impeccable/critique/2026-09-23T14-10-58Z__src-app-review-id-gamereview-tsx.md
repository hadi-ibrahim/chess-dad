---
target: review/[id] game review screen (revision 2)
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:/Users/hibrahim/dev/chessdad/src/app/review/[id]/GameReview.tsx"
target_fingerprint: "sha256:6f772e6dbddb8fa57abb75061a3d977c5294e7692e9f29ffccbf12501f1686fa"
target_path: /Users/hibrahim/dev/chessdad/src/app/review/[id]/GameReview.tsx
timestamp: 2026-09-23T14-10-58Z
slug: src-app-review-id-gamereview-tsx
---
# Impeccable critique #2 — ChessMentor game review (`/review/[id]`)

Method: degraded — Assessment A (226b0504) ran isolated; Assessment B (65292045) did not return, so the detector and browser measurements below were taken by the parent with its own CDP instrumentation (the harness rule requires the degradation to be declared).
Target: `src/app/review/[id]/GameReview.tsx` (+ ChessBoard/MoveList/EvalGraph/EvalBar/Nav/colors)
Mode: Operate. Assessed build: production bundle on localhost:3000, commit 250d01e.
Previous run: 21/40 (Acceptable, bottom of band), cognitive load critical.

## Design Health Score — 24/40 (Acceptable)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Ply syncs across board/bar/graph/list; "Analyzing…" shows no progress |
| 2 | Match System / Real World | 3 | Right chess vocabulary; glyph `×` reads as capture; "The pattern involved a tactical." |
| 3 | User Control and Freedom | 3 | shift+arrows, Home/End, Esc, flip; Re-analyze overwrites stored analysis, no undo |
| 4 | Consistency and Standards | 2 | Copy promises "worst first" but the list is in ply order; three filled indigo primaries |
| 5 | Error Prevention | 2 | Destructive re-analyze behind a native confirm; notes autosave with no saved state |
| 6 | Recognition Rather Than Recall | 2 | Legend lives in a collapsed `<details>` inside a nested scroller; "hung piece" undefined |
| 7 | Flexibility and Efficiency | 3 | Keyboard jumps, click-to-jump, tabs; no mistake-only filter; 46 tab stops |
| 8 | Aesthetic and Minimalist Design | 2 | Flat panel rhythm; verdict card does not outrank the notes box; "you played/engine wanted" stated three times |
| 9 | Error Recovery | 2 | Alert + back link only; no retry or partial-analysis state |
| 10 | Help and Documentation | 2 | Legend and drill exist; no centipawn/motif tooltip, no "how to review" entry |

## Design specificity verdict

Genuinely composed for a chess learner. Two arrows from one origin (played move tinted to its classification colour with an outlined, badged destination; the engine's choice green), "You played Bxf4 · engine wanted Bg7 · eval +1.1 → −0.5", standard annotation glyphs, a distinct miss class, motif/phase/clock chips, "you replied Rxf4" on the opponent's rows, and a centipawn legend. The chassis is still a generic dark dashboard: identical rounded panels, uppercase tracking-wider labels, a depth select plus a filled Re-analyze in the header, and a notes textarea. SAN is bold UI font, never a monospaced score sheet.

## Deterministic scan

`impeccable detect --json` over the 8 changed markup/TS targets → `[]`, exit 0. Zero findings.

## Measured evidence (parent instrumentation, CDP + pixel probes)

- Board is truly square: square w/h = 1.000 at both 1440x900 (65x65) and 390x844 (36.44x36.44); board box 520x520 / 291.5x291.5.
- Eval bar height / board height = 1.000 at both widths.
- No horizontal page overflow: scrollWidth == clientWidth (1440 and 390).
- Selected flagged ply: two arrows (#f97316 played, #22c55e engine), annotation badge `?` on f4 with fill rgb(249,115,22), 2 tinted squares, aria-current on the row.
- Contrast (computed from the shipped hexes): coordinates 5.55:1 on dark squares, 6.44:1 on light; badge text 5.23–11.29:1 across the ten classes; every classification colour ≥ 5.29:1 on the page.
- Targets at 390px: transport 44x44, Flip 73x44, mistake rows 310x60.5, move-list rows 132x36.

## Priority issues

**P0 — The coaching is cut off where it matters.** At 1440x900 the verdict line is visible but the lesson, drill and mistake-navigation fall below the fold; at 390x844 the card begins at the fold. The brief was "read the coaching without scrolling". Fix: below `lg`, place the verdict card above the transport (or make it sticky), trim the four pre-board header rows, and hide the keyboard-hint line on touch.

**P1 — "worst first" is false.** The rail copy promises the worst move first; the list is in ply order (23 −1.6, 25 −5.8, 27 −5.3, 29 −2.5, 33 −1.0, 35 −7.4), so the costliest is last. Fix: sort by centipawn loss descending.

**P1 — Deficit-only framing of a won game.** The tally shows only mistakes and missed wins; the data holds 2 brilliant, 7 best and 11 good moves that are never surfaced, and nothing at the blunder moment says the game was still won. The "played under 30s" reassurance can never fire for this player (their flagged plies had 9:18→8:19 on the clock; it fires on the opponent's 47s/6s moves). Fix: surface the positive counts, state that the win held, and add "they did not punish it — 13.Rxf4 was worse (−3.3)" when the reply is also an error.

**P1 — Flat hierarchy and a loud destructive control.** Three filled indigo primaries compete while Re-analyze outranks every learning action. Fix: one filled button (the costliest-moment jump), demote Re-analyze to a ghost control with a styled dialog, and give the verdict card a distinct surface.

**P2 — Annotation craft.** `×` for miss collides with capture notation in a game with six captures, so the badge on e5 reads as "capture on e5"; the badge renders "Mistake ?" rather than binding to the move ("Bxf4?"); the coach's template grammar ("The pattern involved a tactical.", "tactical or positional rather than forced") is broken or tautological and is generated server-side.

## Persona red flags

- **Sam (accessibility):** 46 move-list tab stops with no roving tabindex; the eval graph is mouse-only with a generic aria-label and no data table; the verdict card has no live region, so transport changes announce nothing; 10px centipawn text and an aria-hidden 17px badge on a ~37px mobile square.
- **Casey (mobile):** four stacked header rows before the board; both coaching and the summary start at or below the fold; the keyboard-hint line wraps uselessly on touch.
- **Alex (power user):** mistake-jump buttons sit in the card footer below the fold; `Shift`+arrow needs body focus; "All moves" (max 420px) shows about half the game.
- **Jordan (first-timer):** "hung piece"/"tactical" are undefined, and the legend that would explain them is collapsed at the bottom of a nested scroller.

## Minor observations

Accuracy and the win chip are each stated twice; the bare "Loading…"; `window.confirm` breaks the theme; the orange badge separates poorly against the brown squares; the graph's y-axis has no unit label; SAN colour can be misread as side-to-move; ~250px of dead left column under the graph; three nested scrollers on one page.

## Questions to consider

1. What is this screen's one sentence about the game — could "You won by punishing their blunders; you gave back 7.4 pawns on move 18 and they did not take it" replace the tally and the duplicate header chip?
2. The green arrow shows a move but never its consequence — would a short continuation teach more than "the idea you missed was tactical or positional"?
3. Does miss deserve an angry rose when three of this player's six flags are misses in a game they won — should it read as opportunity rather than error?
