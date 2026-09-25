import { NextResponse } from "next/server";
import { computeWeaknesses, PROFILE_WINDOWS, type ProfileWindow } from "@/lib/weaknesses";
import { viewerOf } from "@/lib/library";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("window") ?? "all";
  const window = (PROFILE_WINDOWS as string[]).includes(raw) ? (raw as ProfileWindow) : "all";
  const viewer = viewerOf(request);
  if (!viewer) {
    return NextResponse.json(
      { error: "No profile is active. Add one on the Profiles tab." },
      { status: 409 }
    );
  }
  return NextResponse.json({ ...computeWeaknesses(window, viewer.scopes), window });
}
