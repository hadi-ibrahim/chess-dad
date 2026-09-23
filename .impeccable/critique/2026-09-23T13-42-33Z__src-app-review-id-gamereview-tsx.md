---
target: review/[id] game review screen
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 3
p1_count: 2
target_identity: "file:/Users/hibrahim/dev/chessdad/src/app/review/[id]/GameReview.tsx"
target_fingerprint: "sha256:63e41151da9f74fd9e6cc7d2c8bde6307d8c798a053c10c58841263ef0937b22"
target_path: /Users/hibrahim/dev/chessdad/src/app/review/[id]/GameReview.tsx
timestamp: 2026-09-23T13-42-33Z
slug: src-app-review-id-gamereview-tsx
---
# Impeccable critique — ChessMentor game review (`/review/[id]`)

Method: dual-agent (A: 042d5574 design review · B: f54311d8 detector + browser evidence)
Target: `src/app/review/[id]/GameReview.tsx` (+ ChessBoard/MoveList/EvalGraph/EvalBar)
Mode: Operate. Assessment date: 2026-09-22. Assessed build: production bundle on localhost:3000.

## Design Health Score — 21/40 (Acceptable, bottom of band)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Board/SAN update, but the move you played is never drawn; no cursor on the eval graph; re-analysis has no progress |
| 2 | Match System / Real World | 2 | SAN and pawn evals correct; `0-1` uncoloured and undecoded; motif enum leaks into prose; no chess glyphs |
| 3 | User Control and Freedom | 2 | Only glyph-only ⏮◀▶⏭; no arrow-key stepping, no flip-board, no "next blunder" |
| 4 | Consistency and Standards | 3 | Orientation follows player colour, one shared palette; blunder `#ef4444` vs miss `#e11d48` near-identical; no active nav state |
| 5 | Error Prevention | 2 | Re-analyze overwrites stored analysis with no confirm/depth/cost hint |
| 6 | Recognition Rather Than Recall | 2 | The explaining sentence lives ~1300px below the board; no legend for 10 classifications |
| 7 | Flexibility and Efficiency | 2 | Move-list click works; eval graph is dead; no shortcuts |
| 8 | Aesthetic and Minimalist Design | 3 | Coherent zinc/indigo, calm board; 320px rail half-empty while near-identical cards bulk the page |
| 9 | Error Recovery | 2 | Badge names the error, lesson explains it; lessons contradict their own eval; "No explanation yet." is a dead end |
| 10 | Help and Documentation | 1 | No legend, no definition of inaccuracy/CPL/accuracy, `/knowledge` never linked from a motif |

## Design specificity verdict

Partly specific. Chess skeleton is real (board anchor, eval bar in the canonical left slot, SAN list, classification colouring), but the coaching layer is a generic card grid: strip the board and it is any test-report dashboard. Nothing speaks a player's language (no `??`/`?!`/`?`), nothing draws the move you actually played, nothing reasons about time.

## Deterministic scan

`impeccable detect --json` over 7 markup targets → `[]`, exit 0. Zero findings; no false positives to flag. An empty result confirms no known anti-pattern rule fires, not that the surface is clean.

## Measured defects (browser evidence)

- Board geometry wrong at every width: at a true 390px viewport each column track is 36.44px and each row track 60.0px (0.607 ratio); at 1440px, 88.69 vs 94.19 (board 709.5×753.5, 6.2% too tall). Cause: rows derive from container height (board `height: 100%` + `.flex` `align-items: stretch`) while columns derive from width; no 1:1 constraint; `EvalBar height={480}` sets the stretch height.
- Eval bar is 20×480 (y289.8→769.8) against a 753.5px board — covers 63.7% of it.
- Board is uncapped at 709.5px wide; its bottom edge lands at y906.5, below a 1440×900 fold, so eval graph and all coaching sit below it.
- Horizontal page overflow is real and unrelated to the board: clientWidth 390 vs scrollWidth 570 (180px), onset at any viewport <571px, caused solely by the header nav (min-content 421.6px, no wrap) — "Openings"/"Knowledge" off-screen at 390.
- Eval graph Y-axis labels are not clipped (tight: 5.2px from the SVG edge).
- Contrast failures: zinc-500 `#71717b` on `#09090b` 4.12:1 (12px ranks, motif); board notation `#B58863` on `#F0D9B5` 2.29:1; move-list rose-600 `#e11d48` 4.24:1 at 14px semibold.
- Touch targets at 390 all below 44×44: SAN buttons 161×24, Start 44.6×20, ⏮ 42×32, ◀ 35.1×32, ▶ 35.1×32, ⏭ 42×32, Re-analyze 96.1×32, critical-moment heading 118×20.
- Capture caveat: the CLI `--window-size=390,844` screenshot lays out at Chrome's ~500px minimum window and then crops, so its cut files are an artifact, not a 390px defect.

## Priority issues

**P0 — Your move is invisible, and the best-move arrow is drawn on the post-move position.** `currentFen` is `positions[currentPly].fen_after` (GameReview.tsx:115) while `currentBestArrow` is built from `positions[currentPly].best_move` (:132-143). The arrow's from-square is empty in the rendered position, so the green arrow points at a move that is no longer legal. `squareStyles` is never passed although ChessBoard supports it. Fix: on selection render `p.fen` (the before-position); mark the played move with a classification-coloured arrow + from/to square tints + a `??`/`?!`/`?` glyph; draw the green best-move arrow only for inaccuracy/mistake/blunder/miss; keep `fen_after` one ▶ step away so the consequence is visible. Caption "You: Nh5 · Engine: Nd4 (−5.8)".

**P0 — The board's geometry is wrong and it owns the whole screen.** Measured above: 36×60 squares at 390px (65% vertical stretch), 6.2% stretch at 1440px, board 709.5px wide. Fix: give the board a 1:1 constraint (`aspect-ratio: 1/1`, `height: auto`, `gridTemplateColumns/Rows: repeat(8, minmax(0,1fr))`), cap it (≈560px, matching the puzzles/openings convention), and let the eval bar follow the board's height instead of dictating 480px.

**P0 — The coaching for the selected move sits ~1300px (desktop) / ~2600px (mobile) below it.** Fix: a coach panel bound to `current` placed directly under the board (classification + glyph, CPL as pawns, motif, phase, clock, "You vs Engine", explanation, key lesson, drill CTA), and a compact critical-moment strip/chips under the board that jump in place.

**P1 — 8 of 14 critical moments are silently dropped.** `critical` filters `is_critical === 1 && color === player_color` (:170-173); the opponent's errors — the plies where a 74% player learns to punish — never render (ply 24 Rxf4 blunder 334cp, ply 26 Rf2 miss 757cp, ply 34 Rxh5 miss 1062cp). Fix: "Your mistakes (6) / Missed wins (8)" tabs with counts.

**P1 — Header nav breaks the layout below 571px.** 180px of horizontal page scroll, "Openings"/"Knowledge" unreachable. Fix: wrap or collapse the nav (icon row / overflow menu) so the page never scrolls sideways.

## Persona red flags

- **Jordan (first-timer):** `0-1` is undecoded (this player *won* as Black and the screen never says so); no legend separates orange Mistake from rose Miss from red Blunder; "The pattern involved a tactical." is broken grammar from an unmapped enum; "centipawn" is never named or shown.
- **Alex (power user):** expects ←/→ stepping, flip board, "next blunder", keyboard access to 46 moves — none exist; the eval graph looks clickable and is not; the empty 320px rail sits beside a 1300px scroll to the answer.
- **Casey (mobile):** 36×60 stretched squares; nav overflow; all touch targets under 44×44; move list and coaching are viewports away.
- **Sam (accessibility):** classification is colour-only; the eval bar's label is not exposed (no role); playback buttons are unlabelled glyphs; SAN rose-600 fails contrast; no visible focus rings; screenshots show no legend.

## Minor observations

Notes textarea holds prime rail real estate for the 1% who annotate; `accuracy` has no phase breakdown though `phase` exists on all 46 plies; `mate_before`/`mate_after` are stored and never shown; no active nav state on `/review`; the depth select disappears once analysed so depth 18 can't be chosen for a re-run; the header never states the result in words.

## Questions to consider

1. If a learner's job is "understand one mistake and drill it", why does the screen open on the whole game and end on the lesson — what if it opened on the worst moment with the full game as escape hatch?
2. This player won; what would a result-aware review look like, and would "missed wins" beat "your mistakes" as the primary lesson at 74% accuracy?
3. The engine already knows your move, the best move, CPL, motif, phase and clock — if a coach had those facts and 20 seconds, what is the one sentence they would say, and where would it live?
