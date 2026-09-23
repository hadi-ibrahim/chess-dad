---
target: insights dashboard
total_score: 13
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
target_identity: "file:/Users/hibrahim/dev/chessdad/src/app/insights/page.tsx"
target_fingerprint: "sha256:11f6f6156b65363ed06b2e294b682cba585607c2b24f8a46a861479f621acb40"
target_path: /Users/hibrahim/dev/chessdad/src/app/insights/page.tsx
timestamp: 2026-09-23T14-55-17Z
slug: src-app-insights-page-tsx
---
# Impeccable critique — ChessMentor insights dashboard (`/insights`)

Method: dual-agent (A: 32341185 design review · B: 4527ae9d detector + browser evidence). Assessment A and B both ran against the live build. Detector: `impeccable detect --json` over 4 targets → `[]`, exit 0 — reported as "no rule fired", not "clean" (B's deliberately-broken control file also returned []).
Target: `src/app/insights/page.tsx` (+ src/lib/weaknesses.ts, src/app/api/insights/route.ts)
Mode: Operate. Assessed build: production bundle on localhost:3000.

## Design Health Score — 13/40 (Poor)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Bare "Loading insights…", no error state, no "as of" date |
| 2 | Match System / Real World | 2 | "avg loss 3683 cp" is undecodable; "Mistakes + blunders 1858" silently included `miss` |
| 3 | User Control and Freedom | 1 | No time window, filter, sort or drill-down; cannot exclude the 2019 games |
| 4 | Consistency and Standards | 2 | "endgame" vs "Endgame"; cp shown inconsistently; opening column printed "B06 B06" |
| 5 | Error Prevention | 1 | 27 of 30 opening rows had ≤2 games and printed 100%/0% as fact |
| 6 | Recognition Rather Than Recall | 1 | Rotated motif labels, no legend, no definition of "tactical"/"hung piece" |
| 7 | Flexibility and Efficiency | 1 | All-time-everything; no recent-form view, no comparison period, no keyboard path |
| 8 | Aesthetic and Minimalist Design | 2 | Table was 55% of the page; the trend's 0–100 domain wasted half the plot |
| 9 | Error Recovery | 0 | `fetch` had no `.catch` and no `res.ok`: an API failure meant permanent "Loading insights…" |
| 10 | Help and Documentation | 1 | cp, phase rule, the <30s threshold and motif meanings all undefined |

## Design specificity verdict

Generic analytics dashboard wearing a chess vocabulary: six panels sharing one chrome, nothing primary, zero in-content links. Its single coaching claim — "weakest phase: endgame" — was computed from a mean that included mate scores and pointed at the wrong phase.

## Priority issues (as assessed)

**P0 — The screen was a dead end.** No in-content links; the weakness nomination and every motif were inert text.

**P0 — The phase verdict was built on a mate-score-corrupted mean.** `avgCpLoss` included mate scores (stored as ±100000 cp; observed max 101,065), so endgame won. Median loss, capped means, blunder rate and errors per 100 moves all said middlegame.

**P1 — The motif chart was led by the catch-all.** `tactical` = 1294 of 1858 tagged mistakes (69.6%) and rendered 153px tall while the three trainable motifs rendered 33/19/14px.

**P1 — Opening performance was 55% of the page and ~90% noise.** 30 rows, 27 with ≤2 games, 15 with exactly 1, printing 100% and 0% at full weight.

**P2 — Accessibility.** 43 text elements at 4.12:1; both charts `role="application"` with empty names and no data alternative, and per-point values reachable only by pointer.

**P2 — Measurement errors in the data layer.** The headline accuracy was move-weighted rather than per-game (84.8% vs the true 83.4%).

## Verified defects (browser evidence)

Charts had empty `aria-label`/`<title>`/`<desc>`; 6× ArrowRight on the focused SVG reproduced the same index-0 tooltip, so no per-point value was keyboard-reachable. No axis titles or units anywhere. The openings table was 475.8px inside a 324px scroll container on mobile: WIN % and AVG ACC. off-screen with no affordance. At 390px the rotated motif labels overlapped by 5.1px. Nav links were 32px tall; table rows 36.5px. `/api/insights` is 24KB and `/api/weaknesses` returns byte-identical JSON from the same `computeWeaknesses()`. Panels painted in 74.9ms (mobile) / 105.4ms (desktop) with no long tasks.

## Personas

- **Jordan:** "cp" five times, undefined; "11828 cp vs 2139 cp" undecodable; the only imperative text named the wrong phase.
- **Alex:** cannot sort openings, scope to recent games, or jump from a row to the games behind it; `gameId`, `mostCommonMotif`, `brilliant` and `great` were all in the payload and unused.
- **Sam:** 43 elements at 4.12:1; the only focusables after the nav were two unnamed `role="application"` SVGs.
- **Riley:** an API failure left the page loading forever.

## Fixes landed after this assessment

Both P0s and both P2s, plus the data-layer measurement errors:

- Phase ranking by error rate per 100 moves with median tiebreak, clamping mate-scale losses at 1000 cp. **weakestPhase is now middlegame** (36.0 errors/100, median 47cp, against 27.6/19 endgame and 13.1/17 opening) — matching the independent analysis.
- Accuracy is now averaged per game: **83.4%**, not 84.8%.
- A "what to work on next" opening panel naming the most trainable motif, with deep links into `/puzzles?theme=<motif>` (the puzzles screen reads that parameter), the weakest phase with its basis, the time verdict on medians, and what is working (engine matches and brilliancies).
- Motif chart: catch-all moved to a footnote, named motifs only, counts labelled on the bars, one colour, per-motif drill links. Both charts carry real `aria-label`s plus `accessibilityLayer`.
- Openings gated to 5+ games by default (8 rows from 30) with a "show all" toggle, "no signal" marks, and stacked rows on mobile.
- Trend charts the last 40 games with a 5-game rolling average, a recent-10 vs prior-10 delta and a [50,100] domain.
- Contrast 3.9:1 → **7.92:1** on the previously failing elements; `res.ok` + catch + retry replaces the infinite loading state.

Still open: no time-window scope (last N games / this month), no sortable openings or colour/phase filters, the colour-performance null result (45% vs 46%) is unlabelled, nav links are 40px rather than 44px, no sr-only data table behind the charts, and `/api/weaknesses` remains a byte-identical duplicate of `/api/insights` with no UI caller.
