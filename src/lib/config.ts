import "server-only";
import os from "node:os";
import path from "node:path";

export type LLMProvider = "deepseek" | "ollama" | "off";

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const cpus = os.cpus().length || 4;
const defaultConcurrency = Math.min(4, Math.max(1, cpus - 1));

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
  enginePoolSize: num(process.env.ENGINE_POOL_SIZE, defaultConcurrency + 1),

  // Analysis worker (the queue consumer)
  workerConcurrency: num(process.env.WORKER_CONCURRENCY, defaultConcurrency),
  workerPollMs: num(process.env.WORKER_POLL_MS, 750),
  jobLeaseMs: num(process.env.JOB_LEASE_MS, 120_000),
  jobMaxAttempts: num(process.env.JOB_MAX_ATTEMPTS, 2),

  // Import
  maxGamesPerSource: num(process.env.MAX_GAMES_PER_SOURCE, 100),
  lichessToken: process.env.LICHESS_TOKEN || "",

  // LLM
  llmProvider: (process.env.LLM_PROVIDER || "off") as LLMProvider,
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
  deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  deepseekBaseUrl: (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, ""),
  ollamaBaseUrl: (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/+$/, ""),
  ollamaModel: process.env.OLLAMA_MODEL || "gemma4",
  llmTimeoutMs: num(process.env.LLM_TIMEOUT_MS, 30_000),

  // OKF knowledge base
  okfDir: path.join(process.cwd(), "okf"),
};

export type AppConfig = typeof config;
