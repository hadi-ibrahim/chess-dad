import { ratingBand, type AiExplanationKey } from "./llm-providers";
import type { ExplainInput } from "./llm";
import type { LibraryGameRow, PositionRow } from "./types";

/**
 * One place that turns a stored position into (a) the prompt input and (b) the AI
 * cache key.
 *
 * Both the write path (`POST /api/games/[id]/ai`) and the read path
 * (`GET /api/games/[id]`, which attaches each position's existing AI readings)
 * must agree exactly, or a freshly stored answer would not be found again. These
 * helpers are the contract.
 */

/** The mover's own rating: the same mistake is a different lesson at 900 and 2100. */
export function moverRating(game: LibraryGameRow, pos: PositionRow): number {
  return (pos.color === "w" ? game.white_rating : game.black_rating) ?? 1200;
}

export function explainInputFor(game: LibraryGameRow, pos: PositionRow): ExplainInput {
  return {
    fen: pos.fen,
    playedSan: pos.san ?? "",
    bestSan: pos.best_move_san ?? pos.best_move ?? "",
    evalBeforeCp: pos.eval_before ?? 0,
    // Stored from the opponent's point of view; the mover's is the negation.
    evalAfterCp: pos.eval_after != null ? -pos.eval_after : 0,
    classification: pos.classification ?? "inaccuracy",
    motif: pos.motif,
    openingName: game.opening_name,
    rating: moverRating(game, pos),
  };
}

export function aiKeyFor(game: LibraryGameRow, pos: PositionRow): AiExplanationKey {
  return {
    fen: pos.fen,
    playedUci: pos.uci ?? "",
    classification: pos.classification ?? "inaccuracy",
    ratingBand: ratingBand(moverRating(game, pos)),
  };
}

/** The key for a position that was never stored (the review screen's fallback rows). */
export function aiKeyForRaw(
  fen: string,
  playedUci: string,
  classification: string,
  rating: number
): AiExplanationKey {
  return { fen, playedUci, classification, ratingBand: ratingBand(rating) };
}
