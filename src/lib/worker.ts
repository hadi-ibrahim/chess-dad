import "server-only";
import { config } from "./config";
import { analyzeGame } from "./analysis";
import { importLichess } from "./importers/lichess";
import { importChessCom } from "./importers/chesscom";
import { writeProgressBundle } from "./okf-progress";
import { filterUnanalyzedWithMoves, getSetting } from "./db";
import {
  claimNextJob,
  completeJob,
  enqueueAnalyzeJobs,
  failJob,
  heartbeatJob,
  requeueOrphanedJobs,
  requeueStaleJobs,
  setJobProgress,
  type AnalyzePayload,
  type ImportPayload,
  type Job,
} from "./queue";

/**
 * The queue consumer.
 *
 * A pool of `workerConcurrency` loops claims jobs from the durable queue and
 * runs them. Jobs are typed: `import` fetches games from a site, `analyze` runs
 * the engine. The CPU-heavy part happens in Stockfish child processes, so the
 * Node event loop — and therefore the HTTP server — stays responsive.
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

function safeProgress(id: number, progress: number, stage: string): void {
  try {
    setJobProgress(id, progress, stage);
  } catch {
    // progress reporting must never fail a job
  }
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

    let job: Job | null = null;
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
      const result = await runJob(claimed);
      completeJob(claimed.id, result);
      // Keep the OKF progress document in step with the library.
      try {
        writeProgressBundle();
      } catch {
        // knowledge emission must never fail a job
      }
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

function runJob(job: Job): Promise<Record<string, unknown>> {
  switch (job.type) {
    case "analyze":
      return runAnalyzeJob(job);
    case "import":
      return runImportJob(job);
    default:
      return Promise.reject(new Error(`Unknown job type: ${job.type}`));
  }
}

async function runAnalyzeJob(job: Job): Promise<Record<string, unknown>> {
  const p = job.payload as unknown as AnalyzePayload;
  if (!Number.isInteger(p?.gameId)) throw new Error("analyze job is missing a gameId");

  const result = await analyzeGame(p.gameId, {
    depth: p.depth ?? undefined,
    explain: p.explain !== false,
    generatePuzzles: p.generatePuzzles !== false,
    onProgress: ({ stage, progress }) => safeProgress(job.id, progress, stage),
  });
  return { ...result };
}

async function runImportJob(job: Job): Promise<Record<string, unknown>> {
  const p = job.payload as unknown as ImportPayload;
  if (!p?.source || !p.username) throw new Error("import job is missing source/username");

  const onProgress = (info: { stage: string; progress: number }) =>
    safeProgress(job.id, info.progress, info.stage);

  const result =
    p.source === "lichess"
      ? await importLichess(p.username, p.max, getSetting("lichess_token") || undefined, onProgress)
      : await importChessCom(p.username, p.max, onProgress);

  // Chain straight into analysis so an import is one action, not two.
  let analysisQueued = 0;
  if (p.analyzeAfter !== false && result.gameIds.length > 0) {
    const pending = filterUnanalyzedWithMoves(result.gameIds);
    analysisQueued = enqueueAnalyzeJobs(pending, {}).enqueued;
  }

  return {
    source: p.source,
    username: result.username,
    imported: result.count,
    analysisQueued,
  };
}

export function getWorkerState(): {
  started: boolean;
  running: number;
  concurrency: number;
  poolSize: number;
} {
  const s = state();
  return {
    started: s.started,
    running: s.running,
    concurrency: config.workerConcurrency,
    poolSize: config.enginePoolSize,
  };
}
