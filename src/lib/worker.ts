import "server-only";
import { config } from "./config";
import { log, throttle } from "./log";
import { analyzeGame } from "./analysis";
import { writeProgressBundle } from "./okf-progress";
import { listGameScopes } from "./db";
import {
  claimNextJob,
  completeJob,
  failJob,
  heartbeatJob,
  requeueOrphanedJobs,
  requeueStaleJobs,
  setJobProgress,
  type AnalyzePayload,
  type Job,
} from "./queue";

/**
 * The queue consumer.
 *
 * A pool of `workerConcurrency` loops claims jobs from the durable queue and
 * runs them. Only engine analysis is queued now: imports happen inside their own
 * request, because that is where the caller's Lichess token is available and
 * nowhere else. The CPU-heavy part happens in Stockfish child processes, so the
 * Node event loop — and therefore the HTTP server — stays responsive.
 */

const WORKER_ID = `w${process.pid}-${Math.random().toString(36).slice(2, 7)}`;

interface WorkerState {
  started: boolean;
  running: number;
  stop: boolean;
}

const globalForWorker = globalThis as unknown as { __chessdadWorker?: WorkerState };

function state(): WorkerState {
  if (!globalForWorker.__chessdadWorker) {
    globalForWorker.__chessdadWorker = { started: false, running: 0, stop: false };
  }
  return globalForWorker.__chessdadWorker;
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

/**
 * Start the consumer pool. Idempotent, so any request may call it.
 *
 * The web-only check lives here rather than at boot because every route that
 * enqueues work also calls this: checking it only in `instrumentation-node.ts`
 * meant a `CHESSDAD_DISABLE_WORKER=1` replica still became a consumer the moment
 * anyone hit `/api/jobs`, `/api/jobs/status` or `/api/import` — and two replicas
 * stealing each other's leases is exactly what the flag exists to prevent.
 */
export function ensureWorkerStarted(): void {
  const s = state();
  if (s.started) return;
  if (process.env.CHESSDAD_DISABLE_WORKER === "1") return;
  s.started = true;
  s.stop = false;
  try {
    // Any 'running' row is orphaned in a fresh process — requeue immediately.
    const orphaned = requeueOrphanedJobs();
    // Safety net for anything past its lease.
    const stale = requeueStaleJobs();
    if (orphaned || stale) {
      log.warn("worker: recovered interrupted jobs", { orphaned, stale });
    }
  } catch (e) {
    log.error("worker: could not recover interrupted jobs", { err: e });
  }
  log.info("worker: pool starting", { slots: config.workerConcurrency, pollMs: config.workerPollMs });
  for (let slot = 1; slot <= config.workerConcurrency; slot++) {
    // `loop` handles its own failures; this catch is the last resort so a bug in
    // the loop cannot become an unhandled rejection that kills the server.
    void loop(slot).catch((e) => {
      state().started = false;
      log.error("worker: loop exited unexpectedly", { slot, err: e });
    });
  }
}

async function loop(slot: number): Promise<void> {
  const s = state();
  const workerId = `${WORKER_ID}#${slot}`;

  for (;;) {
    if (s.stop) {
      log.info("worker: loop stopping", { slot });
      return;
    }

    let job: Job | null = null;
    try {
      job = claimNextJob(workerId, config.jobLeaseMs);
    } catch (e) {
      job = null;
      if (throttle("worker:claim-failed")) {
        log.error("worker: could not claim a job", { err: e });
      }
    }
    if (!job) {
      await sleep(config.workerPollMs);
      continue;
    }

    const claimed = job;
    const started = Date.now();
    const gameId = (claimed.payload as unknown as AnalyzePayload).gameId;
    s.running += 1;

    const heart = setInterval(() => {
      try {
        heartbeatJob(claimed.id, config.jobLeaseMs);
      } catch (e) {
        // Losing the lease means another worker can steal this job mid-run, so
        // this is worth surfacing rather than swallowing.
        if (throttle(`worker:heartbeat:${claimed.id}`)) {
          log.error("worker: lease heartbeat failed", { jobId: claimed.id, err: e });
        }
      }
    }, Math.max(5_000, Math.floor(config.jobLeaseMs / 3)));

    log.info("worker: job started", {
      jobId: claimed.id,
      type: claimed.type,
      gameId,
      attempt: claimed.attempts,
      running: s.running,
    });

    try {
      const result = await runJob(claimed);
      completeJob(claimed.id, result);
      log.info("worker: job done", {
        jobId: claimed.id,
        type: claimed.type,
        gameId,
        ms: Date.now() - started,
        result,
      });
      // Keep the OKF progress documents in step with the library. Progress is per
      // account, and a game can sit in more than one account's library, so every
      // library it touches is refreshed.
      try {
        for (const scope of listGameScopes(gameId)) writeProgressBundle(scope);
      } catch (e) {
        // knowledge emission must never fail a job
        if (throttle("worker:progress-bundle")) {
          log.warn("worker: could not write the OKF progress bundle", { gameId, err: e });
        }
      }
    } catch (e) {
      try {
        failJob(claimed.id, (e as Error).message);
        const willRetry = claimed.attempts < claimed.max_attempts;
        log.error("worker: job failed", {
          jobId: claimed.id,
          type: claimed.type,
          gameId,
          ms: Date.now() - started,
          attempt: claimed.attempts,
          maxAttempts: claimed.max_attempts,
          willRetry,
          err: e,
        });
      } catch (inner) {
        log.error("worker: could not record a job failure", { jobId: claimed.id, err: inner });
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
