---
target: puzzles training screen
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/hibrahim/dev/chessdad/src/app/puzzles/page.tsx"
target_fingerprint: "sha256:58a80b8a8f0acb898060abfd9062ba14e7e24163a4262bcc296f25c3458dbda3"
target_path: /Users/hibrahim/dev/chessdad/src/app/puzzles/page.tsx
timestamp: 2026-09-23T14-43-30Z
slug: src-app-puzzles-page-tsx
---
# Impeccable critique — ChessMentor puzzles screen (`/puzzles`)

Method: dual-agent (A: d68d8278 design review · B: 26e27e0c detector + browser evidence). Both were spawned before the screen was rewritten and both re-verified against the live post-rewrite build; each dropped its stale findings and said which. Detector: `impeccable detect --json` over the 4 targets → `[]`, exit 0 (and B's control file also returned clean, so that is "no rule fired", not "clean").
Target: `src/app/puzzles/page.tsx` (+ src/lib/puzzles.ts, src/components/ChessBoard.tsx)
Mode: Operate. Assessed build: production bundle on localhost:3000.

## Design Health Score — 27/40 (Acceptable, one point under Good)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | The active rail row vanished past row 60 |
| 2 | Match System / Real World | 3 | Engine argot in the coaching ("from +7.24 to -0.18 (a 7.4-pawn swing)"); "Hung piece" jargon; no last move shown |
| 3 | User Control and Freedom | 2 | Hints are one-way; no undo, skip or flip; N wrapped forever |
| 4 | Consistency and Standards | 2 | 40px targets under the 44px floor; diverges from Lichess conventions |
| 5 | Error Prevention | 3 | Illegal moves caught and explained; `promotion: "q"` hardcoded |
| 6 | Recognition Rather Than Recall | 3 | Hint ladder is good; the solution was SAN text only |
| 7 | Flexibility and Efficiency | 3 | h/r/n keys and filters; no auto-advance; keyboard drag undiscoverable |
| 8 | Aesthetic and Minimalist Design | 3 | Clean, all sampled text ≥4.6:1; a 60-row wall of "0✓ 0✗" |
| 9 | Error Recovery | 3 | Best-in-class wrong-move card, but no live region on it |
| 10 | Help and Documentation | 2 | No first-run explanation of the drill or of SRS |

## Design specificity verdict

Genuinely chess, not a flashcard skin: the board is the hero (558px, 70px squares at 1440×900), orientation flips to the side to move, the staged hint tints the origin amber then draws a green arrow, and a wrong move gets rose from/to squares plus a ✗ badge. What stayed generic was the *teaching*: centipawn argot, only four motifs with "tactical" covering 69% of the library, no last-move context, no continuation.

## Measured evidence

- Board 558×558 with 69.75px squares at 1440×900 (bounded by the `62vh` term of `min(640px, 62vh)`), 358×358 with 44.75px squares at 390×844 (bounded by the container); no horizontal overflow at either width; squares exactly 1/8 of the box.
- Rail: 60 rendered rows + "Show more", 1009 DOM nodes total, zero long tasks; ~900ms to first rail row, dominated by the 1842-row `/api/puzzles` payload (1.5MB), not by rendering.
- Wrong-but-legal drag: from/to tinted rose, ✗ badge on the destination, "Rb8 isn't the move", board locked (a second drag was silently ignored) until "Try again".
- Illegal drag: `role="alert"` message, board stays interactive.
- Keyboard: Space could pick a piece up but arrows never moved it, so every drop was the same square and no puzzle was solvable without a mouse.
- Contrast: every measured ratio passes (6.2:1–14.4:1). Touch targets at 390px failed for all chips (36px) and all four controls (40px).

## Priority issues (as assessed)

**P1 — Spaced repetition was decorative.** `ORDER BY p.id DESC` with "Due now" off by default, no due-date sort, answered items never dequeued.

**P1 — The answer never appeared on the board when it mattered.** A clean solve snapped back with no arrow and no tick; "Show solution" drew the arrow but left the board locked while the copy said "Now play it on the board".

**P1 — The active drill desynced from the rail.** Past index 60 the rail contained no `aria-current` row at all.

**P2 — Coach text is engine argot and partly broken.** 1279 of 1842 explanations still end "The pattern involved a tactical."; classification and centipawn loss exist in the DB and were never shown.

**P2 — Mobile.** The board began 53% down the viewport and the action row sat below the fold; six chips wrapped to three rows.

## Persona red flags

- **Sam (accessibility):** no puzzle was solvable by keyboard; ✗/✓ badges are aria-hidden and the wrong-attempt card had no live region; 40px targets; nothing tells a screen-reader user that the board is operable.
- **Alex (power user):** a 1.5MB payload per load; no auto-advance; no session boundary; wants "the ones I got wrong yesterday" rather than six categories.
- **Jordan (first-timer):** "Hung piece" vs "Missed capture" are indistinguishable from labels; "tactical" covers 1279/1842 so filtering by it changes nothing; no move number or last-move highlight; the explanation arrives only after failing, in eval math.

## Minor observations

`promotion: "q"` made underpromotions unreachable; `allowDrawingArrows: !interactive` enabled right-click arrows exactly when the board locked; category counts ignored the due filter; `key_lesson` carried a literal newline mid-sentence in all 1842 rows; the filter-reset effect ran after render so `filtered[index]` was briefly undefined.

## Questions to consider

1. If the order was `id DESC`, in what sense was this spaced repetition rather than replaying your most recent import?
2. `classification` and `centipawn_loss` are stored and were never shown — is the learner drilling "my mistakes" or "the engine's best move in positions where I erred"?
3. Every puzzle is one move and ends: what teaches the player to actually win the position after the best move?

## Fixes landed after this assessment

All three P1s and both P2s, plus the keyboard blocker B found: review-queue ordering with "Due now" on and a stable queue, solutions played out on the board (arrow + tick) for solved/assisted/revealed, click and Tab+Enter play via a focusable square renderer, the rail growing and scrolling to the active row, the source-position context line (opponent's last move before; what you played, its classification and cost after), sticky action row and 44px targets, `role="alert"` on the wrong-attempt card, promotion taken from the solution UCI, and `allowDrawingArrows` no longer inverted.

Not yet addressed: the stale "involved a tactical." text stored on existing puzzles (it needs the LLM cache cleared and the games re-analysed), motif granularity beyond the four detector tags, multi-move continuations, and an explicit session boundary.
