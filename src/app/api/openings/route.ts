import { NextResponse } from "next/server";
import { getOpeningEntries, findOpening, detectDeviation } from "@/lib/openings";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ openings: getOpeningEntries() });
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
