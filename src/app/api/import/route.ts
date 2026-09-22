import { NextResponse } from "next/server";
import { importLichess } from "@/lib/importers/lichess";
import { importChessCom } from "@/lib/importers/chesscom";
import { setProfile } from "@/lib/db";
import { config } from "@/lib/config";

export const maxDuration = 300;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    lichess?: string;
    chesscom?: string;
    max?: number;
  };

  const lichess = typeof body.lichess === "string" ? body.lichess.trim() : "";
  const chesscom = typeof body.chesscom === "string" ? body.chesscom.trim() : "";
  const max = Math.min(
    Math.max(typeof body.max === "number" ? Math.floor(body.max) : config.maxGamesPerSource, 1),
    200
  );

  if (!lichess && !chesscom) {
    return NextResponse.json(
      { error: "Provide a Lichess and/or Chess.com username." },
      { status: 400 }
    );
  }

  const results: {
    lichess: { username: string; count: number } | null;
    chesscom: { username: string; count: number } | null;
    errors: { source: string; message: string }[];
  } = { lichess: null, chesscom: null, errors: [] };

  if (lichess) {
    try {
      results.lichess = await importLichess(lichess, max);
    } catch (e) {
      results.errors.push({ source: "lichess", message: (e as Error).message });
    }
  }
  if (chesscom) {
    try {
      results.chesscom = await importChessCom(chesscom, max);
    } catch (e) {
      results.errors.push({ source: "chesscom", message: (e as Error).message });
    }
  }

  if (lichess || chesscom) {
    setProfile({ lichess_username: lichess, chesscom_username: chesscom });
  }

  return NextResponse.json(results);
}
