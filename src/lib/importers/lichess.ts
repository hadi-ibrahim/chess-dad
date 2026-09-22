import "server-only";
import { Chess, type Move } from "chess.js";
import { config } from "../config";
import { parseRetryAfterMs, sleep, USER_AGENT } from "../http";
import type { NewGame } from "../db";
import type { Color, JobProgress, PlyInfo } from "../types";

export interface ImportedGame extends NewGame {
  plies: PlyInfo[];
}

interface LichessGameJson {
  id: string;
  speed: string;
  perf: string;
  createdAt: number;
  lastMoveAt: number;
  status: string;
  winner?: "white" | "black";
  players?: {
    white?: { user?: { name?: string }; rating?: number };
    black?: { user?: { name?: string }; rating?: number };
  };
  opening?: { eco?: string; name?: string; ply?: number };
  clock?: { initial?: number; increment?: number };
  moves?: string;
  clocks?: (number | null)[];
}

function resultFrom(g: LichessGameJson): string {
  if (g.winner === "white") return "1-0";
  if (g.winner === "black") return "0-1";
  if (["aborted", "noStart", "created", "started"].includes(g.status)) return "*";
  return "1/2-1/2";
}

function formatClock(g: LichessGameJson): string {
  const initial = g.clock?.initial ?? 0;
  const increment = g.clock?.increment ?? 0;
  return `${initial}+${increment}`;
}

/**
 * Apply one move token, which Lichess may report as UCI ("e2e4", "e7e8q") or as
 * SAN ("Nf3", "O-O", "Qxd1+"). Trying both keeps the importer working whichever
 * spelling the export uses.
 */
function applyMoveToken(chess: Chess, token: string): Move | null {
  if (/^[a-h][1-8][a-h][1-8][qrbnQRBN]?$/.test(token)) {
    try {
      const m = chess.move({
        from: token.slice(0, 2),
        to: token.slice(2, 4),
        promotion: token.slice(4, 5) || undefined,
      } as never);
      if (m) return m;
    } catch {
      // not a legal UCI move — fall through and try SAN
    }
  }
  try {
    return chess.move(token) ?? null;
  } catch {
    return null;
  }
}

function parseLichessGame(g: LichessGameJson, username: string): ImportedGame | null {
  const white = g.players?.white?.user?.name || "Anonymous";
  const black = g.players?.black?.user?.name || "Anonymous";
  if (typeof g.moves !== "string" || !g.moves.trim()) return null;

  const color: Color = white.toLowerCase() === username.toLowerCase() ? "w" : "b";
  const result = resultFrom(g);

  const chess = new Chess();
  const moveTokens = g.moves.trim().split(/\s+/).filter(Boolean);
  const plies: PlyInfo[] = [];

  for (let i = 0; i < moveTokens.length; i++) {
    const fen = chess.fen();
    const move = applyMoveToken(chess, moveTokens[i]);
    if (!move) break;
    const clockCs = g.clocks?.[i];
    plies.push({
      ply: i,
      color: move.color as Color,
      fen,
      san: move.san,
      uci: move.lan,
      fenAfter: chess.fen(),
      moveNumber: Math.floor(i / 2) + 1,
      clockSeconds: typeof clockCs === "number" ? Math.round(clockCs / 100) : null,
    });
  }

  const date = new Date(g.createdAt);
  const dateTag = date.toISOString().slice(0, 10).replace(/-/g, ".");
  chess.header(
    "Event",
    `Lichess ${g.perf || "Standard"}`,
    "Site",
    `https://lichess.org/${g.id}`,
    "Date",
    dateTag,
    "White",
    white,
    "Black",
    black,
    "WhiteElo",
    String(g.players?.white?.rating ?? "?"),
    "BlackElo",
    String(g.players?.black?.rating ?? "?"),
    "Result",
    result,
    "ECO",
    g.opening?.eco ?? "",
    "Opening",
    g.opening?.name ?? ""
  );

  return {
    source: "lichess",
    external_id: g.id,
    pgn: chess.pgn(),
    white,
    black,
    white_rating: g.players?.white?.rating ?? null,
    black_rating: g.players?.black?.rating ?? null,
    result,
    time_control: formatClock(g),
    speed: g.speed || g.perf || "",
    eco: g.opening?.eco ?? "",
    opening_name: g.opening?.name ?? "",
    played_at: date.toISOString(),
    player_color: color,
    player_rating: color === "w" ? (g.players?.white?.rating ?? null) : (g.players?.black?.rating ?? null),
    opponent: color === "w" ? black : white,
    opponent_rating: color === "w" ? (g.players?.black?.rating ?? null) : (g.players?.white?.rating ?? null),
    total_plies: plies.length,
    plies,
  };
}

/** Does the Lichess account exist? Returns null when it cannot be determined. */
async function lichessUserExists(username: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://lichess.org/api/user/${encodeURIComponent(username)}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    return null;
  } catch {
    return null;
  }
}

function throttleMessage(username: string, retryAfterSec: string | null, attempts: number): string {
  const wait = retryAfterSec ? ` Retry in about ${retryAfterSec}s.` : " Wait a minute and retry.";
  return (
    `Lichess throttled the game export for "${username}" after ${attempts} attempt(s) — anonymous ` +
    `imports are limited to a few requests per minute.${wait} Setting LICHESS_TOKEN in .env.local ` +
    `raises the limit (and is needed for private games).`
  );
}

export async function fetchLichessGames(
  username: string,
  max: number,
  token?: string
): Promise<ImportedGame[]> {
  const perfTypes = "bullet,blitz,rapid,classical";
  const url =
    `https://lichess.org/api/games/user/${encodeURIComponent(username)}` +
    `?max=${max}&moves=true&clocks=true&evals=false&opening=true&perfType=${perfTypes}`;
  const authToken = (token ?? "").trim() || config.lichessToken;
  const headers: Record<string, string> = { Accept: "application/x-ndjson", "User-Agent": USER_AGENT };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  // Lichess throttles anonymous game exports hard. A 429 carries Retry-After, but
  // the throttle is also frequently masked as a 404 with no header — so on either
  // signal we wait about one window (~20s steps, capped) and try again.
  const attempts = authToken ? 2 : 4;
  const stepWaitMs = 20_000;
  let lastRes: Response | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await fetch(url, { headers });

    if (res.ok) {
      const text = await res.text();
      const games: ImportedGame[] = [];
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = parseLichessGame(JSON.parse(trimmed) as LichessGameJson, username);
          if (parsed) games.push(parsed);
        } catch {
          // skip malformed lines
        }
      }
      return games;
    }

    lastRes = res;

    if (res.status === 404) {
      // Lichess masks anonymous export throttling as 404 even for valid accounts,
      // so only report "not found" when the profile endpoint agrees.
      const exists = await lichessUserExists(username);
      if (exists === false) throw new Error(`Lichess user not found: ${username}`);
    } else if (res.status !== 429) {
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `Lichess rejected the API token (HTTP ${res.status}). Check the token value — ` +
          `create one at https://lichess.org/account/oauth/token`
        );
      }
      throw new Error(`Lichess API error ${res.status}`);
    }

    if (attempt < attempts) {
      const wait = Math.min(65_000, parseRetryAfterMs(res.headers.get("retry-after")) ?? stepWaitMs);
      await sleep(wait);
    }
  }

  throw new Error(throttleMessage(username, lastRes?.headers.get("retry-after") ?? null, attempts));
}

export async function importLichess(
  username: string,
  max: number,
  token?: string,
  onProgress?: (info: JobProgress) => void
): Promise<{ username: string; count: number; gameIds: number[] }> {
  onProgress?.({ stage: "fetching", progress: 0.05 });
  const games = await fetchLichessGames(username, max, token);
  onProgress?.({ stage: "parsed", progress: 0.35 });

  const { upsertGame, insertPositionIfMissing } = await import("../db");
  const gameIds: number[] = [];
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const gameId = upsertGame({
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
