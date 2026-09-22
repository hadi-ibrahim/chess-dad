import { NextResponse } from "next/server";
import { listGames, countGames, getProfile } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    profile: getProfile(),
    total: countGames(),
    games: listGames(),
  });
}
