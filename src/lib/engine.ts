import "server-only";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { config } from "./config";
import type { EngineEval } from "./types";

/** Centipawn value used to encode mate scores so they sort above any cp. */
export const MATE_SCORE = 100_000;

export function mateToCp(m: number): number {
  // +N = side to move mates in N; -N = side to move is mated in N.
  return m > 0 ? MATE_SCORE - Math.abs(m) : -MATE_SCORE + Math.abs(m);
}

function parseToken(line: string, token: string): number | null {
  const re = new RegExp(`\\b${token}\\s+(-?\\d+)`);
  const m = line.match(re);
  return m ? parseInt(m[1], 10) : null;
}

function parsePv(line: string): string[] {
  const idx = line.indexOf(" pv ");
  if (idx === -1) return [];
  return line.slice(idx + 4).trim().split(/\s+/);
}

interface Waiter {
  resolve: (r: EngineEval) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * A minimal, serialized UCI wrapper around a single Stockfish process.
 *
 * `score cp` / `score mate` are reported from the side-to-move's perspective,
 * which is the convention the rest of the analysis pipeline relies on.
 */
class StockfishEngine {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private ready: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private waiter: Waiter | null = null;
  private lastBest: EngineEval | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      const proc = spawn(config.stockfishPath, [], { stdio: ["pipe", "pipe", "pipe"] });
      this.proc = proc;
      proc.stdout.on("data", (d: Buffer) => this.onData(d.toString()));
      proc.stderr.on("data", () => {});
      proc.on("error", (e) => {
        this.failCurrent(new Error(`Stockfish failed to start: ${e.message}`));
        reject(e);
      });
      proc.on("exit", (code) => {
        this.failCurrent(new Error(`Stockfish exited (code ${code})`));
        this.proc = null;
        this.ready = null;
        this.readyResolve = null;
      });
      proc.stdin.write(
        `uci\nsetoption name Threads value ${config.engineThreads}\n` +
          `setoption name Hash value ${config.engineHashMb}\nisready\n`
      );
    });
    return this.ready;
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      this.onLine(line);
    }
  }

  private onLine(line: string): void {
    if (line === "readyok") {
      if (this.readyResolve) {
        this.readyResolve();
        this.readyResolve = null;
      }
      return;
    }
    if (line.startsWith("bestmove ")) {
      const move = (line.split(/\s+/)[1] || "").trim();
      const best = this.lastBest;
      if (this.waiter && best) {
        const w = this.waiter;
        this.waiter = null;
        clearTimeout(w.timer);
        w.resolve({ ...best, bestMove: move });
      }
      return;
    }
    if (line.startsWith("info ")) {
      const depth = parseToken(line, "depth");
      const mate = parseToken(line, "mate");
      const cp = parseToken(line, "cp");
      if (depth !== null && (mate !== null || cp !== null)) {
        if (!this.lastBest || depth >= this.lastBest.depth) {
          this.lastBest = {
            bestMove: "",
            scoreCp: mate !== null ? mateToCp(mate) : (cp ?? 0),
            mate,
            pv: parsePv(line),
            depth,
          };
        }
      }
    }
  }

  private failCurrent(e: Error): void {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      clearTimeout(w.timer);
      w.reject(e);
    }
  }

  analyze(fen: string, depth: number): Promise<EngineEval> {
    const run = () =>
      new Promise<EngineEval>((resolve, reject) => {
        void this.start().catch(reject);
        if (!this.proc) {
          reject(new Error("Stockfish process unavailable"));
          return;
        }
        this.lastBest = null;
        const timer = setTimeout(() => {
          if (this.waiter) {
            this.waiter = null;
            reject(new Error(`Stockfish analysis timed out at depth ${depth}`));
          }
        }, config.engineTimeoutMs);
        this.waiter = { resolve, reject, timer };
        this.proc.stdin.write(`position fen ${fen}\ngo depth ${depth}\n`);
      });

    // Serialize all analyses through a single process.
    const result = this.chain.then(run, run);
    this.chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

let engine: StockfishEngine | null = null;

/** A shared, lazily-created single engine (used by low-volume callers). */
export function getEngine(): StockfishEngine {
  if (!engine) engine = new StockfishEngine();
  return engine;
}

/**
 * A fixed-size pool of Stockfish processes.
 *
 * Each concurrent game analysis checks out one engine for its entire run, so
 * the worker pool gets real parallelism instead of serialising on one process.
 */
class EnginePool {
  private all: StockfishEngine[] = [];
  private idle: StockfishEngine[] = [];
  private waiters: ((e: StockfishEngine) => void)[] = [];

  constructor(private readonly size: number) {}

  acquire(): Promise<StockfishEngine> {
    const free = this.idle.pop();
    if (free) return Promise.resolve(free);
    if (this.all.length < this.size) {
      const created = new StockfishEngine();
      this.all.push(created);
      return Promise.resolve(created);
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release(engine: StockfishEngine): void {
    const waiting = this.waiters.shift();
    if (waiting) waiting(engine);
    else this.idle.push(engine);
  }
}

const globalForPool = globalThis as unknown as { __chessmentorEnginePool?: EnginePool };

function getPool(): EnginePool {
  if (!globalForPool.__chessmentorEnginePool) {
    globalForPool.__chessmentorEnginePool = new EnginePool(config.enginePoolSize);
  }
  return globalForPool.__chessmentorEnginePool;
}

/** Check out an engine for the duration of `fn`, then return it to the pool. */
export async function withEngine<T>(fn: (engine: StockfishEngine) => Promise<T>): Promise<T> {
  const pool = getPool();
  const engine = await pool.acquire();
  try {
    return await fn(engine);
  } finally {
    pool.release(engine);
  }
}

export type { StockfishEngine };
