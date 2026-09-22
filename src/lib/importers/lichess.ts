import "server-only";
import { Chess, type Move } from "chess.js";
import { config } from "../config";
import type { NewGame } from "../db";
import type { Color, PlyInfo } from "../types";

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
    const uci = moveTokens[i];
    const fen = chess.fen();
    let move: Move | null = null;
    try {
      move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined } as never);
    } catch {
      move = null;
    }
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

export async function fetchLichessGames(username: string, max: number): Promise<ImportedGame[]> {
  const perfTypes = "bullet,blitz,rapid,classical";
  const url =
    `https://lichess.org/api/games/user/${encodeURIComponent(username)}` +
    `?max=${max}&moves=true&clocks=true&evals=false&opening=true&perfType=${perfTypes}`;
  const headers: Record<string, string> = { Accept: "application/x-ndjson" };
  if (config.lichessToken) headers.Authorization = `Bearer ${config.lichessToken}`;

  const res = await fetch(url, { headers });
  if (res.status === 404) throw new Error(`Lichess user not found: ${username}`);
  if (res.status === 429) throw new Error("Lichess rate limit reached — try again later.");
  if (!res.ok) throw new Error(`Lichess API error ${res.status}`);

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

export async function importLichess(username: string, max: number): Promise<{ username: string; count: number }> {
  const games = await fetchLichessGames(username, max);
  const { upsertGame, upsertPosition } = await import("../db");
  for (const g of games) {
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
      upsertPosition({
        game_id: gameId,
        ply: p.ply,
        color: p.color,
        fen: p.fen,
        san: p.san,
        uci: p.uci,
        fen_after: p.fenAfter,
        best_move: null,
        best_move_san: null,
        eval_before: null,
        mate_before: null,
        eval_after: null,
        mate_after: null,
        centipawn_loss: null,
        classification: null,
        motif: null,
        phase: null,
        clock_seconds: p.clockSeconds,
        is_critical: 0,
        explanation: null,
        key_lesson: null,
        drill_suggestion: null,
      });
    }
  }
  return { username, count: games.length };
}
