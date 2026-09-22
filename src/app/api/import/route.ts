import { NextResponse } from "next/server";
import { enqueueImportJob, getJobStats } from "@/lib/queue";
import { setProfile, setSetting } from "@/lib/db";
import { ensureWorkerStarted } from "@/lib/worker";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Publish import jobs. The fetch itself runs in the worker pool — Lichess can
 * throttle for a minute and Chess.com walks several archives, neither of which
 * should occupy an HTTP request.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    lichess?: string;
    chesscom?: string;
    max?: number;
    lichessToken?: string;
    analyzeAfter?: boolean;
  };

  const lichess = typeof body.lichess === "string" ? body.lichess.trim() : "";
  const chesscom = typeof body.chesscom === "string" ? body.chesscom.trim() : "";
  const suppliedToken = typeof body.lichessToken === "string" ? body.lichessToken.trim() : "";
  if (suppliedToken) setSetting("lichess_token", suppliedToken);

  const max = Math.min(
    Math.max(typeof body.max === "number" ? Math.floor(body.max) : config.maxGamesPerSource, 1),
    200
  );

  if (!lichess && !chesscom) {
    return NextResponse.json(
      { error: "Provide a Lichess and/or Chess.com username." },
      { status: 400 }
    );
  }

  const analyzeAfter = body.analyzeAfter !== false;
  const jobs: { source: string; username: string; jobId: number | null; skipped: boolean }[] = [];

  if (lichess) {
    jobs.push({ source: "lichess", username: lichess, ...enqueueImportJob("lichess", lichess, max, { analyzeAfter }) });
  }
  if (chesscom) {
    jobs.push({ source: "chesscom", username: chesscom, ...enqueueImportJob("chesscom", chesscom, max, { analyzeAfter }) });
  }

  setProfile({ lichess_username: lichess, chesscom_username: chesscom });
  ensureWorkerStarted();

  return NextResponse.json({
    queued: jobs.filter((j) => !j.skipped).length,
    analyzeAfter,
    importJobs: jobs,
    ...getJobStats(),
  });
}
