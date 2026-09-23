import "server-only";
import { getDb, listOpeningReviews } from "./db";

export interface Opening {
  eco: string;
  name: string;
  /** Main-line moves in UCI. */
  uci: string[];
  wikipedia: string;
  ideas?: string;
}

/**
 * A curated, hand-checked subset of common openings (the full 12,379-entry ECO
 * catalogue can be dropped in as a larger data file — see README). Each entry's
 * main line is long enough for practical deviation detection.
 */
export const OPENINGS: Opening[] = [
  { eco: "A09", name: "Réti Opening", uci: ["g1f3", "d7d5", "c2c4"], wikipedia: "https://en.wikipedia.org/wiki/R%C3%A9ti_Opening" },
  { eco: "A10", name: "English Opening", uci: ["c2c4"], wikipedia: "https://en.wikipedia.org/wiki/English_Opening" },
  { eco: "A60", name: "Benoni Defense", uci: ["d2d4", "g8f6", "c2c4", "c7c5", "d4d5", "e7e6"], wikipedia: "https://en.wikipedia.org/wiki/Benoni_Defense" },
  { eco: "A80", name: "Dutch Defense", uci: ["d2d4", "f7f5"], wikipedia: "https://en.wikipedia.org/wiki/Dutch_Defence" },
  { eco: "B01", name: "Scandinavian Defense", uci: ["e2e4", "d7d5", "e4d5", "d8d5", "b1c3", "d5a5"], wikipedia: "https://en.wikipedia.org/wiki/Scandinavian_Defense" },
  { eco: "B02", name: "Alekhine's Defense", uci: ["e2e4", "g8f6", "e4e5", "f6d5", "d2d4", "d7d6"], wikipedia: "https://en.wikipedia.org/wiki/Alekhine%27s_Defence" },
  { eco: "B06", name: "Modern Defense", uci: ["e2e4", "g7g6", "d2d4", "f8g7"], wikipedia: "https://en.wikipedia.org/wiki/Modern_Defense" },
  { eco: "B07", name: "Pirc Defense", uci: ["e2e4", "d7d6", "d2d4", "g8f6", "b1c3", "g7g6"], wikipedia: "https://en.wikipedia.org/wiki/Pirc_Defence" },
  { eco: "B10", name: "Caro-Kann Defense", uci: ["e2e4", "c7c6", "d2d4", "d7d5"], wikipedia: "https://en.wikipedia.org/wiki/Caro%E2%80%93Kann_Defence" },
  { eco: "B20", name: "Sicilian Defense", uci: ["e2e4", "c7c5", "g1f3", "d7d6", "d2d4", "c5d4", "f3d4", "g8f6", "b1c3"], wikipedia: "https://en.wikipedia.org/wiki/Sicilian_Defence" },
  { eco: "B90", name: "Sicilian Defense: Najdorf", uci: ["e2e4", "c7c5", "g1f3", "d7d6", "d2d4", "c5d4", "f3d4", "g8f6", "b1c3", "a7a6"], wikipedia: "https://en.wikipedia.org/wiki/Sicilian_Defence,_Najdorf_Variation" },
  { eco: "C00", name: "French Defense", uci: ["e2e4", "e7e6", "d2d4", "d7d5"], wikipedia: "https://en.wikipedia.org/wiki/French_Defence" },
  { eco: "C25", name: "Vienna Game", uci: ["e2e4", "e7e5", "b1c3"], wikipedia: "https://en.wikipedia.org/wiki/Vienna_Game" },
  { eco: "C30", name: "King's Gambit", uci: ["e2e4", "e7e5", "f2f4", "e5f4"], wikipedia: "https://en.wikipedia.org/wiki/King%27s_Gambit" },
  { eco: "C44", name: "Scotch Game", uci: ["e2e4", "e7e5", "g1f3", "b8c6", "d2d4", "e5d4", "f3d4"], wikipedia: "https://en.wikipedia.org/wiki/Scotch_Game" },
  { eco: "C50", name: "Italian Game", uci: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"], wikipedia: "https://en.wikipedia.org/wiki/Italian_Game" },
  { eco: "C60", name: "Ruy Lopez", uci: ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4", "g8f6", "e1g1"], wikipedia: "https://en.wikipedia.org/wiki/Ruy_Lopez" },
  { eco: "D02", name: "London System", uci: ["d2d4", "d7d5", "g1f3", "g8f6", "c1f4"], wikipedia: "https://en.wikipedia.org/wiki/London_System" },
  { eco: "D06", name: "Queen's Gambit", uci: ["d2d4", "d7d5", "c2c4"], wikipedia: "https://en.wikipedia.org/wiki/Queen%27s_Gambit" },
  { eco: "D10", name: "Slav Defense", uci: ["d2d4", "d7d5", "c2c4", "c7c6"], wikipedia: "https://en.wikipedia.org/wiki/Slav_Defense" },
  { eco: "D30", name: "Queen's Gambit Declined", uci: ["d2d4", "d7d5", "c2c4", "e7e6"], wikipedia: "https://en.wikipedia.org/wiki/Queen%27s_Gambit_Declined" },
  { eco: "D80", name: "Grünfeld Defense", uci: ["d2d4", "g8f6", "c2c4", "g7g6", "b1c3", "d7d5"], wikipedia: "https://en.wikipedia.org/wiki/Gr%C3%BCnfeld_Defence" },
  { eco: "E00", name: "Catalan Opening", uci: ["d2d4", "g8f6", "c2c4", "e7e6", "g2g3"], wikipedia: "https://en.wikipedia.org/wiki/Catalan_Opening" },
  { eco: "E20", name: "Nimzo-Indian Defense", uci: ["d2d4", "g8f6", "c2c4", "e7e6", "b1c3", "f8b4"], wikipedia: "https://en.wikipedia.org/wiki/Nimzo-Indian_Defence" },
  { eco: "E60", name: "King's Indian Defense", uci: ["d2d4", "g8f6", "c2c4", "g7g6", "b1c3", "f8g7", "e2e4", "d7d6"], wikipedia: "https://en.wikipedia.org/wiki/King%27s_Indian_Defence" },
];

export interface OpeningRecord {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  avgAccuracy: number | null;
  lastPlayed: string | null;
}

export interface OpeningEntry extends Opening {
  /** The player's own results with this ECO code, when they have any. */
  record: OpeningRecord | null;
  review: {
    ease: number;
    intervalDays: number;
    repetitions: number;
    dueAt: string | null;
    cleanCount: number;
    missCount: number;
    lastReviewedAt: string | null;
  } | null;
  due: boolean;
}

/** The theory set joined with the player's results and review schedule. */
export function getOpeningEntries(): OpeningEntry[] {
  const db = getDb();
  const records = new Map<string, OpeningRecord>();
  const rows = db
    .prepare(
      `SELECT eco, COUNT(*) games,
              SUM(CASE WHEN (player_color = 'w' AND result = '1-0') OR (player_color = 'b' AND result = '0-1') THEN 1 ELSE 0 END) wins,
              SUM(CASE WHEN result = '1/2-1/2' THEN 1 ELSE 0 END) draws,
              SUM(CASE WHEN (player_color = 'w' AND result = '0-1') OR (player_color = 'b' AND result = '1-0') THEN 1 ELSE 0 END) losses,
              AVG(accuracy) avgAccuracy, MAX(played_at) lastPlayed
       FROM games WHERE eco IS NOT NULL AND eco <> '' AND analyzed = 1 GROUP BY eco`
    )
    .all() as Record<string, unknown>[];
  for (const r of rows) {
    const games = Number(r.games ?? 0);
    records.set(String(r.eco), {
      games,
      wins: Number(r.wins ?? 0),
      draws: Number(r.draws ?? 0),
      losses: Number(r.losses ?? 0),
      winRate: games ? Number((((Number(r.wins ?? 0) + Number(r.draws ?? 0) / 2) / games) * 100).toFixed(1)) : 0,
      avgAccuracy: r.avgAccuracy == null ? null : Number(r.avgAccuracy),
      lastPlayed: r.lastPlayed == null ? null : String(r.lastPlayed),
    });
  }

  const reviews = new Map(listOpeningReviews().map((r) => [r.eco, r]));
  const now = Date.now();
  return OPENINGS.map((o) => {
    const review = reviews.get(o.eco);
    const record = records.get(o.eco) ?? null;
    return {
      ...o,
      record,
      review: review
        ? {
            ease: review.ease,
            intervalDays: review.interval_days,
            repetitions: review.repetitions,
            dueAt: review.due_at,
            cleanCount: review.clean_count,
            missCount: review.miss_count,
            lastReviewedAt: review.last_reviewed_at,
          }
        : null,
      // "Due" only means something for a line you actually play: an opening you
      // have never had on the board is not overdue.
      due: Boolean(record) && (!review?.due_at || new Date(review.due_at).getTime() <= now),
    };
  });
}

export function getOpenings(): Opening[] {
  return OPENINGS;
}

export function findOpening(eco: string): Opening | undefined {
  return OPENINGS.find((o) => o.eco === eco);
}

export interface Deviation {
  opening: Opening;
  playedMoves: string[];
  /** Index (0-based) of the first move that leaves the main line, or -1 if none. */
  deviatedAt: number;
  expected: string | null;
  played: string | null;
}

/** Compare a played move sequence against an opening's main line. */
export function detectDeviation(playedMoves: string[], opening: Opening): Deviation {
  let deviatedAt = -1;
  let expected: string | null = null;
  let played: string | null = null;
  const n = Math.min(playedMoves.length, opening.uci.length);
  for (let i = 0; i < n; i++) {
    if (playedMoves[i] !== opening.uci[i]) {
      deviatedAt = i;
      expected = opening.uci[i];
      played = playedMoves[i];
      break;
    }
  }
  if (deviatedAt === -1 && playedMoves.length > opening.uci.length) {
    deviatedAt = opening.uci.length;
    played = playedMoves[opening.uci.length] ?? null;
    expected = null;
  }
  return { opening, playedMoves, deviatedAt, expected, played };
}
