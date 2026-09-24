import { NextResponse } from "next/server";
import { getOpeningEntries, findOpening, detectDeviation } from "@/lib/openings";
import { activeProfileId } from "@/lib/active-profile";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const profileId = activeProfileId(request);
  return NextResponse.json({ openings: profileId == null ? [] : getOpeningEntries(profileId) });
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
