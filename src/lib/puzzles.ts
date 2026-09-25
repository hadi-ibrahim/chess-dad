import "server-only";
import {
  getDb,
  getPuzzleReview,
  puzzleScopeFor,
  upsertPuzzleReview,
} from "./db";
import type { PuzzleRow } from "./types";

export interface PuzzleWithContext extends PuzzleRow {
  /** The account this drill is filed under; the schedule lives with it. */
  scope: string;
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
  /** SM-2 state for this account, defaulted when the drill is new. */
  ease: number;
  interval_days: number;
  repetitions: number;
  due_at: string | null;
  solved_count: number;
  fail_count: number;
}

/**
 * The drills this viewer is owed: puzzles derived from the side they played, in
 * the games in their library.
 *
 * The puzzle itself is global — it was derived once, when the game was analysed —
 * so the second player in that game already has their drills waiting. Only the
 * practising state is theirs.
 */
export function listPuzzlesWithContext(scopes: string[]): PuzzleWithContext[] {
  if (scopes.length === 0) return [];
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT z.*, lg.white, lg.black, lg.opponent, lg.result, lg.opening_name,
              lg.scope AS scope,
              pos.explanation AS source_explanation, pos.key_lesson AS source_key_lesson,
              pos.classification AS source_classification, pos.centipawn_loss AS source_cpl,
              pos.ply AS source_ply, pos.san AS source_san,
              prev.san AS prev_san, ec.pv AS engine_pv,
              pr.ease, pr.interval_days, pr.repetitions, pr.due_at,
              pr.solved_count, pr.fail_count
       FROM puzzles z
       JOIN library_games lg ON lg.id = z.game_id AND lg.player_color = z.color
       LEFT JOIN positions pos ON pos.id = z.position_id
       LEFT JOIN positions prev ON prev.game_id = pos.game_id AND prev.ply = pos.ply - 1
       LEFT JOIN engine_cache ec ON ec.fen = z.fen
       LEFT JOIN puzzle_reviews pr ON pr.scope = lg.scope AND pr.puzzle_id = z.id
       WHERE lg.scope IN (${scopes.map(() => "?").join(",")})
       ORDER BY z.id DESC`
    )
    .all(...scopes) as Record<string, unknown>[];

  return rows.map((r) => ({
    id: Number(r.id),
    game_id: Number(r.game_id),
    position_id: r.position_id == null ? null : Number(r.position_id),
    color: r.color === "b" ? "b" : "w",
    scope: String(r.scope ?? ""),
    fen: String(r.fen ?? ""),
    solution_uci: String(r.solution_uci ?? ""),
    solution_san: String(r.solution_san ?? ""),
    theme: r.theme == null ? null : String(r.theme),
    created_at: String(r.created_at ?? ""),
    ease: r.ease == null ? 2.5 : Number(r.ease),
    interval_days: r.interval_days == null ? 0 : Number(r.interval_days),
    repetitions: r.repetitions == null ? 0 : Number(r.repetitions),
    due_at: r.due_at == null ? null : String(r.due_at),
    solved_count: r.solved_count == null ? 0 : Number(r.solved_count),
    fail_count: r.fail_count == null ? 0 : Number(r.fail_count),
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
export function recordPuzzleAnswer(scopes: string[], id: number, correct: boolean): SrsResult {
  // The schedule is filed under the account that played the side the drill
  // belongs to, so it follows the account between browsers.
  const scope = puzzleScopeFor(scopes, id);
  if (!scope) throw new Error(`Puzzle ${id} is not in this library`);

  const current = getPuzzleReview(scope, id);
  let ease = current.ease;
  let interval = current.interval_days;
  let reps = current.repetitions;

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
  upsertPuzzleReview(scope, id, ease, interval, reps, dueAt, correct);

  return { id, correct, ease, intervalDays: interval, repetitions: reps, dueAt };
}

/** How many drills are waiting right now, for the nav badge. */
export function countDuePuzzles(scopes: string[]): number {
  if (scopes.length === 0) return 0;
  const now = new Date().toISOString();
  const r = getDb()
    .prepare(
      `SELECT COUNT(*) n FROM puzzles z
       JOIN library_games lg ON lg.id = z.game_id AND lg.player_color = z.color
       LEFT JOIN puzzle_reviews pr ON pr.scope = lg.scope AND pr.puzzle_id = z.id
       WHERE lg.scope IN (${scopes.map(() => "?").join(",")})
         AND (pr.due_at IS NULL OR pr.due_at <= ?)`
    )
    .get(...scopes, now) as { n: number };
  return Number(r.n);
}
