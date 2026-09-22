import "server-only";
import { Chess, type Move } from "chess.js";
import type { Color, Phase, ParsedGame, PlyInfo } from "./types";

/** Parse a single PGN (one game) into its headers and per-ply metadata. */
export function parsePgn(pgn: string): ParsedGame {
  const chess = new Chess();
  chess.loadPgn(pgn, { strict: false });
  const headers = chess.header();
  const history = chess.history({ verbose: true }) as Move[];

  const plies: PlyInfo[] = history.map((m, i) => ({
    ply: i,
    color: m.color as Color,
    fen: m.before,
    san: m.san,
    uci: m.lan,
    fenAfter: m.after,
    moveNumber: Math.floor(i / 2) + 1,
    clockSeconds: null,
  }));

  return {
    headers,
    plies,
    finalFen: chess.fen(),
    result: headers.Result || "*",
  };
}

export interface OpeningMeta {
  eco: string;
  name: string;
  ply: number;
}

/** Detect which phase of the game a position belongs to. */
export function detectPhase(fen: string, ply: number): Phase {
  if (ply < 16) return "opening";
  const chess = new Chess(fen);
  const board = chess.board();
  let queens = 0;
  let majorMinor = 0; // rooks + bishops + knights
  for (const row of board) {
    for (const sq of row) {
      if (!sq) continue;
      if (sq.type === "q") queens += 1;
      else if (sq.type === "r" || sq.type === "b" || sq.type === "n") majorMinor += 1;
    }
  }
  if (queens === 0 || majorMinor <= 6) return "endgame";
  return "middlegame";
}

/** Number of legal moves in a position (0 if terminal). */
export function legalMoveCount(fen: string): number {
  const chess = new Chess(fen);
  if (chess.isGameOver()) return 0;
  return chess.moves().length;
}

/** Whether the position is checkmate (side to move is mated). */
export function isCheckmate(fen: string): boolean {
  const chess = new Chess(fen);
  return chess.isCheckmate();
}

export function isDraw(fen: string): boolean {
  const chess = new Chess(fen);
  return chess.isDraw();
}

/** Convert a UCI move to SAN in the given FEN position. */
export function uciToSan(fen: string, uci: string): string | null {
  if (!uci) return null;
  const chess = new Chess(fen);
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci.slice(4, 5) : undefined;
  try {
    const move = chess.move({ from, to, promotion } as never);
    if (!move) return null;
    return move.san;
  } catch {
    return null;
  }
}

export function sanToUci(fen: string, san: string): string | null {
  if (!san) return null;
  const chess = new Chess(fen);
  try {
    const move = chess.move(san);
    if (!move) return null;
    return move.lan;
  } catch {
    return null;
  }
}

export interface Attacker {
  piece: string;
  from: string;
}

/** All (legal) attackers of `square` by the side to move in `fen`. */
export function attackersOf(fen: string, square: string): Attacker[] {
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true }) as Move[];
  return moves
    .filter((m) => m.to === square)
    .map((m) => ({ piece: m.piece, from: m.from }));
}

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export function pieceValue(piece: string): number {
  return PIECE_VALUE[piece.toLowerCase()] ?? 0;
}

export const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
