import { NextResponse } from "next/server";
import { deleteProfile, getProfileById, setProfileToken, updateProfile } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_request: Request, { params }: Ctx) {
  const { id: raw } = await params;
  const id = parseId(raw);
  const profile = id == null ? null : getProfileById(id);
  if (!profile) return NextResponse.json({ error: "Unknown profile" }, { status: 404 });
  return NextResponse.json({ profile });
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { id: raw } = await params;
  const id = parseId(raw);
  if (id == null || !getProfileById(id)) {
    return NextResponse.json({ error: "Unknown profile" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    lichess_username?: string;
    chesscom_username?: string;
    display_name?: string;
    lichessToken?: string;
  };

  updateProfile(id, {
    lichess_username: body.lichess_username,
    chesscom_username: body.chesscom_username,
    display_name: body.display_name,
  });

  // Writing a token is one-way: an empty string clears it, and the stored value
  // is never returned — callers only ever see `lichessTokenSet`.
  if (typeof body.lichessToken === "string") setProfileToken(id, body.lichessToken);

  return NextResponse.json({ profile: getProfileById(id) });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id: raw } = await params;
  const id = parseId(raw);
  if (id == null || !getProfileById(id)) {
    return NextResponse.json({ error: "Unknown profile" }, { status: 404 });
  }
  deleteProfile(id);
  return NextResponse.json({ deleted: id });
}
