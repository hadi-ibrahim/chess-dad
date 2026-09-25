import { NextResponse } from "next/server";
import { getLibraryGame, getPositions, groupAiExplanations, listAiExplanationsForFens, unlinkGame } from "@/lib/db";
import { viewerOf } from "@/lib/library";
import { parsePgn } from "@/lib/chess-core";
import { aiKeyFor } from "@/lib/ai-context";
import { positionKeyString } from "@/lib/llm-providers";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = viewerOf(request);
  // The game is only readable through one of the viewer's accounts: the review
  // screen needs to know which side was theirs.
  const game = viewer ? getLibraryGame(Number(id), viewer.scopes) : null;
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

  // Every AI reading of any position in this game, attached where it belongs.
  //
  // This is what lets the review show more than the newest answer: a position can
  // carry Claude's reading from last week and GPT's from today, and the screen
  // offers both. Most positions have none, so the map is almost always tiny.
  const aiByPosition = groupAiExplanations(
    listAiExplanationsForFens(positions.map((p) => p.fen))
  );
  const withAi = positions.map((p) => {
    const rows = aiByPosition.get(positionKeyString(aiKeyFor(game, p)));
    if (!rows || rows.length === 0) return p;
    return {
      ...p,
      ai: rows.map((row) => ({
        provider: row.provider,
        model: row.model,
        explanation: row.explanation,
        key_lesson: row.key_lesson,
        drill_suggestion: row.drill_suggestion,
        created_at: row.created_at,
      })),
    };
  });

  return NextResponse.json({ game, positions: withAi });
}

/**
 * Remove the game from the acting profile's library.
 *
 * Its analysis is only destroyed once no other account references it, so
 * deleting your copy never deletes an opponent's.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = viewerOf(request);
  if (!viewer) return NextResponse.json({ error: "No profile is active" }, { status: 409 });
  const game = getLibraryGame(Number(id), viewer.scopes);
  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });
  unlinkGame(Number(id), viewer.scopes);
  return NextResponse.json({ ok: true });
}
