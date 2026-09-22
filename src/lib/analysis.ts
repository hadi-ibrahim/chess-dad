import "server-only";
import { Chess, type Move } from "chess.js";
import { withEngine, MATE_SCORE, type StockfishEngine } from "./engine";
import { config } from "./config";
import {
  getGame,
  getPositions,
  upsertPosition,
  markGameAnalyzed,
  getEngineCache,
  setEngineCache,
  insertPuzzle,
  puzzleExists,
} from "./db";
import {
  detectPhase,
  uciToSan,
  pieceValue,
  legalMoveCount,
  isCheckmate,
  isDraw,
} from "./chess-core";
import { explainPosition } from "./llm";
import type { EngineEval, MoveClass, Color } from "./types";

// ---------------------------------------------------------------------------
// Pure, reusable scoring helpers
// ---------------------------------------------------------------------------

/** Convert a centipawn score to a win probability (0..1). */
export function winProb(cp: number): number {
  const clamped = Math.max(-1000, Math.min(1000, cp));
  return 1 / (1 + Math.pow(10, -clamped / 400));
}

/** Lichess-style per-move accuracy from a win-probability drop. */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  const loss = (winBefore - winAfter) * 100; // percentage points lost
  const acc = 103.1668 * Math.exp(-0.04354 * loss) - 3.1669;
  return Math.max(0, Math.min(100, acc));
}

export interface ClassifyInput {
  playedUci: string | null;
  bestUci: string;
  cpLoss: number;
  evalBeforeCp: number; // mover's perspective
  mateBefore: number | null; // +N if mover has a forced mate
  isForced: boolean;
  inBook: boolean;
  deliveredMate: boolean;
  isSacrifice: boolean;
}

export function classifyMove(c: ClassifyInput): MoveClass {
  if (c.deliveredMate) return "best";
  if (c.isForced) return "forced";
  if (c.mateBefore !== null && c.mateBefore > 0 && c.playedUci !== c.bestUci) return "miss";
  if (c.evalBeforeCp >= 200 && c.cpLoss >= 150) return "miss";
  if (c.inBook && c.cpLoss <= 25) return "book";
  if (c.cpLoss <= 10) {
    if (c.playedUci === c.bestUci) {
      if (c.isSacrifice) return "brilliant";
      return "best";
    }
    return "great";
  }
  if (c.cpLoss <= 50) return "good";
  if (c.cpLoss <= 100) return "inaccuracy";
  if (c.cpLoss <= 300) return "mistake";
  return "blunder";
}

interface CaptureResult {
  captured: string;
  moved: string;
}

function moveCapture(fen: string, uci: string): CaptureResult | null {
  const chess = new Chess(fen);
  let m: Move | null = null;
  try {
    m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined } as never);
  } catch {
    return null;
  }
  if (!m) return null;
  return { captured: m.captured ?? "", moved: m.piece };
}

/** Is this (best) move a material sacrifice — the mover gives up more value than they capture? */
function isSacrifice(fen: string, uci: string): boolean {
  const cap = moveCapture(fen, uci);
  if (!cap || !cap.captured) return false;
  return pieceValue(cap.moved) > pieceValue(cap.captured);
}

export interface MotifInput {
  mateBefore: number | null;
  cpLoss: number;
  playedUci: string | null;
  bestUci: string;
  bestAfterUci: string; // opponent's best reply to the played move
  fen: string;
}

export function detectMotif(i: MotifInput): string | null {
  if (i.mateBefore !== null && i.mateBefore > 0) return "missed-mate";
  if (i.cpLoss >= 100 && i.playedUci) {
    const playedTo = i.playedUci.slice(2, 4);
    if (i.bestAfterUci && i.bestAfterUci.slice(2, 4) === playedTo) {
      return "hung-piece";
    }
    const cap = moveCapture(i.fen, i.bestUci);
    if (cap && cap.captured && pieceValue(cap.captured) >= 3) {
      return "missed-capture";
    }
    return "tactical";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Engine evaluation with FEN caching + analytic terminal handling
// ---------------------------------------------------------------------------

async function evaluatePosition(engine: StockfishEngine, fen: string, depth: number): Promise<EngineEval> {
  if (isCheckmate(fen)) {
    return { bestMove: "", scoreCp: -MATE_SCORE, mate: 0, pv: [], depth };
  }
  if (isDraw(fen)) {
    return { bestMove: "", scoreCp: 0, mate: null, pv: [], depth };
  }
  const cached = getEngineCache(fen);
  if (cached && cached.depth >= depth) {
    return {
      bestMove: cached.best_move,
      scoreCp: cached.score_cp,
      mate: cached.mate,
      pv: cached.pv ? cached.pv.split(" ") : [],
      depth: cached.depth,
    };
  }
  const e = await engine.analyze(fen, depth);
  setEngineCache(fen, e.bestMove, e.scoreCp, e.mate, e.pv.join(" "), e.depth);
  return e;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface AnalyzeProgress {
  stage: string;
  done: number;
  total: number;
  progress: number;
}

export interface AnalyzeOptions {
  depth?: number;
  explain?: boolean;
  generatePuzzles?: boolean;
  onProgress?: (info: AnalyzeProgress) => void;
}

export interface AnalyzeResult {
  gameId: number;
  accuracy: number | null;
  criticalCount: number;
  puzzleCount: number;
}

export async function analyzeGame(gameId: number, opts: AnalyzeOptions = {}): Promise<AnalyzeResult> {
  // Hold one engine for the whole game so concurrent games run in parallel.
  return withEngine((engine) => analyzeGameWithEngine(engine, gameId, opts));
}

async function analyzeGameWithEngine(
  engine: StockfishEngine,
  gameId: number,
  opts: AnalyzeOptions
): Promise<AnalyzeResult> {
  const depth = opts.depth ?? config.analysisDepth;
  const explain = opts.explain ?? true;
  const generatePuzzles = opts.generatePuzzles ?? true;

  const game = getGame(gameId);
  if (!game) throw new Error(`Game ${gameId} not found`);

  const positions = getPositions(gameId);
  if (positions.length === 0) throw new Error("Game has no moves to analyze (import first)");

  const fens: string[] = positions.map((p) => p.fen);
  fens.push(positions[positions.length - 1].fen_after); // final position

  const evals: EngineEval[] = [];
  for (let i = 0; i < fens.length; i++) {
    evals.push(await evaluatePosition(engine, fens[i], depth));
    opts.onProgress?.({
      stage: "engine",
      done: i + 1,
      total: fens.length,
      progress: ((i + 1) / fens.length) * 0.85,
    });
  }

  let accuracySum = 0;
  let accuracyCount = 0;
  let criticalCount = 0;
  let puzzleCount = 0;

  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const eBefore = evals[i];
    const eAfter = evals[i + 1];

    // All scores are from the side-to-move's perspective.
    const evalBeforeCp = eBefore.scoreCp; // mover's perspective
    const evalAfterCp = -eAfter.scoreCp; // mover's perspective (negate opponent's view)
    const cpLoss = Math.max(0, evalBeforeCp - evalAfterCp);

    const deliveredMate = isCheckmate(p.fen_after);
    const isForced = legalMoveCount(p.fen) === 1;
    const inBook = i < 12;
    const bestUci = eBefore.bestMove;
    const mateBefore = eBefore.mate;
    const playedUci = p.uci ?? "";

    const sacrifice = isSacrifice(p.fen, bestUci);
    const classification = classifyMove({
      playedUci,
      bestUci,
      cpLoss,
      evalBeforeCp,
      mateBefore,
      isForced,
      inBook,
      deliveredMate,
      isSacrifice: sacrifice,
    });

    const motif = detectMotif({
      mateBefore,
      cpLoss,
      playedUci: p.uci,
      bestUci,
      bestAfterUci: eAfter.bestMove,
      fen: p.fen,
    });

    const phase = detectPhase(p.fen, i);
    const isCritical = cpLoss > 100 || classification === "miss" ? 1 : 0;
    if (isCritical) criticalCount += 1;

    const bestSan = uciToSan(p.fen, bestUci) ?? (bestUci || null);

    // Game accuracy is measured over the player's own moves.
    if (p.color === game.player_color) {
      const acc = deliveredMate
        ? 100
        : moveAccuracy(winProb(evalBeforeCp), winProb(evalAfterCp));
      accuracySum += acc;
      accuracyCount += 1;
    }

    upsertPosition({
      game_id: gameId,
      ply: p.ply,
      color: p.color,
      fen: p.fen,
      san: p.san,
      uci: p.uci,
      fen_after: p.fen_after,
      best_move: bestUci || null,
      best_move_san: bestSan,
      eval_before: evalBeforeCp,
      mate_before: mateBefore,
      eval_after: eAfter.scoreCp, // opponent's perspective (side-to-move after the move)
      mate_after: eAfter.mate,
      centipawn_loss: cpLoss,
      classification,
      motif,
      phase,
      clock_seconds: p.clock_seconds,
      is_critical: isCritical,
      explanation: p.explanation,
      key_lesson: p.key_lesson,
      drill_suggestion: p.drill_suggestion,
    });

    // Build personal puzzles from the player's own serious mistakes.
    if (
      generatePuzzles &&
      p.color === game.player_color &&
      (classification === "blunder" || classification === "mistake" || classification === "miss") &&
      bestUci &&
      !puzzleExists(p.fen)
    ) {
      insertPuzzle({
        game_id: gameId,
        position_id: p.id,
        fen: p.fen,
        solution_uci: bestUci,
        solution_san: bestSan ?? "",
        theme: motif,
      });
      puzzleCount += 1;
    }
  }

  const accuracy = accuracyCount > 0 ? accuracySum / accuracyCount : null;
  markGameAnalyzed(gameId, accuracy ?? -1);

  opts.onProgress?.({
    stage: explain ? "explain" : "done",
    done: positions.length,
    total: positions.length,
    progress: explain ? 0.9 : 1,
  });

  // Generate coaching explanations for the player's critical moments.
  if (explain) {
    const fresh = getPositions(gameId);
    for (const pos of fresh) {
      if (pos.is_critical && pos.color === game.player_color && pos.best_move) {
        const ex = await explainPosition({
          fen: pos.fen,
          playedSan: pos.san ?? "",
          bestSan: pos.best_move_san ?? pos.best_move ?? "",
          evalBeforeCp: pos.eval_before ?? 0,
          evalAfterCp: pos.eval_after != null ? -pos.eval_after : 0, // mover's perspective
          classification: pos.classification ?? "inaccuracy",
          motif: pos.motif,
          openingName: game.opening_name,
          rating: game.player_rating ?? 1200,
        });
        upsertPosition({
          game_id: gameId,
          ply: pos.ply,
          color: pos.color,
          fen: pos.fen,
          san: pos.san,
          uci: pos.uci,
          fen_after: pos.fen_after,
          best_move: pos.best_move,
          best_move_san: pos.best_move_san,
          eval_before: pos.eval_before,
          mate_before: pos.mate_before,
          eval_after: pos.eval_after,
          mate_after: pos.mate_after,
          centipawn_loss: pos.centipawn_loss,
          classification: pos.classification,
          motif: pos.motif,
          phase: pos.phase,
          clock_seconds: pos.clock_seconds,
          is_critical: pos.is_critical,
          explanation: ex.explanation,
          key_lesson: ex.key_lesson,
          drill_suggestion: ex.drill_suggestion,
        });
      }
    }
  }

  opts.onProgress?.({ stage: "done", done: positions.length, total: positions.length, progress: 1 });
  return { gameId, accuracy, criticalCount, puzzleCount };
}

export type { Color };
