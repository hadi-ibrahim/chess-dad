import { NextResponse } from "next/server";
import { createProfile, listProfiles, setProfileToken } from "@/lib/db";
import { activeProfileId } from "@/lib/active-profile";

export const dynamic = "force-dynamic";

/**
 * The profile directory.
 *
 * There is no auth by design: anyone using the app can add a profile and search
 * the rest, which is what makes it shareable between people. It also means the
 * app is single-tenant — do not expose it publicly without real auth.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json({
    profiles: listProfiles(q),
    activeProfileId: activeProfileId(request),
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    lichess_username?: string;
    chesscom_username?: string;
    display_name?: string;
    lichessToken?: string;
  };

  const lichess = (body.lichess_username ?? "").trim();
  const chesscom = (body.chesscom_username ?? "").trim();
  if (!lichess && !chesscom) {
    return NextResponse.json({ error: "Add a Lichess or Chess.com username." }, { status: 400 });
  }

  const id = createProfile({
    lichess_username: lichess,
    chesscom_username: chesscom,
    display_name: (body.display_name ?? "").trim(),
  });

  // Accepted on create, stored, and never echoed back.
  if (typeof body.lichessToken === "string" && body.lichessToken.trim()) {
    setProfileToken(id, body.lichessToken);
  }

  return NextResponse.json({ id }, { status: 201 });
}
