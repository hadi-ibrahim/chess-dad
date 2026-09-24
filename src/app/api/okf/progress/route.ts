import { NextResponse } from "next/server";
import { writeProgressBundle } from "@/lib/okf-progress";
import { activeProfileId } from "@/lib/active-profile";

export const dynamic = "force-dynamic";

/** Regenerate the per-user OKF progress documents on demand. */
export async function POST(request: Request) {
  try {
    const profileId = activeProfileId(request);
    if (profileId == null) {
      return NextResponse.json({ error: "No profile selected." }, { status: 404 });
    }
    return NextResponse.json(writeProgressBundle(profileId));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
