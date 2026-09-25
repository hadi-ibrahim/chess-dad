# Concepts

* [Coaching rules](coaching-rules.md) — how the coach turns engine truth into tier-appropriate, plain-language lessons.
* [AI providers](ai-providers.md) — how a profile adds its own AI coach, where the key lives, and the guards on the request.
* [Move classification](move-classification.md) — the labels applied to every move, from book to blunder.
* [Weakness definitions](weakness-definitions.md) — the recurring-mistake categories the app profiles.
* [Tactical motifs](tactical-motifs.md) — the pattern taxonomy used to tag personal puzzles.
* [Accuracy](accuracy.md) — how game accuracy is computed.
* [Spaced repetition](spaced-repetition.md) — how personal puzzles are scheduled for review.
* [Job queue](job-queue.md) — the durable typed job queue and worker pool behind imports and analysis.
* [Game import](game-import.md) — fetching and parsing Lichess/Chess.com games, rate limits, and move formats.
* [Persistence](persistence.md) — the local-first SQLite data model.
* [Games browser](games-browser.md) — how the library is searched, filtered, and paginated.
* [Review screen](review-screen.md) — how the per-game review flags critical moves and separates your mistakes from your opponent's.
* [Openings screen](openings-screen.md) — how the trainer steps and practises a line, and how it tells a real deviation from running out of theory.
* [Puzzles screen](puzzles-screen.md) — how the training screen filters drills by motif, hints in two stages, and credits assisted solves.
* [Profiles screen](profiles-screen.md) — how a person's chess stays theirs without accounts: profiles live in the browser, games are filed by account, and the server remembers nobody.
* [Lessons screen](lessons-screen.md) — how the beginner lessons teach the basics of chess, one short lesson and one verified puzzle at a time.
* [Operations](operations.md) — startup, health, logs, backups and the deployment invariants, and the failure each one exists to catch.
