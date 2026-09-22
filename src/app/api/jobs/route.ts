import { NextResponse } from "next/server";
import {
  cancelQueuedJobs,
  clearFinishedJobs,
  enqueueAnalyzeJobs,
  getJobStats,
  listJobs,
  retryFailedJobs,
  type JobStatus,
  type JobType,
} from "@/lib/queue";
import { getDb } from "@/lib/db";
import { ensureWorkerStarted } from "@/lib/worker";

export const dynamic = "force-dynamic";

/** Publish analysis jobs for specific games, or for every game still pending. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    gameIds?: number[];
    all?: boolean;
    depth?: number;
    explain?: boolean;
    generatePuzzles?: boolean;
  };

  let gameIds: number[] = [];
  if (body.all) {
    const rows = getDb()
      .prepare("SELECT id FROM games WHERE analyzed = 0 AND total_plies > 0 ORDER BY played_at ASC, id ASC")
      .all() as { id: number }[];
    gameIds = rows.map((r) => Number(r.id));
  } else if (Array.isArray(body.gameIds)) {
    gameIds = body.gameIds.map((n) => Number(n)).filter((n) => Number.isInteger(n));
  }

  if (gameIds.length === 0) {
    return NextResponse.json({ enqueued: 0, skipped: 0, ...getJobStats(), message: "Nothing to analyze." });
  }

  const depth =
    typeof body.depth === "number" ? Math.min(Math.max(Math.floor(body.depth), 6), 30) : null;
  const result = enqueueAnalyzeJobs(gameIds, {
    depth,
    explain: body.explain,
    generatePuzzles: body.generatePuzzles,
  });

  ensureWorkerStarted();

  return NextResponse.json({ ...result, requested: gameIds.length, ...getJobStats() });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const type = url.searchParams.get("type");
  const gameId = url.searchParams.get("gameId");
  const limit = Number(url.searchParams.get("limit") ?? 100);

  ensureWorkerStarted();

  return NextResponse.json({
    jobList: listJobs({
      status: (status as JobStatus | null) ?? undefined,
      type: (type as JobType | null) ?? undefined,
      gameId: gameId ? Number(gameId) : undefined,
      limit,
    }),
    ...getJobStats(),
  });
}

/** DELETE ?action=cancel|clear|retry */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "cancel";

  let changed = 0;
  if (action === "cancel") changed = cancelQueuedJobs();
  else if (action === "clear") changed = clearFinishedJobs();
  else if (action === "retry") changed = retryFailedJobs();
  else return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });

  return NextResponse.json({ action, changed, ...getJobStats() });
}
