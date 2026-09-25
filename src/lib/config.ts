import "server-only";
import os from "node:os";
import path from "node:path";

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const cpus = os.cpus().length || 4;
const defaultConcurrency = Math.min(4, Math.max(1, cpus - 1));
// Resolved before the config object because the engine pool derives from it. The
// pool used to be sized from the CPU count instead, so raising WORKER_CONCURRENCY
// left the extra workers blocking on a pool that had not grown with them.
const workerConcurrency = num(process.env.WORKER_CONCURRENCY, defaultConcurrency);

/**
 * Central, server-only configuration. Every value can be overridden via
 * environment variables (see `.env.example`). Secrets never reach the client.
 */
export const config = {
  dataDir: process.env.CHESSDAD_DATA_DIR || path.join(process.cwd(), "data"),
  dbPath: process.env.CHESSDAD_DB_PATH || path.join(process.cwd(), "data", "chessdad.db"),

  // Engine
  stockfishPath: process.env.STOCKFISH_PATH || "stockfish",
  analysisDepth: num(process.env.ANALYSIS_DEPTH, 14),
  engineTimeoutMs: num(process.env.ENGINE_TIMEOUT_MS, 60_000),
  engineThreads: num(process.env.ENGINE_THREADS, 2),
  engineHashMb: num(process.env.ENGINE_HASH_MB, 64),
  // Size of the Stockfish process pool. One engine is used per concurrent game.
  enginePoolSize: num(process.env.ENGINE_POOL_SIZE, workerConcurrency + 1),
  // How long an idle Stockfish process is kept before it is killed to give its
  // hash table back. 0 disables reaping (engines then live for the process).
  engineIdleMs: num(process.env.ENGINE_IDLE_MS, 5 * 60 * 1000),

  // Analysis worker (the queue consumer)
  workerConcurrency,
  workerPollMs: num(process.env.WORKER_POLL_MS, 750),
  jobLeaseMs: num(process.env.JOB_LEASE_MS, 120_000),
  jobMaxAttempts: num(process.env.JOB_MAX_ATTEMPTS, 2),
  // How many analysis jobs may wait at once. A public deployment otherwise lets
  // one importer fill the queue with everything they have and hold worker slots
  // for hours; past this, work is turned away and the caller is told, rather than
  // accepting jobs that will not run for a very long time.
  maxQueueDepth: num(process.env.MAX_QUEUE_DEPTH, 200),

  // Import
  maxGamesPerSource: num(process.env.MAX_GAMES_PER_SOURCE, 100),
  lichessToken: process.env.LICHESS_TOKEN || "",

  // AI coaching.
  //
  // There is deliberately no provider, model or API key here any more. A user
  // configures their own providers on the Profiles screen; the key lives in their
  // browser and rides one request, exactly like the Lichess token. The server
  // keeps no LLM secret, so there is nothing to leak from a deployment and no
  // operator bill to be surprised by.
  //
  // Two operational limits are left. A single provider call is capped by
  // `LLM_TIMEOUT_MS` — two minutes by default, because a reasoning model can
  // legitimately think for that long, and a connection may raise or lower it.
  // `LLM_BATCH_BUDGET_MS` bounds a whole request (one move, or every flagged move
  // in a game): once it is spent the route stops starting new calls and returns
  // the readings it already has, rather than being killed mid-game.
  llmTimeoutMs: num(process.env.LLM_TIMEOUT_MS, 120_000),
  llmBatchBudgetMs: num(process.env.LLM_BATCH_BUDGET_MS, 540_000),

  // OKF knowledge base
  okfDir: path.join(process.cwd(), "okf"),
};

export type AppConfig = typeof config;
