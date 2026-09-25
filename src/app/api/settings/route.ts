import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { libraryCounts } from "@/lib/db";
import { labelOf } from "@/lib/identity";
import { syncLibrary, viewerOf } from "@/lib/library";

export const dynamic = "force-dynamic";

/**
 * The acting profile, its library totals, and whether the deployment supplies a
 * Lichess token of its own.
 *
 * The server holds nothing about the caller: the profile comes from the browser's
 * cookie, and the personal Lichess token never leaves the browser at all — it is
 * sent on the import call and nowhere else. There is deliberately no endpoint
 * here that accepts a token.
 */
export async function GET(request: Request) {
  const viewer = viewerOf(request);
  const profile = viewer?.profile ?? null;
  const scopes = viewer?.scopes ?? [];

  return NextResponse.json({
    profile: profile
      ? {
          id: profile.id,
          name: profile.name,
          display_name: labelOf(profile),
          lichess_username: profile.lichess,
          chesscom_username: profile.chesscom,
          ...libraryCounts(scopes),
        }
      : null,
    scopes,
    // Only the deployment-wide LICHESS_TOKEN, which belongs to the operator.
    deploymentTokenSet: Boolean(config.lichessToken),
  });
}

/**
 * Re-attach the acting profile's accounts to any games already stored.
 *
 * A no-op for the database, but it is what makes a freshly created profile in a
 * new browser show its whole analysed history at once.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { sync?: boolean };
  if (body.sync) {
    const profile = viewerOf(request, { sync: false })?.profile;
    if (profile) syncLibrary(profile, { force: true });
  }
  return NextResponse.json({ ok: true });
}
