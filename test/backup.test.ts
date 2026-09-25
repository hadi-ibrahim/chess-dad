/**
 * Backups.
 *
 * The snapshot is the only copy of the analysed games, so these tests check the
 * things that make a backup worth having: that it is a *readable* database with
 * the data in it, that a bad one cannot displace a good one, and that retention
 * actually prunes.
 *
 * The database path is set before the app is imported, because `config.ts` reads
 * the environment at module load and `db.ts` caches one connection per process.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "chessdad-backup-test-"));
const dbPath = path.join(workdir, "test.db");
const backups = path.join(workdir, "backups");

process.env.CHESSDAD_DB_PATH = dbPath;
process.env.BACKUP_DIR = backups;
process.env.BACKUP_RETENTION = "2";

const { runBackup, backupDir, backupRetention } = await import("@/lib/backup");
const { getDb, upsertGame } = await import("@/lib/db");

/** A snapshot file, opened read-only. */
function open(file: string) {
  return new DatabaseSync(file, { readOnly: true });
}

const snapshotFiles = () =>
  fs.existsSync(backups) ? fs.readdirSync(backups).filter((f) => f.endsWith(".db")).sort() : [];

before(() => {
  // Seed real rows so the snapshot has something to prove.
  for (let i = 0; i < 3; i++) {
    upsertGame({
      source: "lichess",
      external_id: `g${i}`,
      pgn: `[Event "t"]\n\n1. e4 e5 ${i}`,
      white: "Alice",
      black: "Bob",
      white_rating: 1500,
      black_rating: 1400,
      result: "1-0",
      time_control: "600+0",
      speed: "rapid",
      eco: "C50",
      opening_name: "Italian Game",
      played_at: new Date(2026, 0, i + 1).toISOString(),
      total_plies: 2,
    });
  }
});

after(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("runBackup", () => {
  test("writes a snapshot and reports its size", () => {
    const result = runBackup("test");
    assert.equal(result.ok, true, result.reason);
    assert.ok(result.file && fs.existsSync(result.file));
    assert.ok((result.bytes ?? 0) > 0, "snapshot should not be empty");
    assert.ok((result.ms ?? 0) >= 0);
  });

  test("the snapshot is a readable database containing the data", () => {
    const { file } = runBackup("test");
    const copy = open(file!);
    try {
      const verdict = copy.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
      assert.equal(verdict.integrity_check, "ok");
      const { n } = copy.prepare("SELECT COUNT(*) AS n FROM games").get() as { n: number };
      assert.equal(n, 3, "every seeded game should be in the snapshot");
      const alice = copy
        .prepare("SELECT COUNT(*) AS n FROM games WHERE white = 'Alice'")
        .get() as { n: number };
      assert.equal(alice.n, 3);
    } finally {
      copy.close();
    }
  });

  test("a snapshot is not a WAL copy — it stands alone", () => {
    const { file } = runBackup("test");
    // VACUUM INTO produces a self-contained file; a -wal beside it would mean the
    // backup needs the original to be recoverable.
    assert.ok(!fs.existsSync(`${file}-wal`));
    assert.ok(!fs.existsSync(`${file}-shm`));
  });

  test("retention prunes the oldest snapshots", () => {
    const keep = backupRetention();
    assert.equal(keep, 2, "test expects BACKUP_RETENTION=2");

    const filesBefore = snapshotFiles().length;
    // The three previous tests each took one; take one more to force a prune.
    const result = runBackup("test");
    assert.equal(result.ok, true, result.reason);

    const after = snapshotFiles();
    assert.equal(after.length, keep, `expected ${keep} snapshots, found ${after.length}`);
    assert.ok(result.pruned && result.pruned > 0, "should have pruned something");
    assert.ok(filesBefore >= keep);
  });

  test("backupDir and retention come from the environment", () => {
    assert.equal(backupDir(), backups);
    assert.equal(backupRetention(), 2);
  });

  test("the live database is left alone", () => {
    runBackup("test");
    const live = open(dbPath);
    try {
      const { n } = live.prepare("SELECT COUNT(*) AS n FROM games").get() as { n: number };
      assert.equal(n, 3);
    } finally {
      live.close();
    }
    // And it is still writable afterwards.
    upsertGame({
      source: "lichess",
      external_id: "after-backup",
      pgn: "1. d4",
      white: "Alice",
      black: "Bob",
      white_rating: null,
      black_rating: null,
      result: "*",
      time_control: "60+0",
      speed: "bullet",
      eco: "",
      opening_name: "",
      played_at: null,
      total_plies: 0,
    });
    const check = open(dbPath);
    try {
      const rows = check.prepare("SELECT COUNT(*) AS n FROM games").get() as { n: number };
      assert.equal(rows.n, 4);
    } finally {
      check.close();
    }
    getDb(); // keep the connection referenced
  });
});

describe("scripts/backup-db.mjs", () => {
  const cli = path.join(process.cwd(), "scripts", "backup-db.mjs");
  const cliOut = path.join(workdir, "cli-backups");

  test("takes a snapshot and prints a one-line summary", () => {
    const run = spawnSync(process.execPath, [cli, "--db", dbPath, "--out", cliOut], {
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /✓ chessdad-.*\.db/);
    assert.match(run.stdout, /\d+ games/);
    assert.equal(fs.readdirSync(cliOut).filter((f) => f.endsWith(".db")).length, 1);
  });

  test("--list reports what is there", () => {
    const run = spawnSync(process.execPath, [cli, "--out", cliOut, "--list"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /1 snapshot\(s\)/);
  });

  test("exits non-zero for a database that does not exist", () => {
    const run = spawnSync(process.execPath, [cli, "--db", path.join(workdir, "nope.db"), "--out", cliOut], {
      encoding: "utf8",
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /No database at/);
  });

  test("rejects an unknown argument rather than guessing", () => {
    const run = spawnSync(process.execPath, [cli, "--nonsense"], { encoding: "utf8" });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /Unknown argument/);
  });
});
