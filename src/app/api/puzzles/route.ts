import { NextResponse } from "next/server";
import { listPuzzlesWithContext, recordPuzzleAnswer } from "@/lib/puzzles";
import { viewerOf } from "@/lib/library";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = viewerOf(request);
  return NextResponse.json({
    puzzles: viewer ? listPuzzlesWithContext(viewer.scopes) : [],
    // Lets the screen say "add a profile" rather than "analyse some games" —
    // there is nothing to analyse for until somebody is set up.
    needsProfile: !viewer,
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: number; correct?: boolean };
  const id = Number(body.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Invalid puzzle id" }, { status: 400 });
  }
  const viewer = viewerOf(request);
  if (!viewer) {
    return NextResponse.json({ error: "No profile is active." }, { status: 409 });
  }
  try {
    const result = recordPuzzleAnswer(viewer.scopes, id, Boolean(body.correct));
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
