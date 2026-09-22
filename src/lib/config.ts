import "server-only";
import path from "node:path";

export type LLMProvider = "deepseek" | "ollama" | "off";

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Central, server-only configuration. Every value can be overridden via
 * environment variables (see `.env.example`). Secrets never reach the client.
 */
export const config = {
  dataDir: process.env.CHESSMENTOR_DATA_DIR || path.join(process.cwd(), "data"),
  dbPath: process.env.CHESSMENTOR_DB_PATH || path.join(process.cwd(), "data", "chessmentor.db"),

  // Engine
  stockfishPath: process.env.STOCKFISH_PATH || "stockfish",
  analysisDepth: num(process.env.ANALYSIS_DEPTH, 14),
  engineTimeoutMs: num(process.env.ENGINE_TIMEOUT_MS, 60_000),

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
