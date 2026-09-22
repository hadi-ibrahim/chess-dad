import { NextResponse } from "next/server";
import { analyzeGame } from "@/lib/analysis";

export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gameId = Number(id);
  if (!Number.isInteger(gameId)) {
    return NextResponse.json({ error: "Invalid game id" }, { status: 400 });
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
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
