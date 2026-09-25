import { NextResponse } from "next/server";
import { libraryCounts } from "@/lib/db";
import { scopesOf } from "@/lib/identity";
import { syncLibrary } from "@/lib/library";
import type { BrowserProfile } from "@/lib/profile-cookie";

export const dynamic = "force-dynamic";

interface Draft {
  id?: string;
  name?: string;
  lichess?: string;
  chesscom?: string;
}

function toProfile(draft: Draft): BrowserProfile | null {
  if (!draft || typeof draft.id !== "string" || !draft.id) return null;
  return {
    id: draft.id,
    name: typeof draft.name === "string" ? draft.name : "",
    lichess: typeof draft.lichess === "string" ? draft.lichess : "",
    chesscom: typeof draft.chesscom === "string" ? draft.chesscom : "",
  };
}

/**
 * Library totals for the profiles this browser holds.
 *
 * The profiles themselves are local, so the screen sends them up to be counted.
 * Counting also links the accounts first: a profile that has just been set up in
 * a new browser already has every game waiting, and this is where it finds out.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { profiles?: Draft[] };
  const drafts = Array.isArray(body.profiles) ? body.profiles.slice(0, 50) : [];

  const stats = drafts.map((draft) => {
    const profile = toProfile(draft);
    if (!profile) return { id: "", games: 0, analyzed: 0, puzzles: 0 };
    try {
      // Throttled internally, and idempotent: a brand-new scope always links on
      // its first call, and later calls only matter for newly imported games.
      syncLibrary(profile);
    } catch {
      // counting must not fail because linking did
    }
    return { id: profile.id, ...libraryCounts(scopesOf(profile)) };
  });

  return NextResponse.json({ stats });
}
