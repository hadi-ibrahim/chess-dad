import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config";
import { getDb } from "./db";
import { log } from "./log";

/**
 * Backups.
 *
 * The database is the only irreplaceable thing in the deployment: every analysed
 * game cost real CPU to produce. A Railway volume survives a redeploy but not a
 * bad migration, a corrupted page, or deleting the service — and until now there
 * was no copy of it anywhere.
 *
 * `VACUUM INTO` is the right primitive: it takes a consistent snapshot of a live
 * database in one statement, needs no downtime, and writes a compact standalone
 * file (no WAL to replay).
 *
 * A copy on the same volume is **not** a real backup — it does not survive losing
 * the volume. It protects against the far more likely failures (a bad write, a
 * mistaken delete, a corrupt page), and `scripts/backup-db.mjs` writes to any
 * directory you point it at, so an off-box copy is a cron entry away. That gap is
 * documented in the README rather than quietly ignored.
 */

function backupDir(): string {
  return process.env.BACKUP_DIR || path.join(config.dataDir, "backups");
}

function intervalMs(): number {
  const n = Number(process.env.BACKUP_INTERVAL_MS);
  if (Number.isFinite(n) && n >= 0) return n;
  return 6 * 60 * 60 * 1000; // every 6 hours
}

function retention(): number {
  const n = Number(process.env.BACKUP_RETENTION);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 7;
}

export interface BackupResult {
  ok: boolean;
  file?: string;
  bytes?: number;
  pruned?: number;
  reason?: string;
  ms: number;
}

/** A filename that sorts chronologically and is filesystem-safe. */
function stamp(now = new Date()): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

/** Newest first, and only files this module wrote. */
function existingBackups(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /^chessdad-.*\.db$/.test(f))
      .map((f) => path.join(dir, f))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

// Single-flight: a slow backup must not be joined by the next tick.
let running = false;

/**
 * Take one snapshot, verify it, then prune.
 *
 * Verification matters more than the copy itself — an unverified backup is a
 * rumour. The snapshot is reopened read-only and checked with
 * `PRAGMA integrity_check` before older copies are deleted, so a corrupt backup
 * can never displace good ones.
 */
export function runBackup(reason = "scheduled"): BackupResult {
  const started = Date.now();
  const dir = backupDir();

  if (running) {
    return { ok: false, reason: "a backup is already running", ms: 0 };
  }
  running = true;

  try {
    if (!fs.existsSync(config.dbPath)) {
      return { ok: false, reason: "no database file to back up", ms: Date.now() - started };
    }

    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `chessdad-${stamp()}.db`);

    // VACUUM INTO takes a string literal, so the path is escaped rather than
    // bound. BACKUP_DIR comes from the operator, but a quote in a path would
    // otherwise be an injection into this statement.
    const literal = target.replace(/'/g, "''");
    getDb().exec(`VACUUM INTO '${literal}'`);

    const { size } = fs.statSync(target);
    if (size === 0) {
      fs.rmSync(target, { force: true });
      return { ok: false, reason: "backup file was empty", ms: Date.now() - started };
    }

    // Prove the copy is a readable database before trusting it.
    const verify = new DatabaseSync(target, { readOnly: true });
    try {
      const rows = verify.prepare("PRAGMA integrity_check").all() as { integrity_check?: string }[];
      const verdict = String(rows[0]?.integrity_check ?? "");
      if (verdict !== "ok") {
        fs.rmSync(target, { force: true });
        log.error("backup: integrity check failed, snapshot discarded", { verdict, file: target });
        return { ok: false, reason: `integrity check: ${verdict}`, ms: Date.now() - started };
      }
    } finally {
      verify.close();
    }

    // Only now is it safe to drop the oldest copies.
    const keep = retention();
    const all = existingBackups(dir);
    let pruned = 0;
    for (const file of all.slice(keep)) {
      try {
        fs.rmSync(file, { force: true });
        pruned += 1;
      } catch (e) {
        log.warn("backup: could not prune an old snapshot", { err: e, file });
      }
    }

    log.info("backup: snapshot written", {
      reason,
      file: target,
      bytes: size,
      ms: Date.now() - started,
      pruned,
      kept: Math.min(all.length, keep),
    });

    return { ok: true, file: target, bytes: size, pruned, ms: Date.now() - started };
  } catch (e) {
    log.error("backup: failed", { err: e, reason });
    return { ok: false, reason: "backup failed", ms: Date.now() - started };
  } finally {
    running = false;
  }
}

const globalForBackup = globalThis as unknown as { __chessdadBackupTimer?: NodeJS.Timeout };

/** Start the periodic snapshot. Idempotent, and a no-op when disabled. */
export function startBackupScheduler(): void {
  if (globalForBackup.__chessdadBackupTimer) return;

  const every = intervalMs();
  if (every === 0) {
    log.info("backup: scheduler disabled (BACKUP_INTERVAL_MS=0)");
    return;
  }

  const timer = setInterval(() => runBackup("scheduled"), every);
  // Never hold the process open just to take a backup.
  timer.unref?.();
  globalForBackup.__chessdadBackupTimer = timer;

  log.info("backup: scheduler started", {
    everyMs: every,
    dir: backupDir(),
    retention: retention(),
  });
}

export { backupDir, intervalMs as backupIntervalMs, retention as backupRetention };
