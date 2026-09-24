import { NextResponse } from "next/server";
import { computeWeaknesses, PROFILE_WINDOWS, type ProfileWindow } from "@/lib/weaknesses";
import { activeProfileId } from "@/lib/active-profile";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("window") ?? "all";
  const window = (PROFILE_WINDOWS as string[]).includes(raw) ? (raw as ProfileWindow) : "all";
  const profileId = activeProfileId(request);
  if (profileId == null) {
    return NextResponse.json({ error: "No profile selected." }, { status: 404 });
  }
  return NextResponse.json({ ...computeWeaknesses(window, profileId), window });
}
