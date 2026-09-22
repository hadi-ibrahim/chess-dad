import { NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/db";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    lichessTokenSet: Boolean(getSetting("lichess_token") || config.lichessToken),
    llmProvider: config.llmProvider,
  });
}

export async function DELETE() {
  setSetting("lichess_token", "");
  return NextResponse.json({ lichessTokenSet: Boolean(config.lichessToken) });
}
