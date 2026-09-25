import { NextResponse } from "next/server";
import { healthReport } from "@/lib/health";

export const dynamic = "force-dynamic";

/**
 * Liveness and readiness, for the platform's health check and for an operator
 * with `curl`.
 *
 * 200 when the database is usable, Stockfish answers `uciok`, disk is not full,
 * and the worker is not idle with work waiting. 503 otherwise, so a bad deploy is
 * rolled back rather than promoted.
 *
 * It is deliberately unauthenticated — a platform health check cannot hold a
 * credential — so it reports states, never paths, environment or error text.
 */
export async function GET() {
  const report = await healthReport();
  return NextResponse.json(report, {
    status: report.ok ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
