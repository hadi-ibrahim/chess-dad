---
target: openings trainer
total_score: 13
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
target_identity: "file:/Users/hibrahim/dev/chessdad/src/app/openings/page.tsx"
target_fingerprint: "sha256:bc31e4f1f4f3020215cd196ad35a42e70cfb89a1ed96288a1b3c7018d798b824"
target_path: /Users/hibrahim/dev/chessdad/src/app/openings/page.tsx
timestamp: 2026-09-23T15-07-35Z
slug: src-app-openings-page-tsx
---
# Impeccable critique — ChessMentor opening trainer (`/openings`)

Method: degraded for assessment B — dual-agent run (A: 527313c8 design review · B: 0a1713f0 detector + browser evidence), but B had not returned when this snapshot was written, so the fixes below were verified with the parent's own CDP instrumentation. Assessment A completed against the live build.
Target: `src/app/openings/page.tsx` (+ src/lib/openings.ts, src/components/ChessBoard.tsx)
Mode: Operate. Assessed build: production bundle on localhost:3000, before commit 51c3c49.

## Design Health Score — 13/40 (Poor)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | No opening name, move number or turn in the working column; no line-complete state |
| 2 | Match System / Real World | 1 | One scripted line per opening; "left theory" fired when the array simply ended |
| 3 | User Control and Freedom | 1 | Practice mode's only control was Reset; no undo, side switch or show-line |
| 4 | Consistency and Standards | 1 | The shared board's click/Enter path was not wired here; headings used zinc-500 |
| 5 | Error Prevention | 1 | 1-ply and 2-ply openings offered a Black drill with nothing to answer; deviations were irrevocable |
| 6 | Recognition Rather Than Recall | 2 | Desktop spoiled the whole line; below 768px the line was hidden entirely |
| 7 | Flexibility and Efficiency | 1 | No search, filter, sort or keyboard; 25 rows in a 518px box |
| 8 | Aesthetic and Minimalist Design | 2 | Clean board and palette, but the training column never named what it was training |
| 9 | Error Recovery | 1 | The deviation sentence was right, but the board showed nothing and there was no retry |
| 10 | Help and Documentation | 1 | Only an external Wikipedia link; the okf opening notes never surfaced |

## Design specificity verdict

A generic board-with-a-list in chess vocabulary. The board itself is craft, but the page's model was a catalogue plus a string compare: it never built a repertoire, offered no alternatives, no queue, no memory, and had no link to the player's own games while the insights screen already knew their per-opening record.

## Priority issues (as assessed)

**P0 — "Leaving theory" fired when theory ran out, then dead-ended.** Verified: 3...d6 after the complete Italian C50 was scored as leaving theory; the 1-ply English A10 offered "Practise as Black" with zero trainable moves and then reported 1...e5 as a deviation with no expected move.

**P0 — No repertoire while the data existed one screen away.** Insights computed per-ECO games, results, win rate and accuracy, and had no link into the trainer; the trainer opened on A09 Réti regardless.

**P1 — Practice had no session UI.** The opening was never named outside the rail, there was no progress marker, and Reset was the only control.

**P1 — No hint, and a full spoiler at once.** Desktop showed the entire future line during practice; mobile hid it completely, so the same screen was simultaneously too easy and too hard.

**P2 — Scale, retrieval, contrast.** 25 ungrouped rows; ECO codes and section labels at 12px zinc-500 = 4.12:1 (below AA).

**P2 — Keyboard/touch parity.** Zero focusable squares although the shared board supports click/Enter-to-move; the transport was 35x32px with no accessible name.

## Fixes landed after this assessment (commit 51c3c49)

- **Three line states instead of two:** in theory (`n / total`), deviation (rose destination tint + `✗` badge, "You played d4; the line plays e4", with **Play it for me** and **Try again**), and line complete ("Line complete — 5/5 plies, no deviation" with **Practise again** / **Next opening**). Never a false deviation at the end of a line.
- **Unwinnable drills removed:** a line with no move for the chosen colour disables that button and says why (`?eco=A10` → English Opening, "Practise as Black" disabled).
- **Practice is a session:** the opening is named with ECO and colour, progress is `aria-live`, and the controls are Undo, a two-stage hint (amber origin, then green destination + arrow), Play it for me, Switch side and Reset.
- **No spoiler, no blindness:** the move list shows only the plies played while practising, and is visible at every width (it was `display:none` under 768px).
- **Keyboard and touch:** all 64 squares are focusable, so click and Tab+Enter play moves; transport buttons are labelled, 44px, and disabled at the ends; the rail gained search and row targets are 44px.
- **Cross-screen link:** `?eco=` opens a line, and every row of the insights opening table links into it.
- Contrast: labels moved to zinc-400.

Verified over CDP: deep link and disabled Black drill; full C50 line ends "Line complete — 5/5 plies, no deviation"; d4-instead-of-e4 produces the tint, badge, sentence and both recovery buttons; hint stage 1 rings e2, stage 2 tints e4 and draws one arrow; 64 focusable squares; mobile 358px board, line visible, 44px controls, no overflow.

## Still open

The theory set is one scripted line per opening, so "leaving theory" means "differs from the stored line" rather than "not played by masters"; opponent alternatives, a repertoire subset and a spaced-repetition queue for openings are unimplemented; the `ideas` field is never populated and `okf/entities/opening-*.md` are not surfaced; `POST /api/openings` duplicates deviation logic the screen does client-side; the rail is still a flat 25-row list (search added, grouping not).
