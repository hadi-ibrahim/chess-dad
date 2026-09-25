#!/usr/bin/env node
/**
 * Take a verified snapshot of the SQLite database, and prune old ones.
 *
 *   node scripts/backup-db.mjs                      # uses CHESSDAD_DB_PATH
 *   node scripts/backup-db.mjs --out /backups       # somewhere else
 *   node scripts/backup-db.mjs --retention 14
 *   node scripts/backup-db.mjs --list
 *
 * This is the same snapshot the app takes on a timer (`src/lib/backup.ts`), as a
 * standalone command — deliberately **not** importing the app's modules, so it
 * still works when the app itself is broken. That is exactly when you want it.
 *
 * `VACUUM INTO` is the right primitive: one statement, consistent snapshot of a
 * live database, no downtime, and the output is a compact standalone file with no
 * WAL to replay.
 *
 * Every snapshot is reopened and checked with `PRAGMA integrity_check` before
 * older copies are pruned, so a corrupt backup can never displace a good one.
 *
 * For an off-box copy, point --out at a mounted bucket or a synced directory. A
 * copy on the same volume protects against a bad write or a mistaken delete, but
 * not against losing the volume itself.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function parseArgs(argv) {
  const out = { db: null, out: null, retention: null, list: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--list") out.list = true;
    else if (arg === "--db") out.db = argv[++i];
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--retention") out.retention = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") out.help = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(
    [
      "Usage: node scripts/backup-db.mjs [options]",
      "",
      "  --db <path>         database to snapshot (default $CHESSDAD_DB_PATH or ./data/chessdad.db)",
      "  --out <dir>         where to write (default $BACKUP_DIR or <db dir>/backups)",
      "  --retention <n>      how many snapshots to keep (default $BACKUP_RETENTION or 7)",
      "  --list              list existing snapshots and exit",
      "",
    ].join("\n")
  );
  process.exit(0);
}

const dbPath = path.resolve(
  args.db || process.env.CHESSDAD_DB_PATH || path.join(process.cwd(), "data", "chessdad.db")
);
const outDir = path.resolve(
  args.out || process.env.BACKUP_DIR || path.join(path.dirname(dbPath), "backups")
);
const retention = (() => {
  if (Number.isFinite(args.retention) && args.retention >= 1) return Math.floor(args.retention);
  const env = Number(process.env.BACKUP_RETENTION);
  return Number.isFinite(env) && env >= 1 ? Math.floor(env) : 7;
})();

const fileStamp = (d = new Date()) => d.toISOString().replace(/[:.]/g, "-");

/** Newest first, only files this tool writes. */
function snapshots() {
  try {
    return fs
      .readdirSync(outDir)
      .filter((f) => /^chessdad-.*\.db$/.test(f))
      .map((f) => path.join(outDir, f))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

if (args.list) {
  const all = snapshots();
  if (all.length === 0) {
    console.log(`No snapshots in ${outDir}`);
    process.exit(0);
  }
  console.log(`${all.length} snapshot(s) in ${outDir}:`);
  for (const f of all) {
    console.log(`  ${path.basename(f)}  ${(fs.statSync(f).size / 1048576).toFixed(1)} MB`);
  }
  process.exit(0);
}

if (!fs.existsSync(dbPath)) {
  console.error(`✗ No database at ${dbPath}`);
  process.exit(1);
}

// Refuse to snapshot a WAL-mode database that another process holds mid-checkpoint?
// No — VACUUM INTO takes a read transaction and is safe on a live database. That
// is the whole point of using it.
const started = Date.now();
fs.mkdirSync(outDir, { recursive: true });
const target = path.join(outDir, `chessdad-${fileStamp()}.db`);

let db;
try {
  db = new DatabaseSync(dbPath);
  // A string literal is required; escape it rather than letting a quote in a path
  // become an injection into this statement.
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
} catch (e) {
  console.error(`✗ Snapshot failed: ${e.message}`);
  try {
    fs.rmSync(target, { force: true });
  } catch {
    /* nothing to clean up */
  }
  process.exit(1);
} finally {
  db?.close();
}

const { size } = fs.statSync(target);
if (size === 0) {
  fs.rmSync(target, { force: true });
  console.error("✗ Snapshot was empty — removed.");
  process.exit(1);
}

// Verify before trusting it, and before pruning anything.
try {
  const verify = new DatabaseSync(target, { readOnly: true });
  try {
    const rows = verify.prepare("PRAGMA integrity_check").all();
    const verdict = String(rows[0]?.integrity_check ?? "");
    if (verdict !== "ok") {
      fs.rmSync(target, { force: true });
      console.error(`✗ Integrity check failed (${verdict}) — snapshot discarded.`);
      process.exit(1);
    }
    const games = verify.prepare("SELECT COUNT(*) AS n FROM games").get();
    console.log(
      `✓ ${path.basename(target)}  ${(size / 1048576).toFixed(1)} MB  ` +
        `${games?.n ?? "?"} games  ${Date.now() - started} ms`
    );
  } finally {
    verify.close();
  }
} catch (e) {
  fs.rmSync(target, { force: true });
  console.error(`✗ Could not verify the snapshot: ${e.message}`);
  process.exit(1);
}

// Prune, oldest first, only once a good snapshot exists.
const all = snapshots();
let pruned = 0;
for (const file of all.slice(retention)) {
  try {
    fs.rmSync(file, { force: true });
    pruned += 1;
  } catch (e) {
    console.error(`  ! could not remove ${path.basename(file)}: ${e.message}`);
  }
}

const digest = createHash("sha256").update(fs.readFileSync(target)).digest("hex").slice(0, 16);
console.log(
  `  sha256:${digest}…  kept ${Math.min(all.length, retention)}/${all.length}` +
    (pruned ? `  pruned ${pruned}` : "")
);
console.log(`  in ${outDir}`);
