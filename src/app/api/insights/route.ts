import { NextResponse } from "next/server";
import { computeWeaknesses, PROFILE_WINDOWS, type ProfileWindow } from "@/lib/weaknesses";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("window") ?? "all";
  const window = (PROFILE_WINDOWS as string[]).includes(raw) ? (raw as ProfileWindow) : "all";
  return NextResponse.json({ ...computeWeaknesses(window), window });
}
