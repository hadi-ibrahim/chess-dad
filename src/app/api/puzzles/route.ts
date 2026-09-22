import { NextResponse } from "next/server";
import { listPuzzlesWithContext, recordPuzzleAnswer } from "@/lib/puzzles";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ puzzles: listPuzzlesWithContext() });
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
