import "server-only";
import { getDb } from "./db";
import { config } from "./config";

/**
 * A durable, typed job queue backed by SQLite.
 *
 * This is the message queue the API publishes to and the worker pool consumes
 * from. Jobs are transactional, at-least-once, and survive restarts; each is
 * claimed under a lease so a crashed worker's job is retried. The interface is
 * deliberately small so the storage could be swapped for Redis/BullMQ later.
 */

export type JobType = "analyze" | "import";
export type JobStatus = "queued" | "running" | "done" | "failed" | "canceled";

export interface AnalyzePayload {
  gameId: number;
  depth: number | null;
  explain: boolean;
  generatePuzzles: boolean;
}

export interface ImportPayload {
  source: "lichess" | "chesscom";
  username: string;
  /** Which library the fetched games belong to. */
  profileId: number;
  max: number;
  /** Queue analysis for the newly imported games once this job finishes. */
  analyzeAfter: boolean;
}

export interface Job {
  id: number;
  type: JobType;
  payload: Record<string, unknown>;
  label: string | null;
  priority: number;
  status: JobStatus;
  progress: number;
  stage: string | null;
  attempts: number;
  max_attempts: number;
  error: string | null;
  result: Record<string, unknown> | null;
  worker_id: string | null;
  leased_until: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface Counts {
  queued: number;
  running: number;
  done: number;
  failed: number;
  canceled: number;
}

export interface JobStats {
  jobs: Counts;
  byType: Record<string, Counts>;
  games: { total: number; analyzed: number; pending: number; empty: number };
  active: { id: number; type: JobType; label: string | null; progress: number; stage: string | null }[];
  /** Games with an analysis job queued or running, so the list can flag them. */
  queuedGameIds: number[];
}

export interface JobWithGame extends Job {
  white: string;
  black: string;
  source: string;
  eco: string;
  opening_name: string;
}

function zero(): Counts {
  return { queued: 0, running: 0, done: 0, failed: 0, canceled: 0 };
}

function parseJson(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toJob(r: Record<string, unknown>): Job {
  return {
    id: Number(r.id),
    type: r.type as JobType,
    payload: parseJson(r.payload) ?? {},
    label: r.label == null ? null : String(r.label),
    priority: Number(r.priority ?? 0),
    status: r.status as JobStatus,
    progress: Number(r.progress ?? 0),
    stage: r.stage == null ? null : String(r.stage),
    attempts: Number(r.attempts ?? 0),
    max_attempts: Number(r.max_attempts ?? 1),
    error: r.error == null ? null : String(r.error),
    result: parseJson(r.result),
    worker_id: r.worker_id == null ? null : String(r.worker_id),
    leased_until: r.leased_until == null ? null : String(r.leased_until),
    created_at: String(r.created_at ?? ""),
    started_at: r.started_at == null ? null : String(r.started_at),
    finished_at: r.finished_at == null ? null : String(r.finished_at),
  };
}

interface NewJob {
  type: JobType;
  payload: unknown;
  label: string;
  priority: number;
  maxAttempts?: number;
}

function insertJobs(rows: NewJob[]): number[] {
  if (rows.length === 0) return [];
  const db = getDb();
  const insert = db.prepare(
    "INSERT INTO jobs (type, payload, label, priority, max_attempts) VALUES (?, ?, ?, ?, ?)"
  );
  const ids: number[] = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const r of rows) {
      const info = insert.run(
        r.type,
        JSON.stringify(r.payload),
        r.label,
        r.priority,
        r.maxAttempts ?? config.jobMaxAttempts
      );
      ids.push(Number(info.lastInsertRowid));
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

export interface AnalyzeEnqueueOptions {
  depth?: number | null;
  explain?: boolean;
  generatePuzzles?: boolean;
}

/** Publish one analysis job per game, skipping games that already have an active job. */
export function enqueueAnalyzeJobs(
  gameIds: number[],
  opts: AnalyzeEnqueueOptions = {}
): { enqueued: number; skipped: number } {
  const db = getDb();
  const active = db.prepare(
    `SELECT 1 FROM jobs
     WHERE type='analyze' AND status IN ('queued','running')
       AND json_extract(payload, '$.gameId') = ? LIMIT 1`
  );
  const rows: NewJob[] = [];
  let skipped = 0;
  for (const gameId of gameIds) {
    if (active.get(gameId)) {
      skipped += 1;
      continue;
    }
    const payload: AnalyzePayload = {
      gameId,
      depth: opts.depth ?? null,
      explain: opts.explain !== false,
      generatePuzzles: opts.generatePuzzles !== false,
    };
    rows.push({ type: "analyze", payload, label: `game ${gameId}`, priority: 0 });
  }
  return { enqueued: insertJobs(rows).length, skipped };
}

/** Publish one import job for a profile. Skips a duplicate that is already pending. */
export function enqueueImportJob(
  source: "lichess" | "chesscom",
  username: string,
  max: number,
  profileId: number,
  opts: { analyzeAfter?: boolean } = {}
): { jobId: number | null; skipped: boolean } {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id FROM jobs
       WHERE type='import' AND status IN ('queued','running')
         AND json_extract(payload, '$.source') = ?
         AND lower(json_extract(payload, '$.username')) = lower(?)
         AND json_extract(payload, '$.profileId') = ?
       LIMIT 1`
    )
    .get(source, username, profileId) as { id: number } | undefined;
  if (existing) return { jobId: Number(existing.id), skipped: true };

  const payload: ImportPayload = {
    source,
    username,
    profileId,
    max,
    analyzeAfter: opts.analyzeAfter !== false,
  };
  // Imports are user-initiated, so they are claimed ahead of bulk analysis.
  const [id] = insertJobs([
    { type: "import", payload, label: `${source}: ${username}`, priority: 10 },
  ]);
  return { jobId: id ?? null, skipped: false };
}

// ---------------------------------------------------------------------------
// Consuming
// ---------------------------------------------------------------------------

/** Atomically claim the highest-priority queued job, under a lease. */
export function claimNextJob(workerId: string, leaseMs: number): Job | null {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare("SELECT id FROM jobs WHERE status='queued' ORDER BY priority DESC, id ASC LIMIT 1")
      .get() as { id: number } | undefined;
    if (!row) {
      db.exec("COMMIT");
      return null;
    }
    db.prepare(
      `UPDATE jobs
       SET status='running', worker_id=?, attempts=attempts+1,
           started_at=COALESCE(started_at, datetime('now')),
           leased_until=datetime('now', ?), progress=0, stage='queued', error=NULL
       WHERE id=?`
    ).run(workerId, `+${Math.ceil(leaseMs / 1000)} seconds`, row.id);
    const job = db.prepare("SELECT * FROM jobs WHERE id=?").get(row.id) as Record<string, unknown>;
    db.exec("COMMIT");
    return toJob(job);
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function heartbeatJob(id: number, leaseMs: number): void {
  getDb()
    .prepare("UPDATE jobs SET leased_until=datetime('now', ?) WHERE id=? AND status='running'")
    .run(`+${Math.ceil(leaseMs / 1000)} seconds`, id);
}

export function setJobProgress(id: number, progress: number, stage: string): void {
  getDb()
    .prepare("UPDATE jobs SET progress=?, stage=?, leased_until=datetime('now', ?) WHERE id=?")
    .run(
      Math.max(0, Math.min(1, progress)),
      stage,
      `+${Math.ceil(config.jobLeaseMs / 1000)} seconds`,
      id
    );
}

export function completeJob(id: number, result?: Record<string, unknown>): void {
  getDb()
    .prepare(
      `UPDATE jobs
       SET status='done', progress=1, stage='done', finished_at=datetime('now'),
           error=NULL, worker_id=NULL, leased_until=NULL, result=?
       WHERE id=?`
    )
    .run(result ? JSON.stringify(result) : null, id);
}

/** Record a failure; retry while attempts remain, otherwise mark failed. */
export function failJob(id: number, error: string): void {
  const db = getDb();
  const j = db.prepare("SELECT attempts, max_attempts FROM jobs WHERE id=?").get(id) as
    | { attempts: number; max_attempts: number }
    | undefined;
  if (!j) return;
  const canRetry = Number(j.attempts) < Number(j.max_attempts);
  const message = error.slice(0, 800);
  if (canRetry) {
    db.prepare(
      `UPDATE jobs SET status='queued', error=?, stage='retrying', progress=0,
         worker_id=NULL, leased_until=NULL WHERE id=?`
    ).run(message, id);
  } else {
    db.prepare(
      `UPDATE jobs SET status='failed', error=?, stage='failed', finished_at=datetime('now'),
         worker_id=NULL, leased_until=NULL WHERE id=?`
    ).run(message, id);
  }
}

// ---------------------------------------------------------------------------
// Recovery and control
// ---------------------------------------------------------------------------

/**
 * Reset jobs left 'running' by a previous process. The worker runs in-process,
 * so at startup any 'running' row is orphaned and safe to requeue immediately.
 */
export function requeueOrphanedJobs(): number {
  const info = getDb()
    .prepare(
      `UPDATE jobs
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

/** Requeue jobs whose worker died (lease expired). */
export function requeueStaleJobs(): number {
  const db = getDb();
  const expired = db
    .prepare(
      `SELECT id FROM jobs
       WHERE status='running' AND (leased_until IS NULL OR leased_until < datetime('now'))`
    )
    .all() as { id: number }[];
  for (const r of expired) {
    db.prepare(
      `UPDATE jobs
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

export function cancelQueuedJobs(): number {
  const info = getDb()
    .prepare(
      `UPDATE jobs SET status='canceled', stage='canceled', finished_at=datetime('now')
       WHERE status='queued'`
    )
    .run();
  return Number(info.changes);
}

export function retryFailedJobs(): number {
  const info = getDb()
    .prepare(
      `UPDATE jobs
       SET status='queued', error=NULL, stage='queued', progress=0, attempts=0,
           finished_at=NULL, worker_id=NULL, leased_until=NULL
       WHERE status='failed'`
    )
    .run();
  return Number(info.changes);
}

export function clearFinishedJobs(): number {
  const info = getDb().prepare("DELETE FROM jobs WHERE status IN ('done','canceled')").run();
  return Number(info.changes);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export function getJobStats(): JobStats {
  const db = getDb();
  const totals = zero();
  const byType: Record<string, Counts> = {};
  const rows = db
    .prepare("SELECT type, status, COUNT(*) AS c FROM jobs GROUP BY type, status")
    .all() as { type: string; status: string; c: number }[];
  for (const r of rows) {
    const counts = byType[r.type] ?? zero();
    byType[r.type] = counts;
    const status = r.status as keyof Counts;
    if (status in counts) {
      counts[status] += Number(r.c);
      totals[status] += Number(r.c);
    }
  }

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
      "SELECT id, type, label, progress, stage FROM jobs WHERE status='running' ORDER BY id LIMIT 12"
    )
    .all() as Record<string, unknown>[];

  const queuedGameIds = (
    db
      .prepare(
        `SELECT DISTINCT json_extract(payload, '$.gameId') AS gameId
         FROM jobs WHERE type='analyze' AND status IN ('queued','running')`
      )
      .all() as Record<string, unknown>[]
  )
    .map((r) => Number(r.gameId))
    .filter((n) => Number.isInteger(n));

  return {
    jobs: totals,
    byType,
    games: {
      total: Number(g.total ?? 0),
      analyzed: Number(g.analyzed ?? 0),
      pending: Number(g.pending ?? 0),
      empty: Number(g.empty ?? 0),
    },
    active: active.map((r) => ({
      id: Number(r.id),
      type: r.type as JobType,
      label: r.label == null ? null : String(r.label),
      progress: Number(r.progress ?? 0),
      stage: r.stage == null ? null : String(r.stage),
    })),
    queuedGameIds,
  };
}

export function listJobs(
  filter: { status?: JobStatus; type?: JobType; gameId?: number; limit?: number } = {}
): JobWithGame[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.status) {
    where.push("j.status = ?");
    params.push(filter.status);
  }
  if (filter.type) {
    where.push("j.type = ?");
    params.push(filter.type);
  }
  if (filter.gameId != null) {
    where.push("json_extract(j.payload, '$.gameId') = ?");
    params.push(filter.gameId);
  }
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const sql =
    `SELECT j.*, COALESCE(g.white,'') AS white, COALESCE(g.black,'') AS black,
            COALESCE(g.source, '') AS source, COALESCE(g.eco,'') AS eco,
            COALESCE(g.opening_name,'') AS opening_name
     FROM jobs j LEFT JOIN games g ON g.id = json_extract(j.payload, '$.gameId')
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

export function getJob(id: number): Job | null {
  const r = getDb().prepare("SELECT * FROM jobs WHERE id=?").get(id);
  return r ? toJob(r as Record<string, unknown>) : null;
}
