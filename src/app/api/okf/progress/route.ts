import { NextResponse } from "next/server";
import { writeProgressBundle } from "@/lib/okf-progress";
import { viewerOf } from "@/lib/library";

export const dynamic = "force-dynamic";

/** Regenerate the OKF progress documents for the acting profile's accounts. */
export async function POST(request: Request) {
  try {
    const viewer = viewerOf(request);
    if (!viewer) {
      return NextResponse.json({ error: "No profile selected." }, { status: 404 });
    }
    const results = viewer.scopes.map((scope) => writeProgressBundle(scope));
    return NextResponse.json({
      written: results.flatMap((r) => r.written),
      analyzedGames: results.reduce((sum, r) => sum + r.analyzedGames, 0),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
