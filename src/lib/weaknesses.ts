import "server-only";
import { getDb } from "./db";

/**
 * Mate scores are mapped to +/-100000 centipawns, so a single missed mate
 * dominates any mean. Every aggregate here clamps a move's loss before it is
 * averaged, and the phase verdict uses error rate rather than a mean of
 * arbitrary magnitudes.
 */
const CP_CLAMP = 1000;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface ClassificationCounts {
  best: number;
  great: number;
  good: number;
  inaccuracy: number;
  mistake: number;
  blunder: number;
  miss: number;
  book: number;
  forced: number;
  brilliant: number;
}

export interface PhaseStat {
  moves: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  misses: number;
  /** Flagged moves (blunder + mistake + miss) per 100 moves — the robust ranking basis. */
  errorsPer100: number;
  /** Mean loss, clamped at 1000 cp per move so mate scores cannot dominate. */
  avgCpLoss: number;
  medianCpLoss: number;
}

export interface OpeningStat {
  eco: string;
  name: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  avgAccuracy: number;
}

/** A brilliancy with just enough context to place it, and whose move it was. */
export interface BrilliantMove {
  gameId: number;
  ply: number;
  /** Move number as a player counts it: ply 32 and 33 are both move 17. */
  moveNumber: number;
  /** The side the player had. Ply parity always agrees with it. */
  color: "w" | "b";
  san: string;
  phase: string | null;
  motif: string | null;
  opponent: string;
  playedAt: string | null;
  outcome: "win" | "draw" | "loss" | "unknown";
  /** `me` when the player played it, `them` when the opponent did. */
  by: "me" | "them";
}

export interface WeaknessProfile {
  totalGames: number;
  analyzedGames: number;
  totalPlayerMoves: number;
  classification: ClassificationCounts;
  phase: Record<string, PhaseStat>;
  motifs: { motif: string; count: number }[];
  timeManagement: {
    lowTime: { moves: number; avgCpLoss: number; medianCpLoss: number };
    normalTime: { moves: number; avgCpLoss: number; medianCpLoss: number };
  };
  openings: OpeningStat[];
  /** Recent brilliancies on both sides, so the dashboard can toggle between them. */
  recentBrilliant: {
    mine: BrilliantMove[];
    theirs: BrilliantMove[];
    mineTotal: number;
    theirsTotal: number;
  };
  color: {
    white: { games: number; wins: number; draws: number; losses: number };
    black: { games: number; wins: number; draws: number; losses: number };
  };
  accuracyTrend: { gameId: number; playedAt: string | null; accuracy: number | null }[];
  summary: {
    avgAccuracy: number | null;
    blunderRate: number; // blunders per analyzed game
    mostCommonMotif: string | null;
    weakestPhase: string | null;
  };
}

const EMPTY_CLASS: ClassificationCounts = {
  best: 0,
  great: 0,
  good: 0,
  inaccuracy: 0,
  mistake: 0,
  blunder: 0,
  miss: 0,
  book: 0,
  forced: 0,
  brilliant: 0,
};

function emptyProfile(totalGames: number, analyzedGames: number): WeaknessProfile {
  return {
    totalGames,
    analyzedGames,
    totalPlayerMoves: 0,
    classification: { ...EMPTY_CLASS },
    phase: {},
    motifs: [],
    timeManagement: {
      lowTime: { moves: 0, avgCpLoss: 0, medianCpLoss: 0 },
      normalTime: { moves: 0, avgCpLoss: 0, medianCpLoss: 0 },
    },
    openings: [],
    recentBrilliant: { mine: [], theirs: [], mineTotal: 0, theirsTotal: 0 },
    color: {
      white: { games: 0, wins: 0, draws: 0, losses: 0 },
      black: { games: 0, wins: 0, draws: 0, losses: 0 },
    },
    accuracyTrend: [],
    summary: { avgAccuracy: null, blunderRate: 0, mostCommonMotif: null, weakestPhase: null },
  };
}

interface Row {
  ply: number;
  color: string;
  classification: string | null;
  motif: string | null;
  phase: string | null;
  centipawn_loss: number | null;
  clock_seconds: number | null;
  player_color: string;
  eco: string;
  opening_name: string;
  result: string;
  accuracy: number | null;
  played_at: string | null;
  game_id: number;
}

/** How many brilliancies the insights page lists per side. */
const BRILLIANT_LIMIT = 6;
/** How many recent brilliancies to scan before splitting them by side, so one
 *  side's recent run cannot crowd the other out of the list entirely. */
const BRILLIANT_SCAN = 60;

interface BrilliantRow {
  game_id: number;
  ply: number;
  san: string | null;
  color: string;
  phase: string | null;
  motif: string | null;
  player_color: string;
  white: string;
  black: string;
  opponent: string | null;
  result: string;
  played_at: string | null;
}

export type ProfileWindow = "all" | "30" | "100" | "month";

export const PROFILE_WINDOWS: ProfileWindow[] = ["30", "100", "month", "all"];

/**
 * Aggregate the weakness profile, optionally scoped to recent form: the last 30
 * or 100 analysed games, or the last 30 days. All-time was the only view before,
 * which cannot answer "am I improving?".
 */
export function computeWeaknesses(window: ProfileWindow, profileId: number): WeaknessProfile {
  const db = getDb();
  const totalGames = (
    db.prepare("SELECT COUNT(*) n FROM games WHERE profile_id = ?").get(profileId) as { n: number }
  ).n;

  let scopeIds: number[] | null = null;
  if (window === "30" || window === "100") {
    const limit = window === "30" ? 30 : 100;
    scopeIds = (
      db
        .prepare(
          "SELECT id FROM games WHERE analyzed = 1 AND profile_id = ? ORDER BY played_at DESC, id DESC LIMIT ?"
        )
        .all(profileId, limit) as { id: number }[]
    ).map((r) => Number(r.id));
  } else if (window === "month") {
    scopeIds = (
      db
        .prepare(
          `SELECT id FROM games WHERE analyzed = 1 AND profile_id = ?
             AND played_at >= datetime('now', '-30 days')`
        )
        .all(profileId) as { id: number }[]
    ).map((r) => Number(r.id));
  }

  const analyzedGames = scopeIds
    ? scopeIds.length
    : (db
        .prepare("SELECT COUNT(*) n FROM games WHERE analyzed = 1 AND profile_id = ?")
        .get(profileId) as { n: number }).n;
  const profile = emptyProfile(Number(totalGames), Number(analyzedGames));

  const scopeClause = scopeIds ? ` AND id IN (${scopeIds.map(() => "?").join(",")})` : "";
  const games = db
    .prepare(
      `SELECT * FROM games WHERE analyzed = 1 AND profile_id = ?${scopeClause} ORDER BY played_at ASC`
    )
    .all(profileId, ...(scopeIds ?? [])) as Record<string, unknown>[];

  // Color performance + accuracy trend (per game).
  for (const g of games) {
    const result = String(g.result ?? "*");
    const color = String(g.player_color);
    const bucket = color === "w" ? profile.color.white : profile.color.black;
    bucket.games += 1;
    if (result === "1-0") {
      if (color === "w") bucket.wins += 1;
      else bucket.losses += 1;
    } else if (result === "0-1") {
      if (color === "b") bucket.wins += 1;
      else bucket.losses += 1;
    } else if (result === "1/2-1/2") {
      bucket.draws += 1;
    }
    profile.accuracyTrend.push({
      gameId: Number(g.id),
      playedAt: g.played_at == null ? null : String(g.played_at),
      accuracy: g.accuracy == null ? null : Number(g.accuracy),
    });
  }

  const rows = db
    .prepare(
      `SELECT p.ply, p.color, p.classification, p.motif, p.phase, p.centipawn_loss,
              p.clock_seconds, g.player_color, g.eco, g.opening_name, g.result,
              g.accuracy, g.played_at, g.id AS game_id
       FROM positions p JOIN games g ON g.id = p.game_id
       WHERE g.analyzed = 1 AND g.profile_id = ? AND p.color = g.player_color${
         scopeIds ? ` AND p.game_id IN (${scopeIds.map(() => "?").join(",")})` : ""
       }`
    )
    .all(profileId, ...(scopeIds ?? [])) as unknown as Row[];

  const motifCounts = new Map<string, number>();
  const phaseAgg = new Map<
    string,
    { moves: number; blunders: number; mistakes: number; inaccuracies: number; misses: number; cp: number[] }
  >();
  const openingAgg = new Map<string, OpeningStat>();
  const lowTimeCp: number[] = [];
  const normalTimeCp: number[] = [];

  for (const r of rows) {
    profile.totalPlayerMoves += 1;
    const cls = (r.classification ?? "") as keyof ClassificationCounts;
    if (cls in profile.classification) profile.classification[cls] += 1;
    if (r.classification === "blunder" || r.classification === "mistake" || r.classification === "miss") {
      const motif = r.motif ?? "positional";
      motifCounts.set(motif, (motifCounts.get(motif) ?? 0) + 1);
    }

    const phase = r.phase ?? "middlegame";
    const pa = phaseAgg.get(phase) ?? {
      moves: 0,
      blunders: 0,
      mistakes: 0,
      inaccuracies: 0,
      misses: 0,
      cp: [],
    };
    pa.moves += 1;
    if (r.classification === "blunder") pa.blunders += 1;
    if (r.classification === "mistake") pa.mistakes += 1;
    if (r.classification === "inaccuracy") pa.inaccuracies += 1;
    if (r.classification === "miss") pa.misses += 1;
    if (r.centipawn_loss != null) pa.cp.push(Math.min(r.centipawn_loss, CP_CLAMP));
    phaseAgg.set(phase, pa);

    // Time management: "low time" = under 30 seconds remaining.
    if (r.clock_seconds != null) {
      if (r.clock_seconds < 30) lowTimeCp.push(Math.min(r.centipawn_loss ?? 0, CP_CLAMP));
      else normalTimeCp.push(Math.min(r.centipawn_loss ?? 0, CP_CLAMP));
    }

    // Opening performance (aggregate accuracy across the game's opening key).
    const eco = r.eco || "?";
    const oa = openingAgg.get(eco) ?? {
      eco,
      name: r.opening_name || eco,
      games: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      winRate: 0,
      avgAccuracy: 0,
    };
    openingAgg.set(eco, oa);

  }

  // Opening games/win-rate from the game table (once per game, not per move).
  for (const g of games) {
    const eco = String(g.eco ?? "?");
    const name = String(g.opening_name ?? eco);
    let oa = openingAgg.get(eco);
    if (!oa) {
      oa = { eco, name, games: 0, wins: 0, draws: 0, losses: 0, winRate: 0, avgAccuracy: 0 };
      openingAgg.set(eco, oa);
    }
    oa.games += 1;
    const result = String(g.result ?? "*");
    const color = String(g.player_color);
    const playerWon = (color === "w" && result === "1-0") || (color === "b" && result === "0-1");
    const playerLost = (color === "w" && result === "0-1") || (color === "b" && result === "1-0");
    if (playerWon) oa.wins += 1;
    else if (playerLost) oa.losses += 1;
    else if (result === "1/2-1/2") oa.draws += 1;
  }

  profile.phase = {};
  for (const [phase, v] of phaseAgg) {
    const errors = v.blunders + v.mistakes + v.misses;
    const cpSum = v.cp.reduce((a, b) => a + b, 0);
    profile.phase[phase] = {
      moves: v.moves,
      blunders: v.blunders,
      mistakes: v.mistakes,
      inaccuracies: v.inaccuracies,
      misses: v.misses,
      errorsPer100: v.moves ? Number(((errors / v.moves) * 100).toFixed(1)) : 0,
      avgCpLoss: v.cp.length ? cpSum / v.cp.length : 0,
      medianCpLoss: median(v.cp),
    };
  }

  profile.motifs = [...motifCounts.entries()]
    .map(([motif, count]) => ({ motif, count }))
    .sort((a, b) => b.count - a.count);

  profile.timeManagement = {
    lowTime: {
      moves: lowTimeCp.length,
      avgCpLoss: lowTimeCp.length ? lowTimeCp.reduce((a, b) => a + b, 0) / lowTimeCp.length : 0,
      medianCpLoss: median(lowTimeCp),
    },
    normalTime: {
      moves: normalTimeCp.length,
      avgCpLoss: normalTimeCp.length ? normalTimeCp.reduce((a, b) => a + b, 0) / normalTimeCp.length : 0,
      medianCpLoss: median(normalTimeCp),
    },
  };

  profile.openings = [...openingAgg.values()]
    .map((o) => ({
      ...o,
      winRate: o.games ? Number(((o.wins / o.games) * 100).toFixed(1)) : 0,
      avgAccuracy: 0,
    }))
    .filter((o) => o.games > 0)
    .sort((a, b) => b.games - a.games)
    .slice(0, 30);

  // Per-opening average accuracy from the accuracy trend.
  const accByEco = new Map<string, { sum: number; n: number }>();
  for (const g of games) {
    if (g.accuracy == null) continue;
    const eco = String(g.eco ?? "?");
    const cur = accByEco.get(eco) ?? { sum: 0, n: 0 };
    cur.sum += Number(g.accuracy);
    cur.n += 1;
    accByEco.set(eco, cur);
  }
  profile.openings = profile.openings.map((o) => {
    const a = accByEco.get(o.eco);
    return { ...o, avgAccuracy: a && a.n ? a.sum / a.n : 0 };
  });

  // Accuracy is a per-game rating, so average it per game rather than per move.
  const gameAccuracies = games.map((g) => (g.accuracy == null ? null : Number(g.accuracy))).filter((a): a is number => a != null);
  // Phase verdict: error rate first (robust), then median loss as the tiebreak.
  const weakest = [...Object.entries(profile.phase)].sort(
    (a, b) => b[1].errorsPer100 - a[1].errorsPer100 || b[1].medianCpLoss - a[1].medianCpLoss
  )[0];

  profile.summary = {
    avgAccuracy: gameAccuracies.length ? gameAccuracies.reduce((a, b) => a + b, 0) / gameAccuracies.length : null,
    blunderRate: analyzedGames ? profile.classification.blunder / analyzedGames : 0,
    mostCommonMotif: profile.motifs[0]?.motif ?? null,
    weakestPhase: weakest?.[0] ?? null,
  };

  // Brilliancies are recorded for both sides, so each row is tagged `me`/`them`
  // and the dashboard decides what to show. Both sides are fetched in one pass and
  // split here, so each keeps its own recency instead of one crowding out the other.
  const brilliantRows = db
    .prepare(
      `SELECT p.game_id, p.ply, p.san, p.color, p.phase, p.motif,
              g.player_color, g.white, g.black, g.opponent, g.result, g.played_at
       FROM positions p JOIN games g ON g.id = p.game_id
       WHERE p.classification = 'brilliant' AND g.analyzed = 1 AND g.profile_id = ?${
         scopeIds ? ` AND g.id IN (${scopeIds.map(() => "?").join(",")})` : ""
       }
       ORDER BY g.played_at DESC, p.game_id DESC, p.ply ASC
       LIMIT ?`
    )
    .all(profileId, ...(scopeIds ?? []), BRILLIANT_SCAN) as unknown as BrilliantRow[];

  const toBrilliantMove = (r: BrilliantRow): BrilliantMove => {
    const color: "w" | "b" = r.player_color === "b" ? "b" : "w";
    const result = String(r.result ?? "*");
    const won = (color === "w" && result === "1-0") || (color === "b" && result === "0-1");
    const lost = (color === "w" && result === "0-1") || (color === "b" && result === "1-0");
    const ply = Number(r.ply);
    return {
      gameId: Number(r.game_id),
      ply,
      moveNumber: Math.floor(ply / 2) + 1,
      color,
      san: r.san ?? "",
      phase: r.phase,
      motif: r.motif,
      opponent: r.opponent ?? (color === "w" ? r.black : r.white),
      playedAt: r.played_at,
      outcome: won ? "win" : lost ? "loss" : result === "1/2-1/2" ? "draw" : "unknown",
      by: r.color === r.player_color ? "me" : "them",
    };
  };

  const mine: BrilliantMove[] = [];
  const theirs: BrilliantMove[] = [];
  for (const r of brilliantRows) {
    const move = toBrilliantMove(r);
    if (move.by === "me") {
      if (mine.length < BRILLIANT_LIMIT) mine.push(move);
    } else if (theirs.length < BRILLIANT_LIMIT) {
      theirs.push(move);
    }
  }

  const brilliantCounts = db
    .prepare(
      `SELECT SUM(p.color = g.player_color) AS mine,
              SUM(p.color <> g.player_color) AS theirs
       FROM positions p JOIN games g ON g.id = p.game_id
       WHERE p.classification = 'brilliant' AND g.analyzed = 1 AND g.profile_id = ?${
         scopeIds ? ` AND g.id IN (${scopeIds.map(() => "?").join(",")})` : ""
       }`
    )
    .get(profileId, ...(scopeIds ?? [])) as { mine: number | null; theirs: number | null };

  profile.recentBrilliant = {
    mine,
    theirs,
    mineTotal: Number(brilliantCounts?.mine ?? 0),
    theirsTotal: Number(brilliantCounts?.theirs ?? 0),
  };

  return profile;
}
