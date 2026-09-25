import { NextResponse } from "next/server";
import { labelOf } from "@/lib/identity";
import { viewerOf } from "@/lib/library";
import { libraryCounts, queryGames, type GameQuery } from "@/lib/db";

export const dynamic = "force-dynamic";

const OUTCOMES = ["win", "loss", "draw"] as const;

/**
 * Paginated, searchable, filterable game list for the acting profile.
 *
 * The games themselves are shared; the viewer's accounts decide which of them
 * this browser is shown, and which side they were on.
 */
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;

  const number = (key: string, fallback: number): number => {
    const raw = p.get(key);
    const value = raw == null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };

  const analyzedRaw = p.get("analyzed");
  const colorRaw = p.get("color");
  const resultRaw = p.get("result");
  // played_at is stored as a full ISO timestamp; widen date-only bounds to the whole day.
  const dateBound = (key: string, edge: "start" | "end"): string | undefined => {
    const raw = p.get(key);
    if (!raw) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    return edge === "start" ? `${raw}T00:00:00.000Z` : `${raw}T23:59:59.999Z`;
  };

  const viewer = viewerOf(request);
  if (!viewer) {
    return NextResponse.json({ profile: null, games: [], total: 0, page: 1, pageCount: 1, analyzed: 0 });
  }

  const query: GameQuery = {
    scopes: viewer.scopes,
    q: p.get("q") ?? undefined,
    source: p.get("source") ?? undefined,
    speed: p.get("speed") ?? undefined,
    analyzed: analyzedRaw === "1" ? 1 : analyzedRaw === "0" ? 0 : undefined,
    color: colorRaw === "w" || colorRaw === "b" ? colorRaw : undefined,
    result: OUTCOMES.find((r) => r === resultRaw),
    from: dateBound("from", "start"),
    to: dateBound("to", "end"),
    page: number("page", 1),
    pageSize: number("pageSize", 50),
  };

  return NextResponse.json({
    profile: {
      id: viewer.profile.id,
      name: viewer.profile.name,
      display_name: labelOf(viewer.profile),
      lichess_username: viewer.profile.lichess,
      chesscom_username: viewer.profile.chesscom,
      ...libraryCounts(viewer.scopes),
    },
    ...queryGames(query),
  });
}
