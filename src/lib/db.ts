import "server-only";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import type { GameRow, PositionRow, PuzzleRow } from "./types";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Every game belongs to exactly one profile. Without this the whole library is
  -- a single shared pool and each dashboard silently blends every user's games.
  profile_id INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  external_id TEXT,
  pgn TEXT NOT NULL,
  white TEXT NOT NULL,
  black TEXT NOT NULL,
  white_rating INTEGER,
  black_rating INTEGER,
  result TEXT NOT NULL DEFAULT '*',
  time_control TEXT,
  speed TEXT,
  eco TEXT,
  opening_name TEXT,
  played_at TEXT,
  player_color TEXT NOT NULL,
  player_rating INTEGER,
  opponent TEXT,
  opponent_rating INTEGER,
  total_plies INTEGER NOT NULL DEFAULT 0,
  analyzed INTEGER NOT NULL DEFAULT 0,
  accuracy REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Scoped by profile: two people who played each other both import the same
  -- game, and the pre-profile key let the second import overwrite the first
  -- player's colour, opponent and rating.
  UNIQUE(profile_id, source, external_id)
);

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  ply INTEGER NOT NULL,
  color TEXT NOT NULL,
  fen TEXT NOT NULL,
  san TEXT,
  uci TEXT,
  fen_after TEXT NOT NULL,
  best_move TEXT,
  best_move_san TEXT,
  eval_before REAL,
  mate_before INTEGER,
  eval_after REAL,
  mate_after INTEGER,
  centipawn_loss REAL,
  classification TEXT,
  motif TEXT,
  phase TEXT,
  clock_seconds INTEGER,
  is_critical INTEGER NOT NULL DEFAULT 0,
  explanation TEXT,
  key_lesson TEXT,
  drill_suggestion TEXT,
  UNIQUE(game_id, ply)
);

CREATE TABLE IF NOT EXISTS puzzles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  position_id INTEGER,
  fen TEXT NOT NULL,
  solution_uci TEXT NOT NULL,
  solution_san TEXT,
  theme TEXT,
  ease REAL NOT NULL DEFAULT 2.5,
  interval_days REAL NOT NULL DEFAULT 0,
  repetitions INTEGER NOT NULL DEFAULT 0,
  due_at TEXT,
  solved_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS opening_reviews (
  profile_id INTEGER NOT NULL DEFAULT 1,
  eco TEXT NOT NULL,
  ease REAL NOT NULL DEFAULT 2.5,
  interval_days REAL NOT NULL DEFAULT 0,
  repetitions INTEGER NOT NULL DEFAULT 0,
  due_at TEXT,
  clean_count INTEGER NOT NULL DEFAULT 0,
  miss_count INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (profile_id, eco)
);

CREATE TABLE IF NOT EXISTS llm_cache (
  fen TEXT PRIMARY KEY,
  explanation TEXT,
  key_lesson TEXT,
  drill_suggestion TEXT,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS engine_cache (
  fen TEXT PRIMARY KEY,
  best_move TEXT,
  score_cp REAL,
  mate INTEGER,
  pv TEXT,
  depth INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lichess_username TEXT,
  chesscom_username TEXT,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Kept separate from the profiles table on purpose: a token must never ride
-- along on a row that a listing endpoint might serialise.
CREATE TABLE IF NOT EXISTS profile_secrets (
  profile_id INTEGER PRIMARY KEY,
  lichess_token TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  label TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  progress REAL NOT NULL DEFAULT 0,
  stage TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 2,
  error TEXT,
  result TEXT,
  worker_id TEXT,
  leased_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT
);

`;

/*
 * Indexes live apart from SCHEMA because rebuilding a table drops its indexes;
 * this block is idempotent and runs after every migration.
 */
const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_positions_game ON positions(game_id, ply);
CREATE INDEX IF NOT EXISTS idx_games_analyzed ON games(analyzed);
CREATE INDEX IF NOT EXISTS idx_games_played ON games(played_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_source ON games(source);
CREATE INDEX IF NOT EXISTS idx_games_profile ON games(profile_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_puzzles_game ON puzzles(game_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, priority, id);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
`;

// Column lists shared by the migration's copy statements, so a rebuild can never
// silently misalign old and new ordering.
const GAME_COLUMNS = [
  "id", "profile_id", "source", "external_id", "pgn", "white", "black",
  "white_rating", "black_rating", "result", "time_control", "speed", "eco",
  "opening_name", "played_at", "player_color", "player_rating", "opponent",
  "opponent_rating", "total_plies", "analyzed", "accuracy", "created_at",
];

/**
 * Upgrade a pre-profile database in place.
 *
 * Everything that existed before profiles belonged to the one user who was using
 * the app, so it is attributed to profile 1 — which the old schema guaranteed
 * was the only row. Each rebuild copies ids verbatim so `positions.game_id` and
 * `puzzles.game_id` keep pointing at the right games.
 */
function migrateMultiProfile(db: DatabaseSync): void {
  const tableSql = (name: string): string =>
    String(
      (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?").get(name) as
        | { sql?: string }
        | undefined)?.sql ?? ""
    );
  const columns = (name: string): string[] =>
    (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name);

  // profiles: the old table was pinned to a single row by CHECK (id = 1).
  if (tableSql("profiles").includes("CHECK (id = 1)")) {
    db.exec(`
      ALTER TABLE profiles RENAME TO profiles_singleton;
      CREATE TABLE profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lichess_username TEXT,
        chesscom_username TEXT,
        display_name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO profiles (id, lichess_username, chesscom_username, updated_at)
        SELECT id, lichess_username, chesscom_username, updated_at FROM profiles_singleton;
      DROP TABLE profiles_singleton;
    `);
  }

  // games: gains profile_id and a profile-scoped uniqueness key.
  const gameCols = columns("games");
  if (gameCols.length > 0 && !gameCols.includes("profile_id")) {
    db.exec(`
      ALTER TABLE games RENAME TO games_pre_profile;
      CREATE TABLE games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL,
        external_id TEXT,
        pgn TEXT NOT NULL,
        white TEXT NOT NULL,
        black TEXT NOT NULL,
        white_rating INTEGER,
        black_rating INTEGER,
        result TEXT NOT NULL DEFAULT '*',
        time_control TEXT,
        speed TEXT,
        eco TEXT,
        opening_name TEXT,
        played_at TEXT,
        player_color TEXT NOT NULL,
        player_rating INTEGER,
        opponent TEXT,
        opponent_rating INTEGER,
        total_plies INTEGER NOT NULL DEFAULT 0,
        analyzed INTEGER NOT NULL DEFAULT 0,
        accuracy REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(profile_id, source, external_id)
      );
      INSERT INTO games (${GAME_COLUMNS.join(", ")})
        SELECT ${GAME_COLUMNS.map((c) => (c === "profile_id" ? "1" : c)).join(", ")}
        FROM games_pre_profile;
      DROP TABLE games_pre_profile;
    `);
  }

  // opening_reviews: review schedules are per player, not global.
  const reviewCols = columns("opening_reviews");
  if (reviewCols.length > 0 && !reviewCols.includes("profile_id")) {
    db.exec(`
      ALTER TABLE opening_reviews RENAME TO opening_reviews_global;
      CREATE TABLE opening_reviews (
        profile_id INTEGER NOT NULL DEFAULT 1,
        eco TEXT NOT NULL,
        ease REAL NOT NULL DEFAULT 2.5,
        interval_days REAL NOT NULL DEFAULT 0,
        repetitions INTEGER NOT NULL DEFAULT 0,
        due_at TEXT,
        clean_count INTEGER NOT NULL DEFAULT 0,
        miss_count INTEGER NOT NULL DEFAULT 0,
        last_reviewed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (profile_id, eco)
      );
      INSERT INTO opening_reviews
        (profile_id, eco, ease, interval_days, repetitions, due_at, clean_count, miss_count, last_reviewed_at, created_at)
        SELECT 1, eco, ease, interval_days, repetitions, due_at, clean_count, miss_count, last_reviewed_at, created_at
        FROM opening_reviews_global;
      DROP TABLE opening_reviews_global;
    `);
  }

  // The one global Lichess token becomes profile 1's secret.
  const legacyToken = db
    .prepare("SELECT value FROM settings WHERE key = 'lichess_token'")
    .get() as { value?: string } | undefined;
  if (legacyToken?.value) {
    db.prepare(
      `INSERT INTO profile_secrets (profile_id, lichess_token, updated_at)
       VALUES (1, ?, datetime('now'))
       ON CONFLICT(profile_id) DO UPDATE SET
         lichess_token = excluded.lichess_token, updated_at = excluded.updated_at`
    ).run(legacyToken.value);
    db.prepare("DELETE FROM settings WHERE key = 'lichess_token'").run();
  }

  // The app has always presented one always-present profile; keep that so a fresh
  // install opens on something selectable rather than an empty picker.
  const any = db.prepare("SELECT COUNT(*) AS n FROM profiles").get() as { n: number };
  if (Number(any?.n ?? 0) === 0) {
    db.prepare("INSERT INTO profiles (lichess_username, chesscom_username) VALUES ('', '')").run();
  }
}

// Reuse a single connection across hot reloads / route invocations.
const globalForDb = globalThis as unknown as { __chessdadDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  if (globalForDb.__chessdadDb) return globalForDb.__chessdadDb;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const db = new DatabaseSync(config.dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  migrateLegacyQueue(db);
  migrateMultiProfile(db);
  // Re-assert indexes: a rebuild above drops the ones attached to the old table.
  db.exec(INDEXES);
  globalForDb.__chessdadDb = db;
  return db;
}

/**
 * One-time fold of the old analysis-only queue into the general `jobs` table.
 * Queue rows are ephemeral state, so a failure here is harmless.
 */
function migrateLegacyQueue(db: DatabaseSync): void {
  try {
    const legacy = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='analysis_jobs'")
      .get();
    if (!legacy) return;
    db.exec(
      `INSERT INTO jobs (type, payload, label, priority, status, progress, stage,
                         attempts, max_attempts, error, worker_id, leased_until,
                         created_at, started_at, finished_at)
       SELECT 'analyze',
              json_object('gameId', game_id, 'depth', depth,
                          'explain', explain, 'generatePuzzles', generate_puzzles),
              'game ' || game_id, 0, status, progress, stage,
              attempts, max_attempts, error, worker_id, leased_until,
              created_at, started_at, finished_at
       FROM analysis_jobs`
    );
    db.exec("DROP TABLE analysis_jobs");
  } catch {
    // non-fatal: the queue is ephemeral
  }
}

function toGameRow(r: Record<string, unknown>): GameRow {
  return {
    id: Number(r.id),
    profile_id: Number(r.profile_id ?? 1),
    source: r.source as GameRow["source"],
    external_id: r.external_id as string | null,
    pgn: String(r.pgn ?? ""),
    white: String(r.white ?? ""),
    black: String(r.black ?? ""),
    white_rating: r.white_rating == null ? null : Number(r.white_rating),
    black_rating: r.black_rating == null ? null : Number(r.black_rating),
    result: String(r.result ?? "*"),
    time_control: String(r.time_control ?? ""),
    speed: String(r.speed ?? ""),
    eco: String(r.eco ?? ""),
    opening_name: String(r.opening_name ?? ""),
    played_at: r.played_at as string | null,
    player_color: r.player_color as GameRow["player_color"],
    player_rating: r.player_rating == null ? null : Number(r.player_rating),
    opponent: String(r.opponent ?? ""),
    opponent_rating: r.opponent_rating == null ? null : Number(r.opponent_rating),
    total_plies: Number(r.total_plies ?? 0),
    analyzed: Number(r.analyzed ?? 0),
    accuracy: r.accuracy == null ? null : Number(r.accuracy),
    created_at: String(r.created_at ?? ""),
    flagged: r.flagged == null ? undefined : Number(r.flagged),
    blunders: r.blunders == null ? undefined : Number(r.blunders),
    decisive_ply: r.decisive_ply == null ? null : Number(r.decisive_ply),
    decisive_cpl: r.decisive_cpl == null ? null : Number(r.decisive_cpl),
    decisive_san: r.decisive_san == null ? null : String(r.decisive_san),
    decisive_motif: r.decisive_motif == null ? null : String(r.decisive_motif),
  };
}

function toPositionRow(r: Record<string, unknown>): PositionRow {
  return {
    id: Number(r.id),
    game_id: Number(r.game_id),
    ply: Number(r.ply),
    color: r.color as PositionRow["color"],
    fen: String(r.fen ?? ""),
    san: r.san == null ? null : String(r.san),
    uci: r.uci == null ? null : String(r.uci),
    fen_after: String(r.fen_after ?? ""),
    best_move: r.best_move == null ? null : String(r.best_move),
    best_move_san: r.best_move_san == null ? null : String(r.best_move_san),
    eval_before: r.eval_before == null ? null : Number(r.eval_before),
    mate_before: r.mate_before == null ? null : Number(r.mate_before),
    eval_after: r.eval_after == null ? null : Number(r.eval_after),
    mate_after: r.mate_after == null ? null : Number(r.mate_after),
    centipawn_loss: r.centipawn_loss == null ? null : Number(r.centipawn_loss),
    classification: (r.classification as PositionRow["classification"]) ?? null,
    motif: r.motif == null ? null : String(r.motif),
    phase: (r.phase as PositionRow["phase"]) ?? null,
    clock_seconds: r.clock_seconds == null ? null : Number(r.clock_seconds),
    is_critical: Number(r.is_critical ?? 0),
    explanation: r.explanation == null ? null : String(r.explanation),
    key_lesson: r.key_lesson == null ? null : String(r.key_lesson),
    drill_suggestion: r.drill_suggestion == null ? null : String(r.drill_suggestion),
  };
}

// ---------- Games ----------

export interface NewGame {
  /** Owner. Every game belongs to exactly one profile. */
  profile_id: number;
  source: GameRow["source"];
  external_id: string | null;
  pgn: string;
  white: string;
  black: string;
  white_rating: number | null;
  black_rating: number | null;
  result: string;
  time_control: string;
  speed: string;
  eco: string;
  opening_name: string;
  played_at: string | null;
  player_color: GameRow["player_color"];
  player_rating: number | null;
  opponent: string;
  opponent_rating: number | null;
  total_plies: number;
}

export function upsertGame(g: NewGame): number {
  const db = getDb();
  db.prepare(
    `INSERT INTO games (
      profile_id, source, external_id, pgn, white, black, white_rating, black_rating,
      result, time_control, speed, eco, opening_name, played_at,
      player_color, player_rating, opponent, opponent_rating, total_plies
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, source, external_id) DO UPDATE SET
      pgn=excluded.pgn, white=excluded.white, black=excluded.black,
      white_rating=excluded.white_rating, black_rating=excluded.black_rating,
      result=excluded.result, time_control=excluded.time_control,
      speed=excluded.speed, eco=excluded.eco, opening_name=excluded.opening_name,
      played_at=excluded.played_at, player_color=excluded.player_color,
      player_rating=excluded.player_rating, opponent=excluded.opponent,
      opponent_rating=excluded.opponent_rating, total_plies=excluded.total_plies`
  ).run(
    g.profile_id,
    g.source,
    g.external_id ?? "",
    g.pgn,
    g.white,
    g.black,
    g.white_rating,
    g.black_rating,
    g.result,
    g.time_control,
    g.speed,
    g.eco,
    g.opening_name,
    g.played_at,
    g.player_color,
    g.player_rating,
    g.opponent,
    g.opponent_rating,
    g.total_plies
  );

  // With ON CONFLICT DO UPDATE the insert reports an unreliable rowid, so re-select.
  const row = db
    .prepare("SELECT id FROM games WHERE profile_id = ? AND source = ? AND external_id = ?")
    .get(g.profile_id, g.source, g.external_id ?? "") as { id: number } | undefined;
  return Number(row?.id ?? 0);
}

export function getGame(id: number): GameRow | null {
  const r = getDb().prepare("SELECT * FROM games WHERE id = ?").get(id);
  return r ? toGameRow(r as Record<string, unknown>) : null;
}

export function getGameByExternalId(source: string, externalId: string): GameRow | null {
  const r = getDb()
    .prepare("SELECT * FROM games WHERE source = ? AND external_id = ?")
    .get(source, externalId);
  return r ? toGameRow(r as Record<string, unknown>) : null;
}

export function deleteGame(id: number): void {
  const db = getDb();
  db.prepare("DELETE FROM positions WHERE game_id = ?").run(id);
  db.prepare("DELETE FROM puzzles WHERE game_id = ?").run(id);
  db.prepare("DELETE FROM games WHERE id = ?").run(id);
}

export interface GameQuery {
  /** Whose library to query. Always required: an unscoped list would blend users. */
  profileId: number;
  /** Free-text search over players, opening name and ECO. */
  q?: string;
  source?: string;
  speed?: string;
  analyzed?: 0 | 1;
  color?: "w" | "b";
  /** Outcome from the player's perspective. */
  result?: "win" | "loss" | "draw";
  /** Inclusive ISO date bounds on played_at. */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface GameQueryResult {
  games: GameRow[];
  total: number;
  analyzed: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** Paginated, searchable, filterable view of the games table. */
export function queryGames(query: GameQuery): GameQueryResult {
  const db = getDb();
  // The profile predicate is seeded first so no code path can build an unscoped query.
  const where: string[] = ["profile_id = ?"];
  const params: (string | number)[] = [query.profileId];

  if (query.q && query.q.trim()) {
    const like = `%${query.q.trim().toLowerCase()}%`;
    where.push(
      `(lower(white) LIKE ? OR lower(black) LIKE ? OR lower(opponent) LIKE ?
        OR lower(opening_name) LIKE ? OR lower(eco) LIKE ?)`
    );
    params.push(like, like, like, like, like);
  }
  if (query.source) {
    where.push("source = ?");
    params.push(query.source);
  }
  if (query.speed) {
    where.push("speed = ?");
    params.push(query.speed);
  }
  if (query.analyzed != null) {
    where.push("analyzed = ?");
    params.push(query.analyzed);
  }
  if (query.color) {
    where.push("player_color = ?");
    params.push(query.color);
  }
  if (query.result === "win") {
    where.push("((player_color='w' AND result='1-0') OR (player_color='b' AND result='0-1'))");
  } else if (query.result === "loss") {
    where.push("((player_color='w' AND result='0-1') OR (player_color='b' AND result='1-0'))");
  } else if (query.result === "draw") {
    where.push("result = '1/2-1/2'");
  }
  if (query.from) {
    where.push("played_at >= ?");
    params.push(query.from);
  }
  if (query.to) {
    where.push("played_at <= ?");
    params.push(query.to);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const counts = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN analyzed=1 THEN 1 ELSE 0 END) AS analyzed
       FROM games ${whereSql}`
    )
    .get(...params) as Record<string, unknown>;
  const total = Number(counts?.total ?? 0);
  const analyzed = Number(counts?.analyzed ?? 0);

  const pageSize = Math.min(Math.max(Math.floor(query.pageSize ?? 50), 1), 200);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(Math.floor(query.page ?? 1), 1), pageCount);
  const offset = (page - 1) * pageSize;

  const rows = db
    .prepare(
      `SELECT g.*,
              (SELECT COUNT(*) FROM positions p WHERE p.game_id = g.id AND p.color = g.player_color
                 AND p.classification IN ('mistake','blunder','miss')) AS flagged,
              (SELECT COUNT(*) FROM positions p WHERE p.game_id = g.id AND p.color = g.player_color
                 AND p.classification = 'blunder') AS blunders,
              (SELECT p.ply FROM positions p WHERE p.game_id = g.id AND p.color = g.player_color
                 AND p.classification IN ('mistake','blunder','miss')
                 ORDER BY p.centipawn_loss DESC LIMIT 1) AS decisive_ply,
              (SELECT MIN(p.centipawn_loss, 1000) FROM positions p WHERE p.game_id = g.id AND p.color = g.player_color
                 AND p.classification IN ('mistake','blunder','miss')
                 ORDER BY p.centipawn_loss DESC LIMIT 1) AS decisive_cpl,
              (SELECT p.san FROM positions p WHERE p.game_id = g.id AND p.color = g.player_color
                 AND p.classification IN ('mistake','blunder','miss')
                 ORDER BY p.centipawn_loss DESC LIMIT 1) AS decisive_san,
              (SELECT p.motif FROM positions p WHERE p.game_id = g.id AND p.color = g.player_color
                 AND p.classification IN ('mistake','blunder','miss')
                 ORDER BY p.centipawn_loss DESC LIMIT 1) AS decisive_motif
       FROM games g ${whereSql}
       ORDER BY g.played_at DESC, g.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset) as Record<string, unknown>[];

  return {
    games: rows.map(toGameRow),
    total,
    analyzed,
    page,
    pageSize,
    pageCount,
  };
}

/** Of these games, the ones that still need analysis (have moves, not analysed). */
export function filterUnanalyzedWithMoves(gameIds: number[]): number[] {
  if (gameIds.length === 0) return [];
  const placeholders = gameIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT id FROM games WHERE id IN (${placeholders}) AND analyzed = 0 AND total_plies > 0 ORDER BY id ASC`
    )
    .all(...gameIds) as { id: number }[];
  return rows.map((r) => Number(r.id));
}

// ---------- Positions ----------

export function upsertPosition(p: Omit<PositionRow, "id">): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO positions (
      game_id, ply, color, fen, san, uci, fen_after, best_move, best_move_san,
      eval_before, mate_before, eval_after, mate_after, centipawn_loss,
      classification, motif, phase, clock_seconds, is_critical,
      explanation, key_lesson, drill_suggestion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(game_id, ply) DO UPDATE SET
      color=excluded.color, fen=excluded.fen, san=excluded.san, uci=excluded.uci,
      fen_after=excluded.fen_after, best_move=excluded.best_move,
      best_move_san=excluded.best_move_san, eval_before=excluded.eval_before,
      mate_before=excluded.mate_before, eval_after=excluded.eval_after,
      mate_after=excluded.mate_after, centipawn_loss=excluded.centipawn_loss,
      classification=excluded.classification, motif=excluded.motif,
      phase=excluded.phase, clock_seconds=excluded.clock_seconds,
      is_critical=excluded.is_critical, explanation=excluded.explanation,
      key_lesson=excluded.key_lesson, drill_suggestion=excluded.drill_suggestion`
  ).run(
    p.game_id,
    p.ply,
    p.color,
    p.fen,
    p.san,
    p.uci,
    p.fen_after,
    p.best_move,
    p.best_move_san,
    p.eval_before,
    p.mate_before,
    p.eval_after,
    p.mate_after,
    p.centipawn_loss,
    p.classification,
    p.motif,
    p.phase,
    p.clock_seconds,
    p.is_critical,
    p.explanation,
    p.key_lesson,
    p.drill_suggestion
  );
}

/**
 * Insert a freshly-parsed position only if it is not already stored. Existing
 * rows are left untouched, so re-importing repairs empty games without wiping
 * engine analysis.
 */
export function insertPositionIfMissing(
  p: Pick<
    PositionRow,
    "game_id" | "ply" | "color" | "fen" | "san" | "uci" | "fen_after" | "clock_seconds"
  >
): void {
  getDb()
    .prepare(
      `INSERT INTO positions (game_id, ply, color, fen, san, uci, fen_after, clock_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_id, ply) DO NOTHING`
    )
    .run(p.game_id, p.ply, p.color, p.fen, p.san, p.uci, p.fen_after, p.clock_seconds);
}

export function getPositions(gameId: number): PositionRow[] {
  return getDb()
    .prepare("SELECT * FROM positions WHERE game_id = ? ORDER BY ply ASC")
    .all(gameId)
    .map((r) => toPositionRow(r as Record<string, unknown>));
}

export function getPosition(gameId: number, ply: number): PositionRow | null {
  const r = getDb()
    .prepare("SELECT * FROM positions WHERE game_id = ? AND ply = ?")
    .get(gameId, ply);
  return r ? toPositionRow(r as Record<string, unknown>) : null;
}

export function deletePositions(gameId: number): void {
  getDb().prepare("DELETE FROM positions WHERE game_id = ?").run(gameId);
}

export function markGameAnalyzed(gameId: number, accuracy: number): void {
  getDb().prepare("UPDATE games SET analyzed = 1, accuracy = ? WHERE id = ?").run(accuracy, gameId);
}

// ---------- Engine cache ----------

export function getEngineCache(fen: string): { best_move: string; score_cp: number; mate: number | null; pv: string; depth: number } | null {
  const r = getDb().prepare("SELECT * FROM engine_cache WHERE fen = ?").get(fen) as
    | Record<string, unknown>
    | undefined;
  if (!r) return null;
  return {
    best_move: String(r.best_move ?? ""),
    score_cp: Number(r.score_cp ?? 0),
    mate: r.mate == null ? null : Number(r.mate),
    pv: String(r.pv ?? ""),
    depth: Number(r.depth ?? 0),
  };
}

export function setEngineCache(fen: string, best_move: string, score_cp: number, mate: number | null, pv: string, depth: number): void {
  getDb()
    .prepare(
      `INSERT INTO engine_cache (fen, best_move, score_cp, mate, pv, depth)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(fen) DO UPDATE SET
         best_move=excluded.best_move, score_cp=excluded.score_cp,
         mate=excluded.mate, pv=excluded.pv, depth=excluded.depth`
    )
    .run(fen, best_move, score_cp, mate, pv, depth);
}

// ---------- LLM cache ----------

export function getLlmCache(fen: string): { explanation: string; key_lesson: string; drill_suggestion: string } | null {
  const r = getDb().prepare("SELECT * FROM llm_cache WHERE fen = ?").get(fen) as
    | Record<string, unknown>
    | undefined;
  if (!r || r.explanation == null) return null;
  return {
    explanation: String(r.explanation),
    key_lesson: String(r.key_lesson ?? ""),
    drill_suggestion: String(r.drill_suggestion ?? ""),
  };
}

export function setLlmCache(fen: string, explanation: string, key_lesson: string, drill_suggestion: string, model: string): void {
  getDb()
    .prepare(
      `INSERT INTO llm_cache (fen, explanation, key_lesson, drill_suggestion, model)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(fen) DO UPDATE SET
         explanation=excluded.explanation, key_lesson=excluded.key_lesson,
         drill_suggestion=excluded.drill_suggestion, model=excluded.model`
    )
    .run(fen, explanation, key_lesson, drill_suggestion, model);
}

// ---------- Puzzles ----------

export function insertPuzzle(p: Omit<PuzzleRow, "id" | "ease" | "interval_days" | "repetitions" | "due_at" | "solved_count" | "fail_count" | "created_at">): number {
  const info = getDb()
    .prepare(
      `INSERT INTO puzzles (game_id, position_id, fen, solution_uci, solution_san, theme)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(p.game_id, p.position_id, p.fen, p.solution_uci, p.solution_san, p.theme);
  return Number(info.lastInsertRowid);
}

export function puzzleExists(fen: string, profileId: number): boolean {
  const r = getDb()
    .prepare(
      `SELECT 1 FROM puzzles z JOIN games g ON g.id = z.game_id
       WHERE z.fen = ? AND g.profile_id = ? LIMIT 1`
    )
    .get(fen, profileId);
  return !!r;
}

/** Scoped through the owning game, so puzzles never leak across profiles. */
export function listPuzzles(profileId: number): PuzzleRow[] {
  return getDb()
    .prepare(
      `SELECT z.* FROM puzzles z JOIN games g ON g.id = z.game_id
       WHERE g.profile_id = ?
       ORDER BY z.due_at IS NULL, z.due_at ASC, z.id ASC`
    )
    .all(profileId)
    .map((r) => toPuzzleRow(r as Record<string, unknown>));
}

export function countPuzzles(profileId: number): number {
  const r = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM puzzles z JOIN games g ON g.id = z.game_id WHERE g.profile_id = ?`
    )
    .get(profileId) as { n: number };
  return Number(r.n);
}

function toPuzzleRow(r: Record<string, unknown>): PuzzleRow {
  return {
    id: Number(r.id),
    game_id: Number(r.game_id),
    position_id: r.position_id == null ? null : Number(r.position_id),
    fen: String(r.fen ?? ""),
    solution_uci: String(r.solution_uci ?? ""),
    solution_san: String(r.solution_san ?? ""),
    theme: r.theme == null ? null : String(r.theme),
    ease: Number(r.ease ?? 2.5),
    interval_days: Number(r.interval_days ?? 0),
    repetitions: Number(r.repetitions ?? 0),
    due_at: r.due_at == null ? null : String(r.due_at),
    solved_count: Number(r.solved_count ?? 0),
    fail_count: Number(r.fail_count ?? 0),
    created_at: String(r.created_at ?? ""),
  };
}

export function updatePuzzleSrs(
  id: number,
  ease: number,
  intervalDays: number,
  repetitions: number,
  dueAt: string,
  solved: boolean
): void {
  getDb()
    .prepare(
      `UPDATE puzzles SET ease = ?, interval_days = ?, repetitions = ?, due_at = ?,
         solved_count = solved_count + ?, fail_count = fail_count + ? WHERE id = ?`
    )
    .run(ease, intervalDays, repetitions, dueAt, solved ? 1 : 0, solved ? 0 : 1, id);
}

// ---------- Opening reviews ----------

export interface OpeningReviewRow {
  eco: string;
  ease: number;
  interval_days: number;
  repetitions: number;
  due_at: string | null;
  clean_count: number;
  miss_count: number;
  last_reviewed_at: string | null;
}

export function listOpeningReviews(profileId: number): OpeningReviewRow[] {
  return getDb()
    .prepare("SELECT * FROM opening_reviews WHERE profile_id = ?")
    .all(profileId) as unknown as OpeningReviewRow[];
}

export function updateOpeningReview(
  profileId: number,
  eco: string,
  ease: number,
  intervalDays: number,
  repetitions: number,
  dueAt: string,
  clean: boolean
): void {
  getDb()
    .prepare(
      `INSERT INTO opening_reviews (profile_id, eco, ease, interval_days, repetitions, due_at, clean_count, miss_count, last_reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(profile_id, eco) DO UPDATE SET
         ease = excluded.ease,
         interval_days = excluded.interval_days,
         repetitions = excluded.repetitions,
         due_at = excluded.due_at,
         clean_count = opening_reviews.clean_count + excluded.clean_count,
         miss_count = opening_reviews.miss_count + excluded.miss_count,
         last_reviewed_at = datetime('now')`
    )
    .run(profileId, eco, ease, intervalDays, repetitions, dueAt, clean ? 1 : 0, clean ? 0 : 1);
}

// ---------- Profiles ----------

export interface Profile {
  id: number;
  lichess_username: string;
  chesscom_username: string;
  display_name: string;
  created_at: string;
  updated_at: string;
  /** Games imported for this profile. */
  games: number;
  analyzed: number;
  /**
   * Whether a Lichess token is stored — never the token. The API returns this
   * shape, so the secret cannot ride along by accident.
   */
  lichessTokenSet: boolean;
}

export interface ProfileInput {
  lichess_username?: string;
  chesscom_username?: string;
  display_name?: string;
}

const PROFILE_SELECT = `
  SELECT p.*,
    (SELECT COUNT(*) FROM games g WHERE g.profile_id = p.id) AS games,
    (SELECT COUNT(*) FROM games g WHERE g.profile_id = p.id AND g.analyzed = 1) AS analyzed,
    EXISTS(SELECT 1 FROM profile_secrets s WHERE s.profile_id = p.id AND s.lichess_token <> '') AS lichessTokenSet
  FROM profiles p`;

function toProfile(r: Record<string, unknown>): Profile {
  return {
    id: Number(r.id),
    lichess_username: r.lichess_username == null ? "" : String(r.lichess_username),
    chesscom_username: r.chesscom_username == null ? "" : String(r.chesscom_username),
    display_name: r.display_name == null ? "" : String(r.display_name),
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
    games: Number(r.games ?? 0),
    analyzed: Number(r.analyzed ?? 0),
    lichessTokenSet: Number(r.lichessTokenSet ?? 0) === 1,
  };
}

/** Every profile, oldest first, optionally filtered by a username substring. */
export function listProfiles(q?: string): Profile[] {
  const term = q?.trim().toLowerCase() ?? "";
  const rows = term
    ? getDb()
        .prepare(
          `${PROFILE_SELECT}
           WHERE lower(p.lichess_username) LIKE ?
              OR lower(p.chesscom_username) LIKE ?
              OR lower(p.display_name) LIKE ?
           ORDER BY p.id ASC`
        )
        .all(`%${term}%`, `%${term}%`, `%${term}%`)
    : getDb().prepare(`${PROFILE_SELECT} ORDER BY p.id ASC`).all();
  return (rows as Record<string, unknown>[]).map(toProfile);
}

export function getProfileById(id: number): Profile | null {
  const r = getDb().prepare(`${PROFILE_SELECT} WHERE p.id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return r ? toProfile(r) : null;
}

/** The lowest-numbered profile — the fallback when no valid choice is stored. */
export function getFirstProfileId(): number | null {
  const r = getDb().prepare("SELECT MIN(id) AS id FROM profiles").get() as
    | { id: number | null }
    | undefined;
  return r?.id == null ? null : Number(r.id);
}

export function createProfile(input: ProfileInput): number {
  const info = getDb()
    .prepare(
      `INSERT INTO profiles (lichess_username, chesscom_username, display_name)
       VALUES (?, ?, ?)`
    )
    .run(
      (input.lichess_username ?? "").trim(),
      (input.chesscom_username ?? "").trim(),
      (input.display_name ?? "").trim()
    );
  return Number(info.lastInsertRowid);
}

export function updateProfile(id: number, patch: ProfileInput): void {
  const current = getDb().prepare("SELECT * FROM profiles WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!current) return;
  const next = {
    lichess_username:
      patch.lichess_username !== undefined ? patch.lichess_username.trim() : String(current.lichess_username ?? ""),
    chesscom_username:
      patch.chesscom_username !== undefined ? patch.chesscom_username.trim() : String(current.chesscom_username ?? ""),
    display_name:
      patch.display_name !== undefined ? patch.display_name.trim() : String(current.display_name ?? ""),
  };
  getDb()
    .prepare(
      `UPDATE profiles
       SET lichess_username = ?, chesscom_username = ?, display_name = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(next.lichess_username, next.chesscom_username, next.display_name, id);
}

/** Removes a profile and everything it owns. Positions and puzzles hang off its
 *  games, so they are cleared first rather than left orphaned. */
export function deleteProfile(id: number): void {
  const db = getDb();
  db.prepare(
    "DELETE FROM positions WHERE game_id IN (SELECT id FROM games WHERE profile_id = ?)"
  ).run(id);
  db.prepare(
    "DELETE FROM puzzles WHERE game_id IN (SELECT id FROM games WHERE profile_id = ?)"
  ).run(id);
  db.prepare("DELETE FROM games WHERE profile_id = ?").run(id);
  db.prepare("DELETE FROM opening_reviews WHERE profile_id = ?").run(id);
  db.prepare("DELETE FROM profile_secrets WHERE profile_id = ?").run(id);
  db.prepare("DELETE FROM profiles WHERE id = ?").run(id);
}

/** Server-side only. Never expose the return value through an API response. */
export function getProfileToken(id: number): string {
  const r = getDb()
    .prepare("SELECT lichess_token FROM profile_secrets WHERE profile_id = ?")
    .get(id) as { lichess_token?: string | null } | undefined;
  return r?.lichess_token == null ? "" : String(r.lichess_token);
}

export function setProfileToken(id: number, token: string): void {
  const value = token.trim();
  if (!value) {
    getDb().prepare("DELETE FROM profile_secrets WHERE profile_id = ?").run(id);
    return;
  }
  getDb()
    .prepare(
      `INSERT INTO profile_secrets (profile_id, lichess_token, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(profile_id) DO UPDATE SET
         lichess_token = excluded.lichess_token, updated_at = excluded.updated_at`
    )
    .run(id, value);
}

// ---------- Settings (key/value) ----------

export function getSetting(key: string): string {
  const r = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | Record<string, unknown>
    | undefined;
  return r?.value == null ? "" : String(r.value);
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}
