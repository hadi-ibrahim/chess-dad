import { NextResponse } from "next/server";
import { findOpening } from "@/lib/openings";
import { listOpeningReviews, updateOpeningReview } from "@/lib/db";
import { viewerOf } from "@/lib/library";

export const dynamic = "force-dynamic";

/**
 * Record one practice attempt at an opening line and reschedule it on the same
 * simplified SM-2 curve the puzzles use: a clean run moves the interval out, a
 * miss resets it to a day and drops the ease.
 *
 * The schedule is filed under the profile's primary account, so it follows the
 * account between browsers rather than living in one browser.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { eco?: string; clean?: boolean };
  const eco = String(body.eco ?? "").toUpperCase();
  if (!eco || !findOpening(eco)) {
    return NextResponse.json({ error: "Unknown ECO" }, { status: 404 });
  }
  const viewer = viewerOf(request);
  const scope = viewer?.scopes[0];
  if (!viewer || !scope) {
    return NextResponse.json({ error: "No profile selected." }, { status: 404 });
  }
  const clean = Boolean(body.clean);
  const current = listOpeningReviews(viewer.scopes).find((r) => r.eco === eco) ?? null;
  const ease0 = current?.ease ?? 2.5;
  const interval0 = current?.interval_days ?? 0;
  const reps0 = current?.repetitions ?? 0;

  let ease: number;
  let intervalDays: number;
  let repetitions: number;
  if (clean) {
    ease = Math.min(2.5, Number((ease0 + 0.1).toFixed(2)));
    repetitions = reps0 + 1;
    intervalDays =
      repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.max(1, Math.round(interval0 * ease));
  } else {
    ease = Math.max(1.3, Number((ease0 - 0.2).toFixed(2)));
    repetitions = 0;
    intervalDays = 1;
  }
  const dueAt = new Date(Date.now() + intervalDays * 86_400_000).toISOString();
  updateOpeningReview(scope, eco, ease, intervalDays, repetitions, dueAt, clean);
  return NextResponse.json({ eco, clean, ease, intervalDays, repetitions, dueAt });
}
