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
import { viewerOf } from "@/lib/library";
import { ensureWorkerStarted } from "@/lib/worker";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Publish analysis jobs for specific games, or for every game in the acting
 * profile's library that is still pending.
 *
 * Analysis is a property of the game, not of a profile, so two accounts that both
 * hold the same game share the one job.
 */
export async function POST(request: Request) {
  // Enqueuing is cheap, but it is the tap that fills the CPU-bound queue, so it
  // is throttled per IP. A whole-library run is one request, so a normal user
  // never notices.
  const limited = enforceRateLimit(request, "jobs");
  if (limited) return limited;

  const body = (await request.json().catch(() => ({}))) as {
    gameIds?: number[];
    all?: boolean;
    depth?: number;
    explain?: boolean;
    generatePuzzles?: boolean;
  };

  const viewer = viewerOf(request);

  let gameIds: number[] = [];
  if (body.all) {
    if (!viewer) return NextResponse.json({ error: "No profile is active." }, { status: 409 });
    const placeholders = viewer.scopes.map(() => "?").join(",");
    const rows = getDb()
      .prepare(
        `SELECT DISTINCT id FROM library_games
         WHERE analyzed = 0 AND total_plies > 0 AND scope IN (${placeholders})
         ORDER BY played_at ASC, id ASC`
      )
      .all(...viewer.scopes) as { id: number }[];
    gameIds = rows.map((r) => Number(r.id));
  } else if (Array.isArray(body.gameIds)) {
    gameIds = body.gameIds.map((n) => Number(n)).filter((n) => Number.isInteger(n));
  }

  if (gameIds.length === 0) {
    return NextResponse.json({
      enqueued: 0,
      skipped: 0,
      ...getJobStats(viewer?.scopes ?? null),
      message: "Nothing to analyze.",
    });
  }

  const depth =
    typeof body.depth === "number" ? Math.min(Math.max(Math.floor(body.depth), 6), 30) : null;
  const result = enqueueAnalyzeJobs(gameIds, {
    depth,
    explain: body.explain,
    generatePuzzles: body.generatePuzzles,
  });

  ensureWorkerStarted();

  return NextResponse.json({
    ...result,
    requested: gameIds.length,
    ...getJobStats(viewer?.scopes ?? null),
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const type = url.searchParams.get("type");
  const gameId = url.searchParams.get("gameId");
  const limit = Number(url.searchParams.get("limit") ?? 100);

  ensureWorkerStarted();

  const viewer = viewerOf(request);
  return NextResponse.json({
    jobList: listJobs({
      status: (status as JobStatus | null) ?? undefined,
      type: (type as JobType | null) ?? undefined,
      gameId: gameId ? Number(gameId) : undefined,
      limit,
    }),
    ...getJobStats(viewer?.scopes ?? null),
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

  const viewer = viewerOf(request);
  return NextResponse.json({ action, changed, ...getJobStats(viewer?.scopes ?? null) });
}
