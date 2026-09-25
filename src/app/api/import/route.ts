import { NextResponse } from "next/server";
import { accountScope, filterUnanalyzedWithMoves } from "@/lib/db";
import { accountsOf, labelOf } from "@/lib/identity";
import { viewerOf } from "@/lib/library";
import { enqueueAnalyzeJobs, getJobStats } from "@/lib/queue";
import { ensureWorkerStarted } from "@/lib/worker";
import { importLichess } from "@/lib/importers/lichess";
import { importChessCom } from "@/lib/importers/chesscom";
import { config } from "@/lib/config";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
/** A throttled anonymous Lichess export can wait out a rate-limit window. */
export const maxDuration = 300;

interface AccountResult {
  source: "lichess" | "chesscom";
  username: string;
  imported: number;
  /** Games that needed the engine and were queued for it. */
  analysisQueued: number;
  /** Already stored, so only the library link was added. */
  alreadyKnown: number;
  error?: string;
}

/**
 * Fetch the acting profile's games and queue their analysis.
 *
 * The fetch happens **here**, in the request, not in the queue — because this is
 * the only moment the caller's Lichess token exists. Keeping it request-scoped
 * is what lets the token live in the browser and nowhere else: it is handed over,
 * used for one `Authorization` header, and gone when the response is sent. The
 * server keeps no session, no row, and no map.
 *
 * Analysis is still a background job: it is CPU-bound, needs no token, and is
 * the part that would blow out a request.
 */
export async function POST(request: Request) {
  // Each import fetches up to `MAX_GAMES_PER_SOURCE` games per account and
  // enqueues their analysis, so it is throttled per IP before any of that work.
  const limited = enforceRateLimit(request, "import");
  if (limited) return limited;

  const body = (await request.json().catch(() => ({}))) as {
    lichess?: string;
    chesscom?: string;
    max?: number;
    lichessToken?: string;
    analyzeAfter?: boolean;
  };

  const viewer = viewerOf(request);
  if (!viewer) {
    return NextResponse.json(
      { error: "No profile is active. Add one on the Profiles tab first." },
      { status: 409 }
    );
  }

  const explicitLichess = typeof body.lichess === "string" ? body.lichess.trim() : "";
  const explicitChesscom = typeof body.chesscom === "string" ? body.chesscom.trim() : "";
  // The Games tab sends no usernames: the acting profile already knows its accounts.
  const accounts =
    explicitLichess || explicitChesscom
      ? [
          ...(explicitLichess ? [{ source: "lichess" as const, username: explicitLichess }] : []),
          ...(explicitChesscom ? [{ source: "chesscom" as const, username: explicitChesscom }] : []),
        ]
      : accountsOf(viewer.profile);

  if (accounts.length === 0) {
    return NextResponse.json(
      { error: "This profile has no Lichess or Chess.com username yet. Add one on the Profiles tab." },
      { status: 400 }
    );
  }

  const max = Math.min(
    Math.max(typeof body.max === "number" ? Math.floor(body.max) : config.maxGamesPerSource, 1),
    200
  );
  const analyzeAfter = body.analyzeAfter !== false;
  // The browser's token, used for this call only. The deployment token is the
  // operator's fallback for a headless install; neither is ever written down.
  const token = (typeof body.lichessToken === "string" ? body.lichessToken.trim() : "") || config.lichessToken;

  const results = await Promise.all(
    accounts.map(async (account): Promise<AccountResult> => {
      const scope = accountScope(account.source, account.username);
      const base = { source: account.source, username: account.username };
      try {
        const fetched =
          account.source === "lichess"
            ? await importLichess(account.username, max, scope, token || undefined)
            : await importChessCom(account.username, max, scope);

        // Chain straight into analysis so an import is one action, not two.
        const pending = analyzeAfter ? filterUnanalyzedWithMoves(fetched.gameIds) : [];
        const { enqueued } = pending.length ? enqueueAnalyzeJobs(pending, {}) : { enqueued: 0 };

        return {
          ...base,
          imported: fetched.count,
          analysisQueued: enqueued,
          alreadyKnown: fetched.count - fetched.linked,
        };
      } catch (e) {
        return { ...base, imported: 0, analysisQueued: 0, alreadyKnown: 0, error: (e as Error).message };
      }
    })
  );

  const failed = results.filter((r) => r.error);
  const imported = results.reduce((sum, r) => sum + r.imported, 0);
  const analysisQueued = results.reduce((sum, r) => sum + r.analysisQueued, 0);

  ensureWorkerStarted();

  const payload = {
    profile: labelOf(viewer.profile),
    accounts: results,
    imported,
    analysisQueued,
    ...getJobStats(viewer.scopes),
  };

  // Everything failed: report it as a failure, with the reason the account gave.
  if (failed.length === results.length) {
    return NextResponse.json({ ...payload, error: failed[0].error }, { status: 502 });
  }
  return NextResponse.json(payload);
}
