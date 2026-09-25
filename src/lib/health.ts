import "server-only";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { config } from "./config";
import { getDb } from "./db";
import { getJobStats } from "./queue";
import { getWorkerState } from "./worker";
import { log } from "./log";

/**
 * Liveness and readiness for the deployment.
 *
 * The failure this is built to prevent: the app boots, serves pages, and looks
 * perfectly healthy while the Stockfish binary is missing — so every analysis job
 * fails on a 60-second timeout and nobody notices. A check that only proved the
 * HTTP server answers would repeat exactly that mistake, so the engine check
 * spawns the real binary and waits for `uciok`.
 *
 * Spawning on every probe would be wasteful (a container health check runs every
 * 30 seconds), so the engine result is cached for `HEALTH_ENGINE_TTL_MS`.
 */

export interface Check {
  ok: boolean;
  /** Short, safe-to-publish reason. The detail goes to the log, not the response. */
  reason?: string;
  ms?: number;
}

export interface HealthReport {
  ok: boolean;
  uptimeMs: number;
  checks: {
    db: Check;
    engine: Check & { version?: string };
    worker: Check;
    disk: Check & { freeMb?: number };
  };
  queue: { queued: number; running: number; failed: number; depth: number };
  games: { total: number; analyzed: number; pending: number };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

function checkDb(): Check {
  const started = Date.now();
  try {
    const db = getDb();
    // Proves the file is readable and the schema is intact, not just open.
    db.prepare("SELECT 1 AS ok").get();
    db.prepare("PRAGMA quick_check").all();
    // Writability without mutating anything.
    fs.accessSync(path.dirname(config.dbPath), fs.constants.W_OK);
    return { ok: true, ms: Date.now() - started };
  } catch (e) {
    log.error("health: database check failed", { err: e, dbPath: config.dbPath });
    return { ok: false, reason: "database unavailable", ms: Date.now() - started };
  }
}

function checkDisk(): Check & { freeMb?: number } {
  try {
    const stats = fs.statfsSync(path.dirname(config.dbPath));
    const freeMb = Math.floor((Number(stats.bavail) * Number(stats.bsize)) / 1024 / 1024);
    // Under ~50MB free, SQLite can fail mid-write and a backup cannot be taken.
    return { ok: freeMb > 50, freeMb, reason: freeMb > 50 ? undefined : "low disk space" };
  } catch (e) {
    log.warn("health: disk check unavailable", { err: e });
    // Not every platform exposes statfs; do not fail health for that.
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// Stockfish
// ---------------------------------------------------------------------------

interface EngineProbe {
  at: number;
  ok: boolean;
  version?: string;
  reason?: string;
}

let engineProbe: EngineProbe | null = null;

function engineTtlMs(): number {
  const n = Number(process.env.HEALTH_ENGINE_TTL_MS);
  return Number.isFinite(n) && n >= 0 ? n : 60_000;
}

/**
 * Spawn Stockfish, ask it to identify itself, and require `uciok` before the
 * timeout. The child is always killed — an unkilled probe process would leak on
 * every health check.
 */
export function probeEngine(timeoutMs = 5_000): Promise<Omit<EngineProbe, "at">> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn> | null = null;
    let settled = false;
    let buffer = "";

    const finish = (result: Omit<EngineProbe, "at">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child?.kill("SIGKILL");
      } catch {
        // Already gone.
      }
      resolve(result);
    };

    const timer = setTimeout(() => finish({ ok: false, reason: `no uciok within ${timeoutMs}ms` }), timeoutMs);

    try {
      child = spawn(config.stockfishPath, [], { stdio: ["pipe", "pipe", "ignore"] });
    } catch {
      finish({ ok: false, reason: "could not spawn the engine binary" });
      return;
    }

    child.on("error", () => finish({ ok: false, reason: "could not spawn the engine binary" }));
    child.on("exit", () => finish({ ok: false, reason: "engine exited before reporting ready" }));
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      // `uci` replies with `id name Stockfish <version>` then `uciok`.
      const version = buffer.match(/^id name (.+)$/m)?.[1]?.trim();
      if (/^uciok\s*$/m.test(buffer)) finish({ ok: true, version });
    });
    child.stdin?.on("error", () => finish({ ok: false, reason: "engine stdin closed" }));
    child.stdin?.write("uci\n");
  });
}

/** The cached probe used by the health endpoint. */
async function checkEngine(): Promise<Check & { version?: string }> {
  const ttl = engineTtlMs();
  if (engineProbe && Date.now() - engineProbe.at < ttl) {
    return { ok: engineProbe.ok, version: engineProbe.version, reason: engineProbe.reason };
  }
  const started = Date.now();
  const result = await probeEngine();
  engineProbe = { at: Date.now(), ...result };
  if (!result.ok) {
    log.error("health: engine probe failed", { reason: result.reason, stockfishPath: config.stockfishPath });
  }
  return { ...result, ms: Date.now() - started };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export async function healthReport(): Promise<HealthReport> {
  const worker = getWorkerState();
  const db = checkDb();

  // The queue reads share the DB connection, so only ask if the DB is usable.
  let queue = { queued: 0, running: 0, failed: 0, depth: 0 };
  let games = { total: 0, analyzed: 0, pending: 0 };
  if (db.ok) {
    try {
      const stats = getJobStats(null);
      queue = {
        queued: stats.jobs.queued,
        running: stats.jobs.running,
        failed: stats.jobs.failed,
        depth: stats.jobs.queued + stats.jobs.running,
      };
      games = {
        total: stats.games.total,
        analyzed: stats.games.analyzed,
        pending: stats.games.pending,
      };
    } catch (e) {
      log.warn("health: queue stats unavailable", { err: e });
    }
  }

  const engine = await checkEngine();
  const disk = checkDisk();

  const checks = {
    db,
    engine,
    // A worker that has not been started is only a failure if there is work to do.
    worker: {
      ok: worker.started,
      reason: worker.started ? undefined : "worker pool not started",
    },
    disk,
  };

  // The worker is allowed to be idle; it is not allowed to be absent while work
  // is waiting, which is the "queued jobs never run" failure.
  const stalled = worker.started === false && queue.depth > 0;

  return {
    ok: db.ok && engine.ok && disk.ok && !stalled,
    uptimeMs: Math.round(process.uptime() * 1000),
    checks,
    queue,
    games,
  };
}

/**
 * The startup check. Logs loudly rather than throwing, so a missing engine is
 * visible in the deploy log instead of taking the process down — the container
 * still serves the UI and the review of already-analysed games.
 */
export async function bootProbe(): Promise<void> {
  const db = checkDb();
  if (db.ok) log.info("boot: database ready", { dbPath: config.dbPath });
  else log.error("boot: database is not usable — every request will fail", { dbPath: config.dbPath });

  const disk = checkDisk();
  if (disk.freeMb != null) log.info("boot: disk", { freeMb: disk.freeMb, ok: disk.ok });

  const engine = await probeEngine(10_000);
  if (engine.ok) {
    log.info("boot: engine ready", { version: engine.version, stockfishPath: config.stockfishPath });
  } else {
    log.error(
      "boot: Stockfish is NOT available — analysis will fail on every job. " +
        "Check STOCKFISH_PATH, or run `pnpm run setup:engine`.",
      { reason: engine.reason, stockfishPath: config.stockfishPath }
    );
  }

  log.info("boot: config", {
    workerConcurrency: config.workerConcurrency,
    enginePoolSize: config.enginePoolSize,
    analysisDepth: config.analysisDepth,
    // No LLM provider is logged any more: AI providers belong to a user's browser
    // profile, so there is nothing deployment-wide to report (or to leak).
  });
}

/** Exposed for tests and for callers that want to invalidate the cache. */
export function resetEngineProbe(): void {
  engineProbe = null;
}
