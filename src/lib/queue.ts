import "server-only";
import { getDb } from "./db";
import { config } from "./config";

/**
 * A durable analysis queue backed by SQLite.
 *
 * This is the message queue the API publishes to and the worker pool consumes
 * from. It is transactional, at-least-once, and survives restarts; jobs are
 * claimed under a lease so a crashed worker's job is retried. The interface is
 * deliberately small so the storage could be swapped for Redis/BullMQ later.
 */

export type JobStatus = "queued" | "running" | "done" | "failed" | "canceled";

export interface AnalysisJob {
  id: number;
  game_id: number;
  status: JobStatus;
  depth: number | null;
  explain: number;
  generate_puzzles: number;
  progress: number;
  stage: string | null;
  attempts: number;
  max_attempts: number;
  error: string | null;
  worker_id: string | null;
  leased_until: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface JobWithGame extends AnalysisJob {
  white: string;
  black: string;
  source: string;
  eco: string;
  opening_name: string;
}

export interface JobStats {
  jobs: { queued: number; running: number; done: number; failed: number; canceled: number };
  games: { total: number; analyzed: number; pending: number; empty: number };
  active: { id: number; gameId: number; progress: number; stage: string | null }[];
}

function toJob(r: Record<string, unknown>): AnalysisJob {
  return {
    id: Number(r.id),
    game_id: Number(r.game_id),
    status: r.status as JobStatus,
    depth: r.depth == null ? null : Number(r.depth),
    explain: Number(r.explain ?? 1),
    generate_puzzles: Number(r.generate_puzzles ?? 1),
    progress: Number(r.progress ?? 0),
    stage: r.stage == null ? null : String(r.stage),
    attempts: Number(r.attempts ?? 0),
    max_attempts: Number(r.max_attempts ?? 1),
    error: r.error == null ? null : String(r.error),
    worker_id: r.worker_id == null ? null : String(r.worker_id),
    leased_until: r.leased_until == null ? null : String(r.leased_until),
    created_at: String(r.created_at ?? ""),
    started_at: r.started_at == null ? null : String(r.started_at),
    finished_at: r.finished_at == null ? null : String(r.finished_at),
  };
}

export interface EnqueueOptions {
  depth?: number | null;
  explain?: boolean;
  generatePuzzles?: boolean;
  maxAttempts?: number;
}

/** Enqueue one analysis job per game, skipping games that already have an active job. */
export function enqueueJobs(
  gameIds: number[],
  opts: EnqueueOptions = {}
): { enqueued: number; skipped: number } {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO analysis_jobs (game_id, depth, explain, generate_puzzles, max_attempts)
     VALUES (?, ?, ?, ?, ?)`
  );
  const active = db.prepare(
    "SELECT 1 FROM analysis_jobs WHERE game_id = ? AND status IN ('queued','running') LIMIT 1"
  );

  let enqueued = 0;
  let skipped = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const gameId of gameIds) {
      if (active.get(gameId)) {
        skipped += 1;
        continue;
      }
      insert.run(
        gameId,
        opts.depth ?? null,
        opts.explain === false ? 0 : 1,
        opts.generatePuzzles === false ? 0 : 1,
        opts.maxAttempts ?? config.jobMaxAttempts
      );
      enqueued += 1;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { enqueued, skipped };
}

/** Atomically claim the oldest queued job, marking it running under a lease. */
export function claimNextJob(workerId: string, leaseMs: number): AnalysisJob | null {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare("SELECT id FROM analysis_jobs WHERE status = 'queued' ORDER BY id ASC LIMIT 1")
      .get() as { id: number } | undefined;
    if (!row) {
      db.exec("COMMIT");
      return null;
    }
    db.prepare(
      `UPDATE analysis_jobs
       SET status='running', worker_id=?, attempts=attempts+1,
           started_at=COALESCE(started_at, datetime('now')),
           leased_until=datetime('now', ?), progress=0, stage='queued', error=NULL
       WHERE id=?`
    ).run(workerId, `+${Math.ceil(leaseMs / 1000)} seconds`, row.id);
    const job = db.prepare("SELECT * FROM analysis_jobs WHERE id=?").get(row.id) as Record<string, unknown>;
    db.exec("COMMIT");
    return toJob(job);
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Renew the lease on a running job so it is not reclaimed as stale. */
export function heartbeatJob(id: number, leaseMs: number): void {
  getDb()
    .prepare("UPDATE analysis_jobs SET leased_until=datetime('now', ?) WHERE id=? AND status='running'")
    .run(`+${Math.ceil(leaseMs / 1000)} seconds`, id);
}

export function setJobProgress(id: number, progress: number, stage: string): void {
  getDb()
    .prepare("UPDATE analysis_jobs SET progress=?, stage=?, leased_until=datetime('now', ?) WHERE id=?")
    .run(Math.max(0, Math.min(1, progress)), stage, `+${Math.ceil(config.jobLeaseMs / 1000)} seconds`, id);
}

export function completeJob(id: number): void {
  getDb()
    .prepare(
      `UPDATE analysis_jobs
       SET status='done', progress=1, stage='done', finished_at=datetime('now'),
           error=NULL, worker_id=NULL, leased_until=NULL
       WHERE id=?`
    )
    .run(id);
}

/** Record a failure; retry while attempts remain, otherwise mark failed. */
export function failJob(id: number, error: string): void {
  const db = getDb();
  const j = db.prepare("SELECT attempts, max_attempts FROM analysis_jobs WHERE id=?").get(id) as
    | { attempts: number; max_attempts: number }
    | undefined;
  if (!j) return;
  const canRetry = Number(j.attempts) < Number(j.max_attempts);
  const message = error.slice(0, 800);
  if (canRetry) {
    db.prepare(
      `UPDATE analysis_jobs
       SET status='queued', error=?, stage='retrying', progress=0,
           worker_id=NULL, leased_until=NULL
       WHERE id=?`
    ).run(message, id);
  } else {
    db.prepare(
      `UPDATE analysis_jobs
       SET status='failed', error=?, stage='failed', finished_at=datetime('now'),
           worker_id=NULL, leased_until=NULL
       WHERE id=?`
    ).run(message, id);
  }
}

/**
 * Reset jobs left 'running' by a previous process. The worker runs in-process,
 * so at startup any 'running' row is orphaned and safe to requeue immediately
 * (rather than waiting out its lease).
 */
export function requeueOrphanedJobs(): number {
  const info = getDb()
    .prepare(
      `UPDATE analysis_jobs
       SET status = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'failed' END,
           stage = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'failed' END,
           error = CASE WHEN attempts < max_attempts THEN NULL ELSE 'interrupted by restart' END,
           finished_at = CASE WHEN attempts < max_attempts THEN NULL ELSE datetime('now') END,
           worker_id = NULL, leased_until = NULL, progress = 0,
           -- A restart is not a failure: don't spend a retry attempt on it.
           attempts = MAX(0, attempts - 1)
       WHERE status = 'running'`
    )
    .run();
  return Number(info.changes);
}

/** Requeue jobs whose worker died (lease expired). Returns how many were reclaimed. */
export function requeueStaleJobs(): number {
  const db = getDb();
  const expired = db
    .prepare(
      `SELECT id FROM analysis_jobs
       WHERE status='running' AND (leased_until IS NULL OR leased_until < datetime('now'))`
    )
    .all() as { id: number }[];
  for (const r of expired) {
    db.prepare(
      `UPDATE analysis_jobs
       SET status = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'failed' END,
           error = COALESCE(error, 'worker lease expired'),
           stage = CASE WHEN attempts < max_attempts THEN 'retrying' ELSE 'failed' END,
           finished_at = CASE WHEN attempts < max_attempts THEN NULL ELSE datetime('now') END,
           worker_id = NULL, leased_until = NULL, progress = 0
       WHERE id = ?`
    ).run(r.id);
  }
  return expired.length;
}

/** Cancel everything still queued (running jobs finish on their own). */
export function cancelQueuedJobs(): number {
  const info = getDb()
    .prepare(
      `UPDATE analysis_jobs
       SET status='canceled', stage='canceled', finished_at=datetime('now')
       WHERE status='queued'`
    )
    .run();
  return Number(info.changes);
}

/** Put failed jobs back on the queue. */
export function retryFailedJobs(): number {
  const info = getDb()
    .prepare(
      `UPDATE analysis_jobs
       SET status='queued', error=NULL, stage='queued', progress=0, attempts=0,
           finished_at=NULL, worker_id=NULL, leased_until=NULL
       WHERE status='failed'`
    )
    .run();
  return Number(info.changes);
}

/** Delete finished jobs so the queue view stays tidy. */
export function clearFinishedJobs(): number {
  const info = getDb()
    .prepare("DELETE FROM analysis_jobs WHERE status IN ('done','canceled')")
    .run();
  return Number(info.changes);
}

export function getJobStats(): JobStats {
  const db = getDb();
  const rows = db.prepare("SELECT status, COUNT(*) AS c FROM analysis_jobs GROUP BY status").all() as {
    status: string;
    c: number;
  }[];
  const by: Record<string, number> = {};
  for (const r of rows) by[r.status] = Number(r.c);

  const g = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN analyzed=1 THEN 1 ELSE 0 END) AS analyzed,
         SUM(CASE WHEN analyzed=0 AND total_plies>0 THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN total_plies=0 THEN 1 ELSE 0 END) AS empty
       FROM games`
    )
    .get() as Record<string, unknown>;

  const active = db
    .prepare(
      "SELECT id, game_id, progress, stage FROM analysis_jobs WHERE status='running' ORDER BY id LIMIT 12"
    )
    .all() as Record<string, unknown>[];

  return {
    jobs: {
      queued: by.queued ?? 0,
      running: by.running ?? 0,
      done: by.done ?? 0,
      failed: by.failed ?? 0,
      canceled: by.canceled ?? 0,
    },
    games: {
      total: Number(g.total ?? 0),
      analyzed: Number(g.analyzed ?? 0),
      pending: Number(g.pending ?? 0),
      empty: Number(g.empty ?? 0),
    },
    active: active.map((r) => ({
      id: Number(r.id),
      gameId: Number(r.game_id),
      progress: Number(r.progress ?? 0),
      stage: r.stage == null ? null : String(r.stage),
    })),
  };
}

export function listJobs(filter: { status?: JobStatus; gameId?: number; limit?: number } = {}): JobWithGame[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.status) {
    where.push("j.status = ?");
    params.push(filter.status);
  }
  if (filter.gameId != null) {
    where.push("j.game_id = ?");
    params.push(filter.gameId);
  }
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const sql =
    `SELECT j.*, g.white, g.black, g.source, g.eco, g.opening_name
     FROM analysis_jobs j JOIN games g ON g.id = j.game_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY j.id DESC LIMIT ${limit}`;
  return (getDb().prepare(sql).all(...params) as Record<string, unknown>[]).map((r) => ({
    ...toJob(r),
    white: String(r.white ?? ""),
    black: String(r.black ?? ""),
    source: String(r.source ?? ""),
    eco: String(r.eco ?? ""),
    opening_name: String(r.opening_name ?? ""),
  }));
}

export function getActiveJobForGame(gameId: number): AnalysisJob | null {
  const r = getDb()
    .prepare(
      "SELECT * FROM analysis_jobs WHERE game_id=? AND status IN ('queued','running') ORDER BY id DESC LIMIT 1"
    )
    .get(gameId);
  return r ? toJob(r as Record<string, unknown>) : null;
}
