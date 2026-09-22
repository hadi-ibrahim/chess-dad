import { NextResponse } from "next/server";
import { getJobStats } from "@/lib/queue";
import { ensureWorkerStarted, getWorkerState } from "@/lib/worker";

export const dynamic = "force-dynamic";

/**
 * Aggregate queue + progress state for the UI. Also idempotently (re)starts the
 * consumer, so polling the status revives the worker after a restart.
 */
export async function GET() {
  ensureWorkerStarted();
  return NextResponse.json({ ...getJobStats(), worker: getWorkerState() });
}
