import { NextResponse } from "next/server";
import { enqueueImportJob, getJobStats } from "@/lib/queue";
import { updateProfile, setProfileToken, getProfileById } from "@/lib/db";
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

  // Importing is only ever *for* a profile. Profiles are created on the Profiles
  // tab, never here, so an import with nobody active is a clear error rather than
  // a silent new profile.
  const profileId = activeProfileId(request);
  if (profileId == null) {
    return NextResponse.json(
      { error: "No profile is active. Add one on the Profiles tab first." },
      { status: 409 }
    );
  }

  const current = getProfileById(profileId);
  const explicitLichess = typeof body.lichess === "string" ? body.lichess.trim() : "";
  const explicitChesscom = typeof body.chesscom === "string" ? body.chesscom.trim() : "";
  // The Games tab sends nothing: the acting profile already knows its accounts.
  const lichess = explicitLichess || current?.lichess_username || "";
  const chesscom = explicitChesscom || current?.chesscom_username || "";

  const suppliedToken = typeof body.lichessToken === "string" ? body.lichessToken.trim() : "";
  if (suppliedToken) setProfileToken(profileId, suppliedToken);

  const max = Math.min(
    Math.max(typeof body.max === "number" ? Math.floor(body.max) : config.maxGamesPerSource, 1),
    200
  );

  if (!lichess && !chesscom) {
    return NextResponse.json(
      { error: "This profile has no Lichess or Chess.com username yet. Add one on the Profiles tab." },
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

  // Explicit usernames still update the profile; the Games tab sends none.
  if (explicitLichess || explicitChesscom) {
    updateProfile(profileId, { lichess_username: lichess, chesscom_username: chesscom });
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
