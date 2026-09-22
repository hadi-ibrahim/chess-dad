import { NextResponse } from "next/server";
import { writeProgressBundle } from "@/lib/okf-progress";

export const dynamic = "force-dynamic";

/** Regenerate the per-user OKF progress documents on demand. */
export async function POST() {
  try {
    return NextResponse.json(writeProgressBundle());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
