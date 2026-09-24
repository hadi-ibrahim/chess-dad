import { NextResponse } from "next/server";
import { enqueueImportJob, getJobStats } from "@/lib/queue";
import { createProfile, updateProfile, setProfileToken, getProfileById } from "@/lib/db";
import { activeProfileId } from "@/lib/active-profile";
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
  // A request with no profile yet gets one, so a brand-new visitor can just type
  // a username and go rather than being sent to the profiles page first.
  let profileId = activeProfileId(request);
  if (profileId == null) {
    profileId = createProfile({ lichess_username: lichess, chesscom_username: chesscom });
  }
  const suppliedToken = typeof body.lichessToken === "string" ? body.lichessToken.trim() : "";
  if (suppliedToken) setProfileToken(profileId, suppliedToken);

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
    jobs.push({
      source: "lichess",
      username: lichess,
      ...enqueueImportJob("lichess", lichess, max, profileId, { analyzeAfter }),
    });
  }
  if (chesscom) {
    jobs.push({
      source: "chesscom",
      username: chesscom,
      ...enqueueImportJob("chesscom", chesscom, max, profileId, { analyzeAfter }),
    });
  }

  // Importing is also how you tell the app who you are, so the acting profile
  // adopts whatever usernames were submitted.
  const current = getProfileById(profileId);
  if (current) {
    updateProfile(profileId, {
      lichess_username: lichess || current.lichess_username,
      chesscom_username: chesscom || current.chesscom_username,
    });
  }
  ensureWorkerStarted();

  return NextResponse.json({
    queued: jobs.filter((j) => !j.skipped).length,
    analyzeAfter,
    profileId,
    importJobs: jobs,
    ...getJobStats(),
  });
}
