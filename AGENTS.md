<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# The knowledge base is `okf/` — read it before you change behaviour

This repository ships its knowledge base as an **Open Knowledge Format (OKF
v0.2)** bundle in `okf/`. It is hand-authored markdown with YAML frontmatter,
living next to the code, and it documents what the app actually *does* — the data
model, the job queue, move classification, the coaching rules, and one document
per screen.

**Start at [`okf/index.md`](okf/index.md).** It links everything else:

* `okf/concepts/` — how each part works: [move classification](okf/concepts/move-classification.md),
  [coaching rules](okf/concepts/coaching-rules.md), [accuracy](okf/concepts/accuracy.md),
  [weakness definitions](okf/concepts/weakness-definitions.md),
  [spaced repetition](okf/concepts/spaced-repetition.md),
  [job queue](okf/concepts/job-queue.md), [persistence](okf/concepts/persistence.md),
  [game import](okf/concepts/game-import.md), and one file per screen
  (games browser, review, puzzles, openings, profiles, lessons).
* `okf/entities/` — opening theory notes and tactical motif definitions.
* `okf/log.md` — the dated update log. **Read the tail first**: it is the fastest
  way to learn what changed recently and why.

This is not decoration. The bundle is genuinely cheaper to read than the source
for questions like "what does `is_critical` mean", "which table holds a person's
SM-2 state", or "what are the classification thresholds" — and it records the
*reasoning* behind decisions, which the code does not.

Two cautions:

1. A document with `status: draft`, a stale `updated` date, or no `sources` is a
   claim to check, not a fact. Verify against `src/` before relying on it, and
   treat a broken link as knowledge not yet written rather than an error.
2. `okf/progress/` is **runtime-generated** by `writeProgressBundle()` and
   gitignored. Never hand-edit it.

Do not confuse the bundle with the `/lessons` screen. The bundle teaches
*maintainers* how the app works; `/lessons` teaches *players* how to play chess.
They are separate audiences with separate content.

# When you change behaviour, update the bundle

Any change that alters documented behaviour — the data model, a screen, the reward
or scheduling rules, the job queue, the coach — should leave the bundle accurate:

1. Add or extend the relevant document in `okf/concepts/`.
2. Link it from `okf/concepts/index.md` if it is new.
3. Append a dated entry to `okf/log.md` under today's heading, saying what changed
   and why.

Match the existing frontmatter: `type`, `title`, `description`, `tags`, `status`,
`generated`/`updated` stamped with an actor, and `sources` naming the files a claim
came from (for example `src/lib/queue.ts`). Note there is **no generator and no
validator script in this repository** — unlike some OKF bundles you may have seen —
so these documents are hand-maintained and their accuracy is on you. Never write a
number into the bundle that you have not read out of the code.

