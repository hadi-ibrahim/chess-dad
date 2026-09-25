import { NextResponse } from "next/server";
import { getLibraryGame, getPositions } from "@/lib/db";
import { viewerOf } from "@/lib/library";
import { aiKeyFor, explainInputFor } from "@/lib/ai-context";
import { AiRequestError, aiExplainPosition, llmUsage } from "@/lib/llm";
import { sanitizeConnection } from "@/lib/llm-providers";

/** A whole-game run is one request per critical move, each up to LLM_TIMEOUT_MS. */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * The upper bound on how many positions one request will pay for. A game has
 * roughly 6-8 critical moments; this exists so a pathological game cannot turn
 * one click into a hundred billed calls.
 */
const MAX_POSITIONS = 40;

/**
 * Explain a game's positions with a provider **the caller configured**.
 *
 * This is the "re-analysis with AI" action, and it is deliberately not a queued
 * job: the API key lives in the browser and must not be parked anywhere between a
 * request and a worker. It arrives in the body, is used for this request's
 * outbound calls, and is gone when the response is sent — the same model the
 * Lichess import uses.
 *
 * With `ply` it explains a single position (the review screen's per-move preview);
 * without it, every flagged position in the game. The deterministic engine coach
 * is untouched either way: AI answers are stored beside it, not over it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gameId = Number(id);
  if (!Number.isInteger(gameId)) {
    return NextResponse.json({ error: "Invalid game id" }, { status: 400 });
  }

  const viewer = viewerOf(request);
  if (!viewer) {
    return NextResponse.json(
      { error: "No profile is active. Add one on the Profiles tab first." },
      { status: 409 }
    );
  }
  const game = getLibraryGame(gameId, viewer.scopes);
  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as {
    connection?: unknown;
    ply?: unknown;
  };

  const checked = sanitizeConnection(body.connection);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const connection = checked.connection;

  const all = getPositions(gameId);
  const playable = all.filter((p) => p.best_move && p.fen);

  const single = typeof body.ply === "number" && Number.isInteger(body.ply) ? body.ply : null;
  let targets = single == null ? playable.filter((p) => p.is_critical === 1) : playable.filter((p) => p.ply === single);

  if (single != null && targets.length === 0) {
    return NextResponse.json(
      { error: "There is no engine-analysed position at that move yet." },
      { status: 404 }
    );
  }
  if (targets.length === 0) {
    return NextResponse.json(
      { error: "This game has no flagged moves to explain. Run the engine analysis first." },
      { status: 400 }
    );
  }
  targets = targets.slice(0, MAX_POSITIONS);

  const results: {
    ply: number;
    provider: string;
    model: string;
    explanation: string;
    key_lesson: string;
    drill_suggestion: string;
    cached: boolean;
  }[] = [];
  const errors: { ply: number; message: string; kind: "connection" | "content" }[] = [];

  for (const pos of targets) {
    try {
      const out = await aiExplainPosition(explainInputFor(game, pos), connection, aiKeyFor(game, pos));
      results.push({ ply: pos.ply, ...out });
    } catch (e) {
      const kind = e instanceof AiRequestError ? e.kind : "connection";
      errors.push({ ply: pos.ply, message: (e as Error).message, kind });
      // A configuration problem (bad key, unreachable host, rate limit) would fail
      // identically for every remaining move. Stop rather than bill for a wall of
      // the same error; a one-off content refusal does not stop the run.
      if (kind === "connection" && results.length === 0) break;
    }
  }

  if (results.length === 0) {
    return NextResponse.json(
      { error: errors[0]?.message ?? "The provider returned no explanation.", errors },
      { status: 502 }
    );
  }

  return NextResponse.json({
    results,
    errors,
    analyzed: results.length,
    provider: connection.provider,
    model: results[0]?.model ?? connection.model,
    usage: llmUsage(),
  });
}
