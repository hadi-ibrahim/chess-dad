import "server-only";
import type { NewGame } from "../db";
import type { Color, JobProgress, PlyInfo } from "../types";
import { parsePgn } from "../chess-core";
import { upsertGame, insertPositionIfMissing } from "../db";
import { fetchWithBackoff, USER_AGENT } from "../http";

export interface ImportedGame extends Omit<NewGame, "profile_id"> {
  plies: PlyInfo[];
}

interface ChessComArchive {
  archives: string[];
}

interface ChessComGame {
  url: string;
  pgn: string;
  time_control: string;
  end_time: number;
  time_class: string;
  rules: string;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
}

/** Extract `[%clk H:MM:SS]` / `[%clk M:SS]` annotations, in order, as seconds. */
function extractClocks(pgn: string): number[] {
  const out: number[] = [];
  const re = /\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pgn)) !== null) {
    out.push(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
  }
  if (out.length > 0) return out;
  const re2 = /\[%clk\s+(\d+):(\d+(?:\.\d+)?)\]/g;
  while ((m = re2.exec(pgn)) !== null) {
    out.push(Number(m[1]) * 60 + Number(m[2]));
  }
  return out;
}

function parseChessComGame(g: ChessComGame, username: string): ImportedGame | null {
  const parsed = parsePgn(g.pgn);
  const headers = parsed.headers;
  const white = headers.White || g.white?.username || "Anonymous";
  const black = headers.Black || g.black?.username || "Anonymous";
  const color: Color = g.white?.username?.toLowerCase() === username.toLowerCase() ? "w" : "b";

  const clocks = extractClocks(g.pgn);
  const plies: PlyInfo[] = parsed.plies.map((p) => ({
    ...p,
    clockSeconds: clocks[p.ply] != null ? Math.round(clocks[p.ply]) : null,
  }));

  const endTime = g.end_time ? new Date(g.end_time * 1000) : null;

  return {
    source: "chesscom",
    external_id: g.url,
    pgn: g.pgn,
    white,
    black,
    white_rating: g.white?.rating ?? null,
    black_rating: g.black?.rating ?? null,
    result: headers.Result || "*",
    time_control: g.time_control || "",
    speed: g.time_class || "",
    eco: headers.ECO || "",
    opening_name: headers.Opening || "",
    played_at: endTime ? endTime.toISOString() : null,
    player_color: color,
    player_rating: color === "w" ? (g.white?.rating ?? null) : (g.black?.rating ?? null),
    opponent: color === "w" ? black : white,
    opponent_rating: color === "w" ? (g.black?.rating ?? null) : (g.white?.rating ?? null),
    total_plies: plies.length,
    plies,
  };
}

// Chess.com's public API requires a User-Agent header and returns 403 without one.
export async function fetchChessComGames(
  username: string,
  max: number,
  onProgress?: (info: JobProgress) => void
): Promise<ImportedGame[]> {
  const base = `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`;
  const res = await fetchWithBackoff(base, { headers: { "User-Agent": USER_AGENT } }, { retries: 2 });
  if (res.status === 404) throw new Error(`Chess.com user not found: ${username}`);
  if (res.status === 403) throw new Error("Chess.com blocked the request (missing/invalid User-Agent)");
  if (!res.ok) throw new Error(`Chess.com API error ${res.status}`);

  const { archives } = (await res.json()) as ChessComArchive;
  if (!archives?.length) return [];

  // Archives are ascending by month; pull newest first until we hit `max`.
  const collected: ImportedGame[] = [];
  for (let i = archives.length - 1; i >= 0 && collected.length < max; i--) {
    const archiveUrl = archives[i];
    const ares = await fetchWithBackoff(archiveUrl, { headers: { "User-Agent": USER_AGENT } }, { retries: 2 });
    if (!ares.ok) continue;
    const body = (await ares.json()) as { games: ChessComGame[] };
    const games = body.games || [];
    for (let j = games.length - 1; j >= 0 && collected.length < max; j--) {
      const game = games[j];
      if (game.rules !== "chess") continue; // skip variants
      try {
        const parsed = parseChessComGame(game, username);
        if (parsed) collected.push(parsed);
      } catch {
        // skip
      }
    }
    onProgress?.({
      stage: "archives",
      progress: 0.05 + 0.3 * (collected.length / Math.max(1, max)),
    });
  }
  return collected;
}

export async function importChessCom(
  username: string,
  max: number,
  profileId: number,
  onProgress?: (info: JobProgress) => void
): Promise<{ username: string; count: number; gameIds: number[] }> {
  onProgress?.({ stage: "fetching", progress: 0.05 });
  const games = await fetchChessComGames(username, max, onProgress);
  onProgress?.({ stage: "parsed", progress: 0.35 });

  const gameIds: number[] = [];
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const gameId = upsertGame({
      profile_id: profileId,
      source: g.source,
      external_id: g.external_id,
      pgn: g.pgn,
      white: g.white,
      black: g.black,
      white_rating: g.white_rating,
      black_rating: g.black_rating,
      result: g.result,
      time_control: g.time_control,
      speed: g.speed,
      eco: g.eco,
      opening_name: g.opening_name,
      played_at: g.played_at,
      player_color: g.player_color,
      player_rating: g.player_rating,
      opponent: g.opponent,
      opponent_rating: g.opponent_rating,
      total_plies: g.total_plies,
    });
    for (const p of g.plies) {
      insertPositionIfMissing({
        game_id: gameId,
        ply: p.ply,
        color: p.color,
        fen: p.fen,
        san: p.san,
        uci: p.uci,
        fen_after: p.fenAfter,
        clock_seconds: p.clockSeconds,
      });
    }
    gameIds.push(gameId);
    onProgress?.({
      stage: "storing",
      progress: 0.35 + 0.65 * ((i + 1) / Math.max(1, games.length)),
    });
  }
  return { username, count: games.length, gameIds };
}
