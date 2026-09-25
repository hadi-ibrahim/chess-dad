import { NextResponse } from "next/server";
import { analyzeGame } from "@/lib/analysis";
import { getLibraryGame } from "@/lib/db";
import { viewerOf } from "@/lib/library";
import { enforceRateLimit } from "@/lib/rate-limit";

export const maxDuration = 300;

/**
 * Run the engine over one game, synchronously.
 *
 * This is the most expensive endpoint in the app — a whole game of Stockfish
 * inside a single request — so it gets both of the app's coarse protections:
 *
 *  * **A rate limit**, which is the one that actually bounds CPU. It is per IP
 *    and best-effort (see `rate-limit.ts`), but it turns "loop over game ids and
 *    pin the engine pool" into "five a minute".
 *  * **A profile gate**, matching every other route: the caller must have an
 *    active profile and the game must be in one of its accounts' libraries, so
 *    the `/api/games/1..1000` sweep is not even a well-formed request.
 *
 * The gate is consistency, not a security boundary — `cd_profile` is set by the
 * client, so it can be forged. The rate limit is what protects the box.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gameId = Number(id);
  if (!Number.isInteger(gameId)) {
    return NextResponse.json({ error: "Invalid game id" }, { status: 400 });
  }

  const limited = enforceRateLimit(req, "analyze");
  if (limited) return limited;

  const viewer = viewerOf(req);
  if (!viewer) {
    return NextResponse.json(
      { error: "No profile is active. Add one on the Profiles tab first." },
      { status: 409 }
    );
  }
  if (!getLibraryGame(gameId, viewer.scopes)) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    depth?: number;
    explain?: boolean;
    generatePuzzles?: boolean;
  };

  const depth =
    typeof body.depth === "number"
      ? Math.min(Math.max(Math.floor(body.depth), 6), 30)
      : undefined;

  try {
    const result = await analyzeGame(gameId, {
      depth,
      explain: body.explain !== false,
      generatePuzzles: body.generatePuzzles !== false,
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = (e as Error).message;
    // An empty game is a client-side mistake, not a server fault.
    const status = /no moves/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
