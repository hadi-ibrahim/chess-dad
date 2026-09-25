/**
 * Shared plumbing for the persistence tests.
 *
 * `src/lib/config.ts` reads `process.env` when it is first imported and
 * `src/lib/db.ts` caches one connection on `globalThis`, so the database path
 * has to be chosen *before* either module is loaded, and a process can only ever
 * have one database. These helpers therefore do two things and nothing else:
 *
 *   * `createTempDatabase(label)` makes a fresh, unique temporary directory and
 *     points `CHESSDAD_DB_PATH` at a file inside it. The random suffix means two
 *     test files running in parallel (or the same file re-run) never collide.
 *   * `loadDb()` / `loadQueue()` perform the dynamic import that must happen
 *     *after* that environment variable is set.
 *
 * This module deliberately imports no application code at the top level — the
 * whole point is to control when the app is first evaluated.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface TempDatabase {
  /** The directory holding the database; remove this to clean up. */
  dir: string;
  /** The absolute path handed to `config.dbPath`. */
  dbPath: string;
}

/** Create a unique temp directory and direct the app's database into it. */
export function createTempDatabase(label: string): TempDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `chessdad-${label}-`));
  const dbPath = path.join(dir, "test.db");
  process.env.CHESSDAD_DB_PATH = dbPath;
  return { dir, dbPath };
}

/** Remove the whole temp directory, taking the `.db`, `-wal` and `-shm` files. */
export function removeTempDatabase(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Import the persistence layer. Call only after `createTempDatabase`. */
export async function loadDb() {
  return import("@/lib/db");
}

/** Import the job queue (and, transitively, the same database connection). */
export async function loadQueue() {
  return import("@/lib/queue");
}
