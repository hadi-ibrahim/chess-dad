# ChessMentor ♞

An open-source, local-first chess tutor. Connect your **Lichess** and
**Chess.com** accounts, import your games, analyze every move with **Stockfish**,
and get plain-language coaching that turns engine truth into lessons you can
actually use. Think of it as an open alternative to Game Review + Insights +
Coach — with **personalized puzzles built from your own mistakes**.

## What it does

| Feature | Description |
|---|---|
| **Game import** | Fetch your last N games from Lichess and Chess.com (public APIs, no key needed) into a local SQLite database. |
| **Engine analysis** | Replays every position through Stockfish (UCI), computes centipawn loss, and classifies each move. |
| **Move classification** | Book / forced / brilliant / best / great / good / inaccuracy / mistake / blunder / miss. |
| **Coach feedback** | 2–3 sentence explanations of your critical moments, calibrated to your rating, that *never* contradict the engine. |
| **Weakness profiling** | Aggregates tactical motifs, phase-specific errors, time management, opening performance, and color performance. |
| **Personal puzzles** | Turns your own worst mistakes into drills with spaced repetition (SM-2). |
| **Opening trainer** | Step through main lines or practice them — flags the moment you leave theory, with Wikipedia context. |
| **Insights dashboard** | Accuracy trend, weakness heatmap, opening table, and progress tracking. |
| **OKF knowledge base** | All coaching knowledge lives in a conformant [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) v0.2 bundle in [`okf/`](okf/). |

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript**
- **chess.js** (move validation / PGN / FEN) + **react-chessboard** (board UI)
- **Stockfish** (UCI child process) — the only evaluator
- **SQLite** via Node's built-in `node:sqlite` (zero external DB)
- **Recharts** for trends, **Tailwind CSS** for styling
- **LLM (optional)**: DeepSeek-V3.2 API, or any local model via Ollama. When no LLM is configured, explanations degrade to a deterministic coach grounded in the OKF bundle.

## Getting started

Prerequisites: **Node.js ≥ 22.13** (for `node:sqlite`) and a **Stockfish** binary.

```bash
# 1. Install dependencies
pnpm install

# 2. Install Stockfish (or point STOCKFISH_PATH at your own binary)
node scripts/setup-engine.mjs      # Homebrew on macOS; downloads a build on Linux

# 3. (Optional) configure an LLM — copy the example and edit
cp .env.example .env.local

# 4. Run
pnpm dev
```

Open http://localhost:3000, enter a Lichess or Chess.com username, import, then
hit **Analyze**.

## Configuration

All settings are environment variables (see [`.env.example`](.env.example)):

| Variable | Default | Purpose |
|---|---|---|
| `STOCKFISH_PATH` | `stockfish` | Path to the Stockfish binary |
| `ANALYSIS_DEPTH` | `14` | Engine depth per position (14 = fast, 18 = deep) |
| `MAX_GAMES_PER_SOURCE` | `100` | Games fetched per site |
| `LLM_PROVIDER` | `off` | `off` \| `deepseek` \| `ollama` |
| `DEEPSEEK_API_KEY` | — | Required when `LLM_PROVIDER=deepseek` |
| `OLLAMA_MODEL` | `gemma4` | Local model (a fine-tuned Qwen3 chess coach is ideal) |
| `LICHESS_TOKEN` | — | Optional; raises rate limits / enables private games |
| `WORKER_CONCURRENCY` | `min(4, cpus−1)` | Games analysed in parallel by the worker pool |
| `ENGINE_POOL_SIZE` | `WORKER_CONCURRENCY + 1` | Size of the Stockfish process pool |

## How the analysis works

1. **Replay** the game with chess.js to get the FEN before and after every move.
2. **Evaluate** each position with Stockfish. `score cp` is read from the
   side-to-move's perspective; mate scores are mapped to ±100000 cp.
3. **Centipawn loss** for a move by side S is `max(0, E_before − (−E_after))`.
4. **Classify** with the thresholds in
   [`okf/concepts/move-classification.md`](okf/concepts/move-classification.md).
5. **Coach** critical moments (cp loss > 100, or a missed mate/win) through the
   configured LLM — or the offline OKF-grounded fallback.
6. **Personalize** — mistakes become puzzles, aggregated into a weakness profile.

## Background analysis (queue + workers)

Analysis is asynchronous, so the app stays usable while your library is processed:

1. The UI **publishes** one job per game to a durable queue
   (`POST /api/analysis/jobs`) and returns immediately — no blocked request.
2. A **worker pool** (`WORKER_CONCURRENCY`, default `min(4, cpus−1)`) consumes the
   queue; each game checks out its own Stockfish process from an engine pool, so
   games analyse in parallel.
3. The UI **polls** `/api/analysis/status` and renders live progress. Pages stay
   responsive (a few milliseconds) throughout — roughly 40 games/minute on a
   12-core machine versus ~6 sequentially.

Jobs are transactional and leased, so a restart requeues anything interrupted;
failures retry automatically and are surfaced with a one-click retry. See
[`okf/concepts/analysis-queue.md`](okf/concepts/analysis-queue.md).

## Design principles

1. **Engine first, LLM second** — the model explains engine output; it never
   evaluates positions, so it can't hallucinate chess facts.
2. **Human review before engine review** — a per-game "Your notes" field invites
   you to annotate before you look at the engine.
3. **Pattern over incident** — value comes from recurring mistakes across many
   games, not one game in isolation.
4. **Local-first & private** — games and analysis live in a local SQLite file.
5. **Modular engine layer** — the engine wrapper is a thin UCI client; Lc0/Maia
   can be swapped in later (see `src/lib/engine.ts`).
6. **Cost-aware LLM** — explanations are cached by FEN, and bulk analysis uses
   the smallest model that produces acceptable text.
7. **Knowledge base in OKF** — coaching rules, weakness definitions, opening
   notes, and (per-user) progress are stored as an OKF bundle.

## Knowledge base (OKF)

The [`okf/`](okf/) directory is a conformant OKF v0.2 bundle — markdown with
YAML frontmatter, an `index.md`, and relative links. The app reads it (the
offline coach grounds its explanations in `okf/concepts/coaching-rules.md`) and
can write to it (per-user progress). Validate it anytime with:

```bash
uv run .claude/skills/validate/scripts/okf_validate.py okf --strict
# or: python3 .claude/skills/validate/scripts/okf_validate.py okf --strict
```

## Project layout

```
src/lib/            server logic: db, engine (UCI), analysis, llm, importers, weaknesses, puzzles, openings, okf
src/lib/importers/  Lichess + Chess.com game fetching/parsing
src/app/api/        route handlers: import, games, analyze, weaknesses, insights, puzzles, openings, okf
src/app/            pages: home, review/[id], insights, puzzles, openings, knowledge
src/components/     board, eval bar, eval graph, move list, nav, import form
okf/                Open Knowledge Format knowledge base
scripts/            setup-engine.mjs
```

## Roadmap

- **Phase 2**: Lc0/Maia "human-like" mode, deeper weakness heatmaps, opening
  repertoire builder, chat-based per-position Q&A, full ECO catalogue (12,379
  openings).
- **Phase 3**: parallel engine instances, LLM cache sharing, PGN export with
  annotations, community comparisons.

## Troubleshooting

* **"Lichess throttled the game export"** — Lichess limits *anonymous* game
  exports to a few requests per minute and can mask the throttle as a `404` even
  for valid accounts. Add a personal API token in the import form (or as
  `LICHESS_TOKEN` in `.env.local`); authenticated limits are several times
  higher. Create one at <https://lichess.org/account/oauth/token> — no scopes
  are needed to read public games.
* **Chess.com returns 403** — the Chess.com API requires a `User-Agent` header.
  ChessMentor sends one automatically, but a proxy that strips it will fail.

## License

MIT. Built on open components: Stockfish (GPLv3), chess.js (MIT), react-chessboard (MIT).
