import { NextResponse } from "next/server";
import { getJobStats } from "@/lib/queue";
import { viewerOf } from "@/lib/library";
import { ensureWorkerStarted, getWorkerState } from "@/lib/worker";

export const dynamic = "force-dynamic";

/**
 * Aggregate queue + progress state for the UI, counted against the acting
 * profile's library. Also idempotently (re)starts the consumer, so polling the
 * status revives the worker after a restart.
 */
export async function GET(request: Request) {
  ensureWorkerStarted();
  const viewer = viewerOf(request);
  return NextResponse.json({ ...getJobStats(viewer?.scopes ?? null), worker: getWorkerState() });
}
