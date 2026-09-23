# Update Log

## 2026-09-22
* **Creation**: initial ChessMentor knowledge bundle — coaching rules, move classification, weakness definitions, tactical motifs, accuracy metric, spaced repetition, and opening entities.
* **Update**: added the analysis-queue concept (now [Job queue](concepts/job-queue.md)) after analysis moved to a durable job queue consumed by a background worker pool.
* **Update**: added [Game import](concepts/game-import.md) documenting Lichess/Chess.com fetching, rate limits and tokens, and SAN/UCI move handling.
* **Update**: added [Persistence](concepts/persistence.md) documenting the local-first SQLite data model.
* **Update**: the analysis-only queue became a general typed [Job queue](concepts/job-queue.md) — imports and analysis now share one worker pool, with imports claimed first and optionally chaining into analysis.
* **Update**: added [Games browser](concepts/games-browser.md) — the library is now searched, filtered, and paginated server-side.

## 2026-09-23
* **Update**: code sync — corrected move-classification thresholds and evaluation order, the engine-detected [tactical motif](concepts/tactical-motifs.md) tags, weakness-profiling details, [job-queue](concepts/job-queue.md) defaults and control routes, SM-2 clamps, import limits, and pagination bounds against the source.
* **Update**: added [Review screen](concepts/review-screen.md) documenting critical-moment flagging (`is_critical === 1`), the split between your mistakes and chances to punish, the coach panel showing the position before the move, and the annotation glyphs (?? blunder, ? mistake, ?! inaccuracy, !? miss, !! brilliant) shown with colour, never colour alone.
* **Update**: added [Puzzles screen](concepts/puzzles-screen.md) and the assisted-solve rule in [Spaced repetition](concepts/spaced-repetition.md) — the training screen now filters drills by motif, hints in two stages (which piece, then where), marks a wrong attempt on the board, and counts a hinted or revealed solve as a miss so the position returns sooner.
* **Update**: [Puzzles screen](concepts/puzzles-screen.md) gained the play-out of the cached engine line after a drill is resolved, and the whole library's coaching text was regenerated against the corrected `The pattern was ...` template plus the sign-aware context clause (2,155 positions across 232 games; the stale "involved a" sentences are gone).
* **Update**: [Insights](concepts/weakness-definitions.md) now ranks phases by error rate per 100 moves with median loss as the tiebreak, clamps mate-scale losses at 1000 cp before averaging, and averages accuracy per game rather than per move. The dashboard leads with a "what to work on next" panel that links each named motif into a pre-filtered puzzle set.

