# Update Log

## 2026-09-22
* **Creation**: initial ChessMentor knowledge bundle — coaching rules, move classification, weakness definitions, tactical motifs, accuracy metric, spaced repetition, and opening entities.
* **Update**: added the analysis-queue concept (now [Job queue](concepts/job-queue.md)) after analysis moved to a durable job queue consumed by a background worker pool.
* **Update**: added [Game import](concepts/game-import.md) documenting Lichess/Chess.com fetching, rate limits and tokens, and SAN/UCI move handling.
* **Update**: added [Persistence](concepts/persistence.md) documenting the local-first SQLite data model.
* **Update**: the analysis-only queue became a general typed [Job queue](concepts/job-queue.md) — imports and analysis now share one worker pool, with imports claimed first and optionally chaining into analysis.
* **Update**: added [Games browser](concepts/games-browser.md) — the library is now searched, filtered, and paginated server-side.
