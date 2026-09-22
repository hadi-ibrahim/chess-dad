import "server-only";
import { getDb, listPuzzles, updatePuzzleSrs } from "./db";
import type { PuzzleRow } from "./types";

export interface PuzzleWithContext extends PuzzleRow {
  white: string;
  black: string;
  opponent: string;
  result: string;
  opening: string;
}

/** All puzzles, newest first, with game context for display. */
export function listPuzzlesWithContext(): PuzzleWithContext[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.*, g.white, g.black, g.opponent, g.result, g.opening_name
       FROM puzzles p JOIN games g ON g.id = p.game_id
       ORDER BY p.id DESC`
    )
    .all() as Record<string, unknown>[];

  return rows.map((r) => ({
    id: Number(r.id),
    game_id: Number(r.game_id),
    position_id: r.position_id == null ? null : Number(r.position_id),
    fen: String(r.fen ?? ""),
    solution_uci: String(r.solution_uci ?? ""),
    solution_san: String(r.solution_san ?? ""),
    theme: r.theme == null ? null : String(r.theme),
    ease: Number(r.ease ?? 2.5),
    interval_days: Number(r.interval_days ?? 0),
    repetitions: Number(r.repetitions ?? 0),
    due_at: r.due_at == null ? null : String(r.due_at),
    solved_count: Number(r.solved_count ?? 0),
    fail_count: Number(r.fail_count ?? 0),
    created_at: String(r.created_at ?? ""),
    white: String(r.white ?? ""),
    black: String(r.black ?? ""),
    opponent: String(r.opponent ?? ""),
    result: String(r.result ?? "*"),
    opening: String(r.opening_name ?? ""),
  }));
}

export interface SrsResult {
  id: number;
  correct: boolean;
  ease: number;
  intervalDays: number;
  repetitions: number;
  dueAt: string;
}

/** Apply a simplified SM-2 update on a solved (or failed) puzzle. */
export function recordPuzzleAnswer(id: number, correct: boolean): SrsResult {
  const db = getDb();
  const p = db.prepare("SELECT * FROM puzzles WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!p) throw new Error(`Puzzle ${id} not found`);

  let ease = Number(p.ease ?? 2.5);
  let interval = Number(p.interval_days ?? 0);
  let reps = Number(p.repetitions ?? 0);

  if (correct) {
    reps += 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 6;
    else interval = Math.max(1, Math.round(interval * ease));
    ease = Math.min(2.5, ease + 0.1);
  } else {
    reps = 0;
    interval = 1;
    ease = Math.max(1.3, ease - 0.2);
  }

  const dueAt = new Date(Date.now() + interval * 86_400_000).toISOString();
  updatePuzzleSrs(id, ease, interval, reps, dueAt, correct);

  return { id, correct, ease, intervalDays: interval, repetitions: reps, dueAt };
}

export function countDuePuzzles(): number {
  const db = getDb();
  const now = new Date().toISOString();
  const r = db
    .prepare("SELECT COUNT(*) n FROM puzzles WHERE due_at IS NULL OR due_at <= ?")
    .get(now) as { n: number };
  return Number(r.n);
}

export { listPuzzles };
