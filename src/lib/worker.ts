import "server-only";
import { config } from "./config";
import { analyzeGame } from "./analysis";
import {
  claimNextJob,
  completeJob,
  failJob,
  heartbeatJob,
  requeueOrphanedJobs,
  requeueStaleJobs,
  setJobProgress,
  type AnalysisJob,
} from "./queue";

/**
 * The queue consumer.
 *
 * A pool of `workerConcurrency` loops claims jobs from the durable queue and
 * runs the analysis. The CPU-heavy work happens in Stockfish child processes,
 * so the Node event loop — and therefore the HTTP server — stays responsive
 * while hundreds of games are processed.
 */

const WORKER_ID = `w${process.pid}-${Math.random().toString(36).slice(2, 7)}`;

interface WorkerState {
  started: boolean;
  running: number;
  stop: boolean;
}

const globalForWorker = globalThis as unknown as { __chessmentorWorker?: WorkerState };

function state(): WorkerState {
  if (!globalForWorker.__chessmentorWorker) {
    globalForWorker.__chessmentorWorker = { started: false, running: 0, stop: false };
  }
  return globalForWorker.__chessmentorWorker;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Start the consumer pool. Idempotent, so any request may call it. */
export function ensureWorkerStarted(): void {
  const s = state();
  if (s.started) return;
  s.started = true;
  s.stop = false;
  try {
    // Any 'running' row is orphaned in a fresh process — requeue immediately.
    requeueOrphanedJobs();
    // Safety net for anything past its lease.
    requeueStaleJobs();
  } catch {
    // non-fatal
  }
  for (let slot = 1; slot <= config.workerConcurrency; slot++) {
    void loop(slot);
  }
}

async function loop(slot: number): Promise<void> {
  const s = state();
  const workerId = `${WORKER_ID}#${slot}`;

  for (;;) {
    if (s.stop) return;

    let job: AnalysisJob | null = null;
    try {
      job = claimNextJob(workerId, config.jobLeaseMs);
    } catch {
      job = null;
    }
    if (!job) {
      await sleep(config.workerPollMs);
      continue;
    }

    const claimed = job;
    s.running += 1;
    const heart = setInterval(() => {
      try {
        heartbeatJob(claimed.id, config.jobLeaseMs);
      } catch {
        // non-fatal
      }
    }, Math.max(5_000, Math.floor(config.jobLeaseMs / 3)));

    try {
      await analyzeGame(claimed.game_id, {
        depth: claimed.depth ?? undefined,
        explain: claimed.explain === 1,
        generatePuzzles: claimed.generate_puzzles === 1,
        onProgress: ({ stage, progress }) => {
          try {
            setJobProgress(claimed.id, progress, stage);
          } catch {
            // non-fatal
          }
        },
      });
      completeJob(claimed.id);
    } catch (e) {
      try {
        failJob(claimed.id, (e as Error).message);
      } catch {
        // non-fatal
      }
    } finally {
      clearInterval(heart);
      s.running -= 1;
    }
  }
}

export function getWorkerState(): { started: boolean; running: number; concurrency: number; poolSize: number } {
  const s = state();
  return {
    started: s.started,
    running: s.running,
    concurrency: config.workerConcurrency,
    poolSize: config.enginePoolSize,
  };
}
