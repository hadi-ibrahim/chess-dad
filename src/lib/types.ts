export type Source = "lichess" | "chesscom";
export type Color = "w" | "b";
export type Phase = "opening" | "middlegame" | "endgame";

export type MoveClass =
  | "book"
  | "best"
  | "great"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder"
  | "miss"
  | "forced"
  | "brilliant";

export interface GameRow {
  id: number;
  source: Source;
  external_id: string | null;
  pgn: string;
  white: string;
  black: string;
  white_rating: number | null;
  black_rating: number | null;
  result: string;
  time_control: string;
  speed: string;
  eco: string;
  opening_name: string;
  played_at: string | null;
  player_color: Color;
  player_rating: number | null;
  opponent: string;
  opponent_rating: number | null;
  total_plies: number;
  analyzed: number;
  accuracy: number | null;
  created_at: string;
  /** Flagged moves (mistake + blunder + miss) by the player. */
  flagged?: number;
  blunders?: number;
  /** The costliest of those: where the game turned. */
  decisive_ply?: number | null;
  decisive_cpl?: number | null;
  decisive_san?: string | null;
  decisive_motif?: string | null;
}

export interface PositionRow {
  id: number;
  game_id: number;
  ply: number;
  color: Color;
  fen: string;
  san: string | null;
  uci: string | null;
  fen_after: string;
  best_move: string | null;
  best_move_san: string | null;
  eval_before: number | null;
  mate_before: number | null;
  eval_after: number | null;
  mate_after: number | null;
  centipawn_loss: number | null;
  classification: MoveClass | null;
  motif: string | null;
  phase: Phase | null;
  clock_seconds: number | null;
  is_critical: number;
  explanation: string | null;
  key_lesson: string | null;
  drill_suggestion: string | null;
}

export interface EngineEval {
  bestMove: string; // UCI
  scoreCp: number; // centipawns from the side-to-move's perspective (mate mapped)
  mate: number | null; // +N mates in N, -N gets mated in N, null if cp
  pv: string[];
  depth: number;
}

export interface PlyInfo {
  ply: number;
  color: Color;
  fen: string; // FEN before the move
  san: string | null;
  uci: string | null;
  fenAfter: string; // FEN after the move
  moveNumber: number; // 1-based full-move number
  clockSeconds: number | null;
}

export interface ParsedGame {
  headers: Record<string, string | null>;
  plies: PlyInfo[];
  finalFen: string;
  result: string;
}

export interface LLMExplanation {
  explanation: string;
  key_lesson: string;
  drill_suggestion: string;
}

/** Coarse progress report emitted by long-running jobs. */
export interface JobProgress {
  stage: string;
  progress: number;
}

export interface PuzzleRow {
  id: number;
  game_id: number;
  position_id: number | null;
  fen: string;
  solution_uci: string;
  solution_san: string;
  theme: string | null;
  ease: number;
  interval_days: number;
  repetitions: number;
  due_at: string | null;
  solved_count: number;
  fail_count: number;
  created_at: string;
}
