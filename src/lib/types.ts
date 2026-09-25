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

/**
 * The chess itself. A game is global: two people who played each other share one
 * row and one analysis, so nothing here names a player, a colour or a profile.
 */
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
  total_plies: number;
  analyzed: number;
  /** Accuracy is per side, because the game does not belong to one player. */
  accuracy_white: number | null;
  accuracy_black: number | null;
  created_at: string;
}

/** A game as one account saw it: their colour, their opponent, their accuracy. */
export interface LibraryGameRow extends GameRow {
  /** The account whose library this is, e.g. `lichess:rooronoa`. */
  scope: string;
  player_color: Color;
  player_rating: number | null;
  opponent: string;
  opponent_rating: number | null;
  /** The viewer's own accuracy, picked from the side they played. */
  accuracy: number | null;
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

/**
 * The derived drill: a position where someone went wrong and the move they
 * should have found. Global, like the analysis it comes from — the practising
 * state lives separately in `puzzle_reviews`, keyed by account.
 */
export interface PuzzleRow {
  id: number;
  game_id: number;
  position_id: number | null;
  /** The side whose move it was; only they are served this drill. */
  color: Color;
  fen: string;
  solution_uci: string;
  solution_san: string;
  theme: string | null;
  created_at: string;
}
