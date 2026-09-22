import { NextResponse } from "next/server";
import { getGame, getPositions, deleteGame } from "@/lib/db";
import { parsePgn } from "@/lib/chess-core";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const game = getGame(Number(id));
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }

  let positions = getPositions(Number(id));

  // Defensive fallback: rebuild minimal rows from the stored PGN if empty.
  if (positions.length === 0 && game.pgn) {
    const parsed = parsePgn(game.pgn);
    positions = parsed.plies.map((p) => ({
      id: 0,
      game_id: game.id,
      ply: p.ply,
      color: p.color,
      fen: p.fen,
      san: p.san,
      uci: p.uci,
      fen_after: p.fenAfter,
      best_move: null,
      best_move_san: null,
      eval_before: null,
      mate_before: null,
      eval_after: null,
      mate_after: null,
      centipawn_loss: null,
      classification: null,
      motif: null,
      phase: null,
      clock_seconds: p.clockSeconds,
      is_critical: 0,
      explanation: null,
      key_lesson: null,
      drill_suggestion: null,
    }));
  }

  return NextResponse.json({ game, positions });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const game = getGame(Number(id));
  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });
  deleteGame(Number(id));
  return NextResponse.json({ ok: true });
}
