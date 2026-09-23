import "server-only";
import { getDb, listPuzzles, updatePuzzleSrs } from "./db";
import type { PuzzleRow } from "./types";

export interface PuzzleWithContext extends PuzzleRow {
  white: string;
  black: string;
  opponent: string;
  result: string;
  opening: string;
  /** Coach's note on the mistake this puzzle came from, when one was written. */
  explanation: string | null;
  key_lesson: string | null;
  /** Context of the source position: what was played, how bad it was, whose move it was. */
  source_classification: string | null;
  source_centipawn_loss: number | null;
  source_ply: number | null;
  source_san: string | null;
  /** The opponent's move immediately before the puzzle position. */
  prev_san: string | null;
  /** Cached engine line for the puzzle position (UCI), used to play the drill out. */
  pv: string[];
}

/** All puzzles, newest first, with game context and the source position's coaching. */
export function listPuzzlesWithContext(): PuzzleWithContext[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.*, g.white, g.black, g.opponent, g.result, g.opening_name,
              pos.explanation AS source_explanation, pos.key_lesson AS source_key_lesson,
              pos.classification AS source_classification, pos.centipawn_loss AS source_cpl,
              pos.ply AS source_ply, pos.san AS source_san,
              prev.san AS prev_san, ec.pv AS engine_pv
       FROM puzzles p
       JOIN games g ON g.id = p.game_id
       LEFT JOIN positions pos ON pos.id = p.position_id
       LEFT JOIN positions prev ON prev.game_id = pos.game_id AND prev.ply = pos.ply - 1
       LEFT JOIN engine_cache ec ON ec.fen = p.fen
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
    // Lesson text comes from multi-line OKF prose; collapse it so a literal
    // newline never lands mid-sentence in the UI.
    explanation: r.source_explanation == null ? null : String(r.source_explanation).replace(/\s+/g, " ").trim(),
    key_lesson: r.source_key_lesson == null ? null : String(r.source_key_lesson).replace(/\s+/g, " ").trim(),
    source_classification: r.source_classification == null ? null : String(r.source_classification),
    source_centipawn_loss: r.source_cpl == null ? null : Number(r.source_cpl),
    source_ply: r.source_ply == null ? null : Number(r.source_ply),
    source_san: r.source_san == null ? null : String(r.source_san),
    prev_san: r.prev_san == null ? null : String(r.prev_san),
    pv: r.engine_pv == null ? [] : String(r.engine_pv).trim().split(/\s+/).filter(Boolean),
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
