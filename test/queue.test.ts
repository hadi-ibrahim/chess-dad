/**
 * The durable job queue.
 *
 * The queue is the only place the app keeps mutable server state that survives a
 * restart, so these tests pin down the behaviours the worker and the dashboard
 * depend on: exactly-once-ish claiming under a lease, retry accounting that
 * cannot spin forever, recovery that does not silently burn an attempt, and the
 * counters the UI reads. They run against the real SQLite engine on a throwaway
 * file; one connection is cached per process, so this file owns one database.
 */
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createTempDatabase, removeTempDatabase, loadDb, loadQueue } from "./helpers/db";

const tmp = createTempDatabase("queue");
const db = await loadDb();
const queue = await loadQueue();

// Types are derived from the module itself, so this file needs no runtime import
// of the source (which must not happen before the temp database path is set).
type Db = typeof db;
type Queue = typeof queue;
type NewGame = Parameters<Db["upsertGame"]>[0];
type EnqueueOptions = Parameters<Queue["enqueueAnalyzeJobs"]>[1];
type Job = NonNullable<ReturnType<Queue["claimNextJob"]>>;

const conn = () => db.getDb();

beforeEach(() => {
  for (const table of ["jobs", "library", "positions", "puzzles", "puzzle_reviews", "games"]) {
    conn().exec(`DELETE FROM ${table}`);
  }
});

after(() => removeTempDatabase(tmp.dir));

let seq = 0;

const GAME_DEFAULTS: NewGame = {
  source: "lichess",
  external_id: null,
  pgn: "1. e4 e5",
  white: "White Player",
  black: "Black Player",
  white_rating: null,
  black_rating: null,
  result: "*",
  time_control: "300+0",
  speed: "blitz",
  eco: "",
  opening_name: "",
  played_at: null,
  total_plies: 0,
};

function addGame(overrides: Partial<NewGame> = {}): number {
  seq += 1;
  const game: NewGame = Object.assign({}, GAME_DEFAULTS, { external_id: `q${seq}` }, overrides);
  return db.upsertGame(game);
}

/** Enqueue one job and return its id (enqueue only reports counts). */
function enqueueOne(gameId: number, opts?: EnqueueOptions): number {
  const result = queue.enqueueAnalyzeJobs([gameId], opts);
  assert.equal(result.enqueued, 1, `expected one job for game ${gameId}`);
  const row = conn().prepare("SELECT MAX(id) AS id FROM jobs").get() as { id: number | null } | undefined;
  return Number(row?.id ?? 0);
}

const claim = (worker = "worker-1", leaseMs = 60_000): Job | null => queue.claimNextJob(worker, leaseMs);

function jobCount(): number {
  const row = conn().prepare("SELECT COUNT(*) AS n FROM jobs").get() as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/** Seconds until this job's lease expires (NaN once it has none). */
function leaseSeconds(id: number): number {
  const row = conn()
    .prepare("SELECT (julianday(leased_until) - julianday('now')) * 86400 AS s FROM jobs WHERE id = ?")
    .get(id) as { s: number | null } | undefined;
  return row?.s == null ? Number.NaN : Number(row.s);
}

function expireLease(id: number): void {
  conn().prepare("UPDATE jobs SET leased_until = datetime('now', '-5 seconds') WHERE id = ?").run(id);
}

interface RawJob {
  type?: string;
  payload?: Record<string, unknown>;
  label?: string | null;
  priority?: number;
  status?: string;
  progress?: number;
  stage?: string | null;
  attempts?: number;
  maxAttempts?: number;
}

function insertRawJobs(rows: RawJob[]): void {
  const insert = conn().prepare(
    "INSERT INTO jobs (type, payload, label, priority, status, progress, stage, attempts, max_attempts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  conn().exec("BEGIN");
  try {
    for (const r of rows) {
      insert.run(
        r.type ?? "analyze",
        JSON.stringify(r.payload ?? {}),
        r.label ?? null,
        r.priority ?? 0,
        r.status ?? "queued",
        r.progress ?? 0,
        r.stage ?? null,
        r.attempts ?? 0,
        r.maxAttempts ?? 2
      );
    }
    conn().exec("COMMIT");
  } catch (e) {
    conn().exec("ROLLBACK");
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

describe("enqueueAnalyzeJobs", () => {
  test("enqueues one job per game with the default payload", () => {
    const g1 = addGame();
    const g2 = addGame();

    assert.deepEqual(queue.enqueueAnalyzeJobs([g1, g2]), { enqueued: 2, skipped: 0, rejected: 0, capped: false });

    const jobs = queue.listJobs();
    assert.equal(jobs.length, 2);
    // listJobs is newest-first, so [0] is the second game.
    assert.equal(jobs[0].payload.gameId, g2);
    assert.equal(jobs[1].payload.gameId, g1);
    for (const job of jobs) {
      assert.equal(job.type, "analyze");
      assert.equal(job.status, "queued");
      assert.equal(job.priority, 0);
      assert.equal(job.attempts, 0);
      assert.equal(job.max_attempts, 2);
      assert.equal(job.label, `game ${job.payload.gameId}`);
      assert.deepEqual(job.payload, {
        gameId: job.payload.gameId,
        depth: null,
        explain: true,
        generatePuzzles: true,
      });
    }
  });

  test("carries the enqueue options through, defaulting explain/generatePuzzles on", () => {
    const configured = addGame();
    const defaults = addGame();
    const explicitlyOn = addGame();

    queue.enqueueAnalyzeJobs([configured], { depth: 22, explain: false, generatePuzzles: false });
    queue.enqueueAnalyzeJobs([defaults], {});
    queue.enqueueAnalyzeJobs([explicitlyOn], { depth: 0, explain: true });

    assert.deepEqual(queue.listJobs({ gameId: configured })[0].payload, {
      gameId: configured,
      depth: 22,
      explain: false,
      generatePuzzles: false,
    });
    assert.deepEqual(queue.listJobs({ gameId: defaults })[0].payload, {
      gameId: defaults,
      depth: null,
      explain: true,
      generatePuzzles: true,
    });
    assert.equal(queue.listJobs({ gameId: explicitlyOn })[0].payload.explain, true);
  });

  test("skips a game that already has a queued or running job", () => {
    const g1 = addGame();
    const g2 = addGame();

    assert.deepEqual(queue.enqueueAnalyzeJobs([g1]), { enqueued: 1, skipped: 0, rejected: 0, capped: false });
    assert.deepEqual(queue.enqueueAnalyzeJobs([g1, g2]), { enqueued: 1, skipped: 1, rejected: 0, capped: false });

    // Running blocks too.
    const claimed = claim()!;
    assert.equal(claimed.payload.gameId, g1);
    assert.deepEqual(queue.enqueueAnalyzeJobs([g1]), { enqueued: 0, skipped: 1, rejected: 0, capped: false });

    // A finished job no longer blocks.
    queue.completeJob(claimed.id);
    assert.deepEqual(queue.enqueueAnalyzeJobs([g1]), { enqueued: 1, skipped: 0, rejected: 0, capped: false });
    assert.equal(jobCount(), 3);
  });

  test("a failed job does not block a re-enqueue", () => {
    const game = addGame();
    const id = enqueueOne(game);
    conn().prepare("UPDATE jobs SET max_attempts = 1 WHERE id = ?").run(id);
    claim();
    queue.failJob(id, "engine exploded");
    assert.equal(queue.getJob(id)!.status, "failed");

    assert.deepEqual(queue.enqueueAnalyzeJobs([game]), { enqueued: 1, skipped: 0, rejected: 0, capped: false });
  });

  test("de-duplicates repeated gameIds within a single call", () => {
    const game = addGame();
    assert.deepEqual(queue.enqueueAnalyzeJobs([game, game]), { enqueued: 1, skipped: 1, rejected: 0, capped: false });
  });
});

// ---------------------------------------------------------------------------
// Claiming
// ---------------------------------------------------------------------------

describe("claimNextJob", () => {
  test("claims the highest priority, then the lowest id, and leases it", () => {
    const g1 = addGame();
    const g2 = addGame();
    const g3 = addGame();
    const j1 = enqueueOne(g1);
    const j2 = enqueueOne(g2);
    const j3 = enqueueOne(g3);
    conn().prepare("UPDATE jobs SET priority = 10 WHERE id = ?").run(j2);

    const first = claim("worker-a", 60_000)!;
    assert.equal(first.id, j2, "the higher priority wins even though it is not the oldest");
    assert.equal(first.status, "running");
    assert.equal(first.worker_id, "worker-a");
    assert.equal(first.attempts, 1, "claiming spends the attempt");
    assert.equal(first.progress, 0);
    assert.equal(first.stage, "queued");
    assert.ok(first.started_at, "started_at is stamped");
    assert.ok(first.leased_until, "a lease is recorded");

    const lease = leaseSeconds(j2);
    assert.ok(lease > 55 && lease <= 65, `expected a ~60s lease, got ${lease}s`);

    const second = claim("worker-b", 60_000)!;
    assert.equal(second.id, j1, "among equal priorities the lowest id goes first");
    assert.notEqual(second.id, first.id, "the same job must never be handed out twice");
    assert.equal(second.worker_id, "worker-b");
    assert.equal(second.attempts, 1);

    const third = claim()!;
    assert.equal(third.id, j3);
    assert.equal(claim(), null, "an empty queue yields null");
  });

  test("claiming from an empty queue returns null and writes nothing", () => {
    assert.equal(claim(), null);
    assert.equal(jobCount(), 0);
  });

  test("a claimed job leaves the queued pool", () => {
    const id = enqueueOne(addGame());
    assert.equal(queue.listJobs({ status: "queued" }).length, 1);
    claim();
    assert.equal(queue.listJobs({ status: "queued" }).length, 0);
    assert.deepEqual(
      queue.listJobs({ status: "running" }).map((j) => j.id),
      [id]
    );
  });
});

// ---------------------------------------------------------------------------
// Finishing
// ---------------------------------------------------------------------------

describe("completeJob", () => {
  test("marks the job done and stores the result", () => {
    const id = enqueueOne(addGame());
    claim("worker-a");

    queue.completeJob(id, { moves: 12, accuracy: 88 });

    const job = queue.getJob(id)!;
    assert.equal(job.status, "done");
    assert.equal(job.progress, 1);
    assert.equal(job.stage, "done");
    assert.ok(job.finished_at);
    assert.equal(job.worker_id, null, "the lease is released");
    assert.equal(job.leased_until, null);
    assert.equal(job.error, null);
    assert.deepEqual(job.result, { moves: 12, accuracy: 88 });
  });

  test("without a result the result column stays null", () => {
    const id = enqueueOne(addGame());
    queue.completeJob(id);
    const job = queue.getJob(id)!;
    assert.equal(job.status, "done");
    assert.equal(job.result, null);
  });
});

describe("failJob", () => {
  test("requeues while attempts remain, then fails when the budget is spent", () => {
    const id = enqueueOne(addGame());
    conn().prepare("UPDATE jobs SET max_attempts = 2 WHERE id = ?").run(id);

    claim();
    queue.failJob(id, "engine crashed");

    let job = queue.getJob(id)!;
    assert.equal(job.status, "queued", "the attempt is given back to the queue");
    assert.equal(job.error, "engine crashed");
    assert.equal(job.stage, "retrying");
    assert.equal(job.progress, 0);
    assert.equal(job.worker_id, null);
    assert.equal(job.leased_until, null);
    assert.equal(job.finished_at, null);
    assert.equal(job.attempts, 1, "the spent attempt is not refunded");

    claim();
    queue.failJob(id, "engine crashed again");

    job = queue.getJob(id)!;
    assert.equal(job.status, "failed");
    assert.equal(job.stage, "failed");
    assert.equal(job.error, "engine crashed again");
    assert.equal(job.attempts, 2);
    assert.ok(job.finished_at);
    assert.equal(job.worker_id, null);
    assert.equal(job.leased_until, null);
  });

  test("truncates the error to 800 characters on the terminal failure", () => {
    const id = enqueueOne(addGame());
    conn().prepare("UPDATE jobs SET max_attempts = 1 WHERE id = ?").run(id);
    claim();

    queue.failJob(id, "x".repeat(1200));

    const job = queue.getJob(id)!;
    assert.equal(job.status, "failed");
    assert.ok(job.error);
    assert.equal(job.error.length, 800);
    assert.equal(job.error, "x".repeat(800));
  });

  test("truncates the error on the retry path too", () => {
    const id = enqueueOne(addGame());
    conn().prepare("UPDATE jobs SET max_attempts = 2 WHERE id = ?").run(id);
    claim();

    queue.failJob(id, "y".repeat(900));

    const job = queue.getJob(id)!;
    assert.equal(job.status, "queued");
    assert.ok(job.error);
    assert.equal(job.error.length, 800);
  });

  test("ignores an unknown job id", () => {
    assert.doesNotThrow(() => queue.failJob(987654, "nothing to see"));
    assert.equal(jobCount(), 0);
  });
});

// ---------------------------------------------------------------------------
// Recovery and control
// ---------------------------------------------------------------------------

describe("requeueOrphanedJobs", () => {
  test("resets a running job without spending its attempt", () => {
    const id = enqueueOne(addGame());
    const claimed = claim("worker-a")!;
    assert.equal(claimed.attempts, 1);

    assert.equal(queue.requeueOrphanedJobs(), 1);

    const job = queue.getJob(id)!;
    assert.equal(job.status, "queued");
    assert.equal(job.attempts, 0, "a restart is not a failure");
    assert.equal(job.stage, "queued");
    assert.equal(job.error, null);
    assert.equal(job.progress, 0);
    assert.equal(job.worker_id, null);
    assert.equal(job.leased_until, null);
    assert.equal(job.finished_at, null);
  });

  test("does nothing when no job is running", () => {
    enqueueOne(addGame());
    assert.equal(queue.requeueOrphanedJobs(), 0);
  });

  test("fails a running job that had already used its last attempt", () => {
    const id = enqueueOne(addGame());
    conn().prepare("UPDATE jobs SET max_attempts = 1 WHERE id = ?").run(id);
    claim();

    assert.equal(queue.requeueOrphanedJobs(), 1);

    const job = queue.getJob(id)!;
    assert.equal(job.status, "failed");
    assert.equal(job.stage, "failed");
    assert.equal(job.error, "interrupted by restart");
    assert.ok(job.finished_at);
  });

  test("leaves queued, done and failed rows alone", () => {
    const queuedId = enqueueOne(addGame());
    const doneId = enqueueOne(addGame());
    queue.completeJob(doneId);

    assert.equal(queue.requeueOrphanedJobs(), 0);
    assert.equal(queue.getJob(queuedId)!.status, "queued");
    assert.equal(queue.getJob(doneId)!.status, "done");
  });
});

describe("requeueStaleJobs", () => {
  test("reclaims only the jobs whose lease has expired", () => {
    const stale = enqueueOne(addGame());
    const fresh = enqueueOne(addGame());
    const staleJob = claim("worker-a")!;
    const freshJob = claim("worker-b")!;
    assert.equal(staleJob.id, stale);
    assert.equal(freshJob.id, fresh);
    expireLease(stale);

    assert.equal(queue.requeueStaleJobs(), 1);

    const reclaimed = queue.getJob(stale)!;
    assert.equal(reclaimed.status, "queued");
    assert.equal(reclaimed.stage, "retrying");
    assert.equal(reclaimed.error, "worker lease expired");
    assert.equal(reclaimed.worker_id, null);
    assert.equal(reclaimed.leased_until, null);
    assert.equal(reclaimed.attempts, 1, "a stale lease does not refund the attempt");

    const untouched = queue.getJob(fresh)!;
    assert.equal(untouched.status, "running");
    assert.equal(untouched.worker_id, "worker-b");
    assert.ok(leaseSeconds(fresh) > 0);
  });

  test("treats a running row with no lease as stale", () => {
    const id = enqueueOne(addGame());
    claim();
    conn().prepare("UPDATE jobs SET leased_until = NULL WHERE id = ?").run(id);

    assert.equal(queue.requeueStaleJobs(), 1);
    assert.equal(queue.getJob(id)!.status, "queued");
  });

  test("fails a stale job that is out of attempts", () => {
    const id = enqueueOne(addGame());
    conn().prepare("UPDATE jobs SET max_attempts = 1 WHERE id = ?").run(id);
    claim();
    expireLease(id);

    assert.equal(queue.requeueStaleJobs(), 1);

    const job = queue.getJob(id)!;
    assert.equal(job.status, "failed");
    assert.equal(job.stage, "failed");
    assert.equal(job.error, "worker lease expired");
    assert.ok(job.finished_at);
  });

  test("keeps an error that was already recorded", () => {
    const id = enqueueOne(addGame());
    claim();
    conn().prepare("UPDATE jobs SET error = 'prior failure' WHERE id = ?").run(id);
    expireLease(id);

    queue.requeueStaleJobs();

    assert.equal(queue.getJob(id)!.error, "prior failure");
  });
});

describe("queue control", () => {
  test("cancelQueuedJobs cancels only queued rows", () => {
    // Claim first, so the only queued rows when cancel runs are the two we add.
    const runningA = enqueueOne(addGame());
    const runningB = enqueueOne(addGame());
    const runningAJob = claim()!;
    const runningBJob = claim()!;
    assert.equal(runningAJob.id, runningA);
    assert.equal(runningBJob.id, runningB);
    const done = enqueueOne(addGame());
    queue.completeJob(done);
    const queuedA = enqueueOne(addGame());
    const queuedB = enqueueOne(addGame());

    assert.equal(queue.cancelQueuedJobs(), 2);

    const canceled = queue.getJob(queuedA)!;
    assert.equal(canceled.status, "canceled");
    assert.equal(canceled.stage, "canceled");
    assert.ok(canceled.finished_at);
    assert.equal(queue.getJob(queuedB)!.status, "canceled");
    assert.equal(queue.getJob(runningA)!.status, "running");
    assert.equal(queue.getJob(done)!.status, "done");
    assert.equal(queue.cancelQueuedJobs(), 0, "nothing is left to cancel");
  });

  test("retryFailedJobs requeues failed rows and leaves the others alone", () => {
    const failed = enqueueOne(addGame());
    conn().prepare("UPDATE jobs SET max_attempts = 1 WHERE id = ?").run(failed);
    claim();
    queue.failJob(failed, "boom");

    const done = enqueueOne(addGame());
    queue.completeJob(done);
    const running = enqueueOne(addGame());
    claim();
    const canceled = enqueueOne(addGame());
    conn().prepare("UPDATE jobs SET status = 'canceled', stage = 'canceled' WHERE id = ?").run(canceled);
    const queued = enqueueOne(addGame());

    assert.equal(queue.retryFailedJobs(), 1);

    const retried = queue.getJob(failed)!;
    assert.equal(retried.status, "queued");
    assert.equal(retried.error, null);
    assert.equal(retried.stage, "queued");
    assert.equal(retried.progress, 0);
    assert.equal(retried.attempts, 0, "a manual retry resets the budget");
    assert.equal(retried.finished_at, null);
    assert.equal(retried.worker_id, null);
    assert.equal(retried.leased_until, null);

    assert.equal(queue.getJob(queued)!.status, "queued");
    assert.equal(queue.getJob(done)!.status, "done");
    assert.equal(queue.getJob(running)!.status, "running");
    assert.equal(queue.getJob(canceled)!.status, "canceled");
    assert.equal(queue.retryFailedJobs(), 0);
  });

  test("clearFinishedJobs deletes done and canceled only", () => {
    const done = enqueueOne(addGame());
    queue.completeJob(done);
    const canceled = enqueueOne(addGame());
    conn().prepare("UPDATE jobs SET status = 'canceled' WHERE id = ?").run(canceled);
    const queued = enqueueOne(addGame());
    const failed = enqueueOne(addGame());
    conn().prepare("UPDATE jobs SET status = 'failed' WHERE id = ?").run(failed);
    const running = enqueueOne(addGame());
    claim();

    assert.equal(queue.clearFinishedJobs(), 2);

    assert.equal(queue.getJob(done), null);
    assert.equal(queue.getJob(canceled), null);
    assert.notEqual(queue.getJob(queued), null);
    assert.notEqual(queue.getJob(failed), null);
    assert.notEqual(queue.getJob(running), null);
    assert.equal(queue.clearFinishedJobs(), 0);
  });
});

// ---------------------------------------------------------------------------
// Leases and progress
// ---------------------------------------------------------------------------

describe("heartbeatJob / setJobProgress", () => {
  test("heartbeat extends a running job's lease and is a no-op once finished", () => {
    const id = enqueueOne(addGame());
    claim("worker-a", 60_000);
    const initial = leaseSeconds(id);
    assert.ok(initial > 55 && initial <= 65);

    queue.heartbeatJob(id, 300_000);
    const extended = leaseSeconds(id);
    assert.ok(extended > 290 && extended <= 305, `expected a ~300s lease, got ${extended}`);

    queue.completeJob(id);
    conn().prepare("UPDATE jobs SET leased_until = '2000-01-01 00:00:00' WHERE id = ?").run(id);
    queue.heartbeatJob(id, 300_000);
    assert.equal(queue.getJob(id)!.leased_until, "2000-01-01 00:00:00", "only running jobs are leased");
  });

  test("setJobProgress clamps progress into [0,1] and records the stage", () => {
    const id = enqueueOne(addGame());
    claim("worker-a", 60_000); // progress is only reported by a running job

    queue.setJobProgress(id, 1.7, "analysing");
    assert.equal(queue.getJob(id)!.progress, 1);
    assert.equal(queue.getJob(id)!.stage, "analysing");

    queue.setJobProgress(id, -0.4, "parsing");
    assert.equal(queue.getJob(id)!.progress, 0);
    assert.equal(queue.getJob(id)!.stage, "parsing");
  });

  test("setJobProgress ignores a job that is not running", () => {
    const id = enqueueOne(addGame());

    // Still queued: a stale report must not touch its progress or its lease.
    queue.setJobProgress(id, 0.5, "analysing");
    assert.equal(queue.getJob(id)!.progress, 0);
    assert.equal(queue.getJob(id)!.stage, null);
    assert.equal(queue.getJob(id)!.leased_until, null);

    // A finished job must not be resurrected by a late report.
    claim("worker-a", 60_000);
    queue.completeJob(id);
    queue.setJobProgress(id, 0.5, "analysing");
    assert.equal(queue.getJob(id)!.status, "done");
    assert.equal(queue.getJob(id)!.stage, "done");
  });
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

describe("getJobStats", () => {
  /** Build one job in each terminal/active state, each in isolation. */
  function buildEveryState() {
    const doneGame = addGame();
    const done = enqueueOne(doneGame);
    queue.completeJob(done);

    const runningGame = addGame();
    const running = enqueueOne(runningGame);
    claim("worker-a");

    const failedGame = addGame();
    const failed = enqueueOne(failedGame);
    conn().prepare("UPDATE jobs SET max_attempts = 1 WHERE id = ?").run(failed);
    claim("worker-b");
    queue.failJob(failed, "nope");

    const canceledGame = addGame();
    const canceled = enqueueOne(canceledGame);
    conn().prepare("UPDATE jobs SET status = 'canceled' WHERE id = ?").run(canceled);

    const queuedGame = addGame();
    const queued = enqueueOne(queuedGame);

    return { done, running, failed, canceled, queued, doneGame, runningGame, failedGame, canceledGame, queuedGame };
  }

  test("counts jobs by status and by type", () => {
    const ids = buildEveryState();

    const stats = queue.getJobStats();

    assert.deepEqual(stats.jobs, { queued: 1, running: 1, done: 1, failed: 1, canceled: 1 });
    assert.deepEqual(stats.byType.analyze, stats.jobs);
    assert.equal(stats.active.length, 1);
    assert.equal(stats.active[0].id, ids.running);
    assert.equal(stats.active[0].type, "analyze");
    assert.equal(stats.active[0].label, `game ${ids.runningGame}`);
    assert.equal(stats.active[0].progress, 0);
    assert.equal(stats.active[0].stage, "queued");
    assert.deepEqual(
      [...stats.queuedGameIds].sort((a, b) => a - b),
      [ids.queuedGame, ids.runningGame].sort((a, b) => a - b),
      "the dashboard flags queued and running games"
    );
  });

  test("computes the scoped game totals", () => {
    const scopeA = "lichess:alice";
    const scopeB = "lichess:bob";

    const analyzed = addGame({ total_plies: 40 });
    db.markGameAnalyzed(analyzed, { white: 90, black: 80 });
    db.linkGame(scopeA, analyzed, "w");

    const pending = addGame({ total_plies: 30 });
    db.linkGame(scopeA, pending, "w");

    const empty = addGame({ total_plies: 0 });
    db.linkGame(scopeA, empty, "w");

    const outside = addGame({ total_plies: 20 });
    db.linkGame(scopeB, outside, "w");

    assert.deepEqual(queue.getJobStats([scopeA]).games, {
      total: 3,
      analyzed: 1,
      pending: 1,
      empty: 1,
    });
    assert.deepEqual(queue.getJobStats([scopeB]).games, {
      total: 1,
      analyzed: 0,
      pending: 1,
      empty: 0,
    });
    assert.deepEqual(queue.getJobStats(null).games, {
      total: 4,
      analyzed: 1,
      pending: 2,
      empty: 1,
    });
    assert.deepEqual(queue.getJobStats([]).games, {
      total: 0,
      analyzed: 0,
      pending: 0,
      empty: 0,
    });
  });

  test("a scoped call still reports the global job counts", () => {
    buildEveryState();
    const stats = queue.getJobStats(["scope:nobody"]);
    assert.deepEqual(stats.games, { total: 0, analyzed: 0, pending: 0, empty: 0 });
    assert.equal(stats.jobs.queued, 1);
    assert.equal(stats.jobs.done, 1);
  });

  test("caps the active list at 12 and ignores unknown statuses", () => {
    insertRawJobs(
      Array.from({ length: 13 }, (_, i) => ({
        status: "running",
        label: `job ${i}`,
        payload: { gameId: i + 1 },
        stage: "analysing",
        progress: 0.5,
      }))
    );
    assert.equal(queue.getJobStats().active.length, 12);

    insertRawJobs([{ status: "weird", payload: { gameId: 42 } }]);
    const stats = queue.getJobStats();
    assert.deepEqual(stats.jobs, { queued: 0, running: 13, done: 0, failed: 0, canceled: 0 });
    assert.deepEqual(stats.byType.analyze, stats.jobs);
  });

  test("queuedGameIds excludes jobs with no integer gameId", () => {
    insertRawJobs([{ status: "queued", payload: {} }]);
    assert.deepEqual(queue.getJobStats().queuedGameIds, []);
  });
});

describe("listJobs", () => {
  test("filters by status, type and gameId and joins the game", () => {
    const g1 = addGame({ white: "Alice", black: "Bob", source: "chesscom", eco: "C50", opening_name: "Italian Game" });
    const g2 = addGame();
    const done = enqueueOne(g1);
    const queued = enqueueOne(g2);
    queue.completeJob(done);

    assert.deepEqual(
      queue.listJobs({ status: "queued" }).map((j) => j.id),
      [queued]
    );
    assert.deepEqual(
      queue.listJobs({ status: "done" }).map((j) => j.id),
      [done]
    );
    assert.deepEqual(
      queue.listJobs({ type: "analyze" }).map((j) => j.id).sort((a, b) => a - b),
      [done, queued]
    );
    assert.deepEqual(
      queue.listJobs({ gameId: g1 }).map((j) => j.id),
      [done]
    );
    assert.deepEqual(queue.listJobs({ gameId: 99999 }), []);
    assert.deepEqual(
      queue.listJobs({ status: "queued", gameId: g1 }),
      [],
      "filters combine"
    );

    const [job] = queue.listJobs({ gameId: g1 });
    assert.equal(job.white, "Alice");
    assert.equal(job.black, "Bob");
    assert.equal(job.source, "chesscom");
    assert.equal(job.eco, "C50");
    assert.equal(job.opening_name, "Italian Game");
  });

  test("a job whose game is gone still lists, with empty game fields", () => {
    const orphan = enqueueOne(4242);
    const [job] = queue.listJobs({ gameId: 4242 });
    assert.equal(job.id, orphan);
    assert.equal(job.white, "");
    assert.equal(job.black, "");
    assert.equal(job.source, "");
    assert.equal(job.eco, "");
    assert.equal(job.opening_name, "");
  });

  test("returns jobs newest-first with a default limit of 100", () => {
    insertRawJobs(
      Array.from({ length: 120 }, (_, i) => ({ payload: { gameId: i + 1 }, label: `game ${i + 1}` }))
    );

    const jobs = queue.listJobs();
    assert.equal(jobs.length, 100);
    for (let i = 1; i < jobs.length; i++) {
      assert.ok(jobs[i - 1].id > jobs[i].id, "newest id first");
    }
  });

  test("clamps limit into 1..500", () => {
    insertRawJobs(Array.from({ length: 501 }, (_, i) => ({ payload: { gameId: i + 1 } })));

    assert.equal(queue.listJobs({ limit: 10000 }).length, 500);
    assert.equal(queue.listJobs({ limit: 500 }).length, 500);
    assert.equal(queue.listJobs({ limit: 250 }).length, 250);
    assert.equal(queue.listJobs({ limit: 0 }).length, 1);
    assert.equal(queue.listJobs({ limit: -3 }).length, 1);
  });
});

describe("getJob", () => {
  test("decodes payload and result JSON", () => {
    const game = addGame();
    const id = enqueueOne(game, { depth: 18 });
    let job = queue.getJob(id)!;
    assert.deepEqual(job.payload, { gameId: game, depth: 18, explain: true, generatePuzzles: true });
    assert.equal(job.result, null);

    queue.completeJob(id, { ok: true });
    job = queue.getJob(id)!;
    assert.deepEqual(job.result, { ok: true });
  });

  test("junk JSON degrades to an empty payload / null result rather than throwing", () => {
    const id = enqueueOne(addGame());
    conn().prepare("UPDATE jobs SET payload = 'not json', result = 'null' WHERE id = ?").run(id);

    const job = queue.getJob(id)!;
    assert.deepEqual(job.payload, {});
    assert.equal(job.result, null);
  });

  test("an unknown id is null", () => {
    assert.equal(queue.getJob(123456), null);
  });
});

// ---------------------------------------------------------------------------
// Worker opt-out
// ---------------------------------------------------------------------------

describe("CHESSDAD_DISABLE_WORKER", () => {
  test("a web-only replica does not become a consumer when a route enqueues", async () => {
    // The flag used to be honoured only at boot, so hitting /api/jobs turned a
    // "web-only" replica into a worker anyway.
    const worker = await import("@/lib/worker");
    const previous = process.env.CHESSDAD_DISABLE_WORKER;
    process.env.CHESSDAD_DISABLE_WORKER = "1";
    try {
      worker.ensureWorkerStarted();
      assert.equal(worker.getWorkerState().started, false);
    } finally {
      if (previous === undefined) delete process.env.CHESSDAD_DISABLE_WORKER;
      else process.env.CHESSDAD_DISABLE_WORKER = previous;
    }
  });
});
