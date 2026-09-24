import { NextResponse } from "next/server";
import { listPuzzlesWithContext, recordPuzzleAnswer } from "@/lib/puzzles";
import { activeProfileId } from "@/lib/active-profile";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const profileId = activeProfileId(request);
  return NextResponse.json({ puzzles: profileId == null ? [] : listPuzzlesWithContext(profileId) });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: number; correct?: boolean };
  const id = Number(body.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Invalid puzzle id" }, { status: 400 });
  }
  try {
    const result = recordPuzzleAnswer(id, Boolean(body.correct));
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
