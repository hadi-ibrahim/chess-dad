import { NextResponse } from "next/server";
import { getOpeningEntries, findOpening, detectDeviation } from "@/lib/openings";
import { viewerOf } from "@/lib/library";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // The repertoire is theory, not history: it is worth serving even with nobody
  // set up, just without any of the player's own records or review schedule.
  const viewer = viewerOf(request);
  return NextResponse.json({ openings: getOpeningEntries(viewer?.scopes ?? []) });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { eco?: string; moves?: string[] };
  if (!body.eco || !Array.isArray(body.moves)) {
    return NextResponse.json({ error: "Provide eco and moves[]" }, { status: 400 });
  }
  const opening = findOpening(body.eco);
  if (!opening) {
    return NextResponse.json({ error: "Unknown ECO" }, { status: 404 });
  }
  return NextResponse.json(detectDeviation(body.moves, opening));
}
