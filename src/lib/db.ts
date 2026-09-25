import "server-only";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { positionKeyString, providerMeta, ratingBand, type AiExplanationKey } from "./llm-providers";
import type { Color, GameRow, LibraryGameRow, PositionRow } from "./types";

/**
 * The library is global; a person is not.
 *
 * `games` holds the chess — PGN, players, results — and `positions` holds the
 * engine's reading of it. Neither knows whose profile imported it. A game is
 * identified by `(source, external_id)`, so two people who played each other
 * share one row and one analysis.
 *
 * `library` is the only thing that ties a game to a person, and it is keyed by
 * **account** (`lichess:rooronoa`), not by a profile row: the browser owns the
 * profiles. That is what lets a second browser set up the same account and be
 * served the already-analysed games instead of re-importing and re-analysing
 * them.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL DEFAULT '',
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
  total_plies INTEGER NOT NULL DEFAULT 0,
  analyzed INTEGER NOT NULL DEFAULT 0,
  -- Accuracy is a property of a move, so it is stored per side; the library view
  -- picks the viewer's own.
  accuracy_white REAL,
  accuracy_black REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- One row per real game, whoever imported it. Re-importing from the other
  -- player's account links to this row instead of duplicating the analysis.
  UNIQUE(source, external_id)
);

-- Whose library a game sits in, and which side they had. The analysis itself is
-- never duplicated here.
CREATE TABLE IF NOT EXISTS library (
  scope TEXT NOT NULL,
  game_id INTEGER NOT NULL,
  player_color TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (scope, game_id)
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

-- The derived drill: which side blundered, and what the right move was.
CREATE TABLE IF NOT EXISTS puzzles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  position_id INTEGER,
  color TEXT NOT NULL DEFAULT 'w',
  fen TEXT NOT NULL,
  solution_uci TEXT NOT NULL,
  solution_san TEXT,
  theme TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Practising is personal even when the drill is shared, so the SM-2 state is
-- keyed by account: the same drill follows you between browsers.
CREATE TABLE IF NOT EXISTS puzzle_reviews (
  scope TEXT NOT NULL,
  puzzle_id INTEGER NOT NULL,
  ease REAL NOT NULL DEFAULT 2.5,
  interval_days REAL NOT NULL DEFAULT 0,
  repetitions INTEGER NOT NULL DEFAULT 0,
  due_at TEXT,
  solved_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, puzzle_id)
);

CREATE TABLE IF NOT EXISTS opening_reviews (
  scope TEXT NOT NULL,
  eco TEXT NOT NULL,
  ease REAL NOT NULL DEFAULT 2.5,
  interval_days REAL NOT NULL DEFAULT 0,
  repetitions INTEGER NOT NULL DEFAULT 0,
  due_at TEXT,
  clean_count INTEGER NOT NULL DEFAULT 0,
  miss_count INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (scope, eco)
);

-- AI-written coaching, one row per (position, provider, model).
--
-- This is deliberately NOT where the engine coach lives: positions.explanation
-- always holds the deterministic Stockfish-grounded text, so the baseline analysis
-- survives any AI run. Each row here is an extra, user-requested reading of the
-- same position, kept side by side so a user can compare what Claude said last
-- time with what GPT says now.
--
-- The key is the whole point. A FEN does not determine what was played from it,
-- nor who was playing, so a FEN-only cache served users explanations written
-- about somebody else's move. rating_band keeps the lesson calibrated to the
-- mover without making every rating a distinct row.
CREATE TABLE IF NOT EXISTS ai_explanations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fen TEXT NOT NULL,
  played_uci TEXT NOT NULL DEFAULT '',
  classification TEXT NOT NULL DEFAULT '',
  rating_band INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  explanation TEXT NOT NULL,
  key_lesson TEXT NOT NULL DEFAULT '',
  drill_suggestion TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(fen, played_uci, classification, rating_band, provider, model)
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
 * The view every read path goes through: the global game plus the viewer's seat
 * at it. It deliberately presents the old per-profile shape, so a query asks for
 * "my games, my colour, my accuracy" without re-deriving anything.
 */
const VIEWS = `
DROP VIEW IF EXISTS library_games;
CREATE VIEW library_games AS
SELECT
  g.id, g.source, g.external_id, g.pgn, g.white, g.black,
  g.white_rating, g.black_rating, g.result, g.time_control, g.speed,
  g.eco, g.opening_name, g.played_at, g.total_plies, g.analyzed,
  g.accuracy_white, g.accuracy_black, g.created_at,
  l.scope AS scope,
  l.player_color AS player_color,
  CASE WHEN l.player_color = 'w' THEN g.white_rating ELSE g.black_rating END AS player_rating,
  CASE WHEN l.player_color = 'w' THEN g.black ELSE g.white END AS opponent,
  CASE WHEN l.player_color = 'w' THEN g.black_rating ELSE g.white_rating END AS opponent_rating,
  CASE WHEN l.player_color = 'w' THEN g.accuracy_white ELSE g.accuracy_black END AS accuracy
FROM games g
JOIN library l ON l.game_id = g.id;
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
-- Linking an account scans by player name, so the name is the index.
CREATE INDEX IF NOT EXISTS idx_games_white ON games(source, lower(white));
CREATE INDEX IF NOT EXISTS idx_games_black ON games(source, lower(black));
CREATE INDEX IF NOT EXISTS idx_library_scope ON library(scope, game_id);
CREATE INDEX IF NOT EXISTS idx_library_game ON library(game_id);
CREATE INDEX IF NOT EXISTS idx_puzzles_game ON puzzles(game_id);
CREATE INDEX IF NOT EXISTS idx_puzzle_reviews_scope ON puzzle_reviews(scope);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, priority, id);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
CREATE INDEX IF NOT EXISTS idx_ai_explanations_position
  ON ai_explanations(fen, played_uci, classification, rating_band);
`;

// Reuse a single connection across hot reloads / route invocations.
const globalForDb = globalThis as unknown as { __chessdadDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  if (globalForDb.__chessdadDb) return globalForDb.__chessdadDb;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const db = new DatabaseSync(config.dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  // Wait for a lock instead of failing instantly. Without this, any second writer
  // — a CLI, a cron, a backup, another replica — gets SQLITE_BUSY ("database is
  // locked") the moment it touches a row the server is also writing, which is a
  // hard failure rather than a short wait. Verified by hitting it: a script
  // writing to llm_cache while the dev server was running died outright.
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  migrateLegacyQueue(db);
  migratePerProfileLibrary(db);
  // The FEN-keyed `llm_cache` is retired: the engine coach is deterministic and
  // needs no cache, and AI text now lives in `ai_explanations`. Carry the old
  // rows across before dropping the table so an existing library keeps its prose.
  migrateLlmCache(db);
  // The `import` job type is retired — imports run inside their own request now,
  // because that is the only place the caller's token exists. Any leftover row of
  // that type is meaningless, so it is dropped rather than failed.
  db.exec("DELETE FROM jobs WHERE type = 'import'");
  // The view reads columns the migration may have just created, so it is built
  // after it. Re-assert indexes: a rebuild above drops the old table's.
  db.exec(VIEWS);
  db.exec(INDEXES);
  globalForDb.__chessdadDb = db;
  return db;
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

function tableSql(db: DatabaseSync, name: string): string {
  return String(
    (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?").get(name) as
      | { sql?: string }
      | undefined)?.sql ?? ""
  );
}

function columns(db: DatabaseSync, name: string): string[] {
  return (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name);
}

/** `lichess:Rooronoa` — the account key a game is filed under. */
export function accountScope(source: string, username: string): string {
  return `${source}:${username.trim().toLowerCase()}`;
}

interface LegacyGame {
  id: number;
  /** Absent in the original single-user schema. */
  profile_id?: number;
  source: string;
  external_id: string;
  player_color: string;
  white: string;
  black: string;
  analyzed: number;
  accuracy: number | null;
}

interface LegacyPuzzle {
  id: number;
  game_id: number;
  position_id: number | null;
  fen: string;
  solution_uci: string;
  solution_san: string | null;
  theme: string | null;
  ease: number;
  interval_days: number;
  repetitions: number;
  due_at: string | null;
  solved_count: number;
  fail_count: number;
}

const OPENING_REVIEWS_DDL = `
  CREATE TABLE opening_reviews (
    scope TEXT NOT NULL,
    eco TEXT NOT NULL,
    ease REAL NOT NULL DEFAULT 2.5,
    interval_days REAL NOT NULL DEFAULT 0,
    repetitions INTEGER NOT NULL DEFAULT 0,
    due_at TEXT,
    clean_count INTEGER NOT NULL DEFAULT 0,
    miss_count INTEGER NOT NULL DEFAULT 0,
    last_reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (scope, eco)
  );
`;

/** id → primary account, for databases that still have a `profiles` table. */
function readProfileScopes(db: DatabaseSync): Map<number, string> {
  const map = new Map<number, string>();
  if (!tableSql(db, "profiles")) return map;
  for (const p of db
    .prepare("SELECT id, lichess_username, chesscom_username FROM profiles")
    .all() as { id: number; lichess_username: string | null; chesscom_username: string | null }[]) {
    if (p.lichess_username) map.set(Number(p.id), accountScope("lichess", p.lichess_username));
    else if (p.chesscom_username) map.set(Number(p.id), accountScope("chesscom", p.chesscom_username));
  }
  return map;
}

/** The account holding the most games — the closest thing to "the owner". */
function dominantScope(db: DatabaseSync): string | null {
  const r = db
    .prepare("SELECT scope FROM library GROUP BY scope ORDER BY COUNT(*) DESC, scope ASC LIMIT 1")
    .get() as { scope?: string } | undefined;
  return r?.scope ?? null;
}

/** Same choice, made over links that have not been written yet. */
function dominantScopeFrom(scopes: string[]): string | null {
  const counts = new Map<string, number>();
  for (const scope of scopes) counts.set(scope, (counts.get(scope) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [scope, count] of counts) {
    if (count > bestCount || (count === bestCount && best != null && scope < best)) {
      best = scope;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Fold the per-profile schema into the global library.
 *
 * Everything a profile owned was really a game someone played, filed under that
 * profile. The account name is already on the game row (`player_color` says which
 * seat was theirs), so the game is re-filed under that account and the profile
 * rows are dropped. Games that two profiles both imported collapse into one —
 * the copy with the most analysed positions wins, and the loser's duplicate
 * positions and puzzles are discarded. The original single-user schema (no
 * `profile_id` at all) takes the same path; it just has no profile map to fall
 * back on.
 *
 * Ids of the surviving games are preserved, so nothing else has to be rewritten.
 */
function migratePerProfileLibrary(db: DatabaseSync): void {
  const gameCols = columns(db, "games");
  const needsRebuild =
    gameCols.length > 0 && (gameCols.includes("profile_id") || !gameCols.includes("accuracy_white"));
  if (!needsRebuild) {
    migrateOpeningReviewScope(db, dominantScope(db));
    dropLegacyProfileTables(db);
    return;
  }

  const profileScope = readProfileScopes(db);

  const select = ["id", "source", "external_id", "player_color", "white", "black"];
  for (const column of ["profile_id", "analyzed", "accuracy"]) {
    if (gameCols.includes(column)) select.push(column);
  }
  const oldGames = db
    .prepare(`SELECT ${select.join(", ")} FROM games ORDER BY id ASC`)
    .all() as unknown as LegacyGame[];

  const classified = db.prepare(
    `SELECT SUM(CASE WHEN classification IS NOT NULL THEN 1 ELSE 0 END) AS classified,
            COUNT(*) AS total
     FROM positions WHERE game_id = ?`
  );

  const groups = new Map<string, LegacyGame[]>();
  for (const g of oldGames) {
    const key = `${g.source}\u0000${g.external_id ?? ""}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(g);
    else groups.set(key, [g]);
  }

  interface Winner {
    game: LegacyGame;
    accuracyWhite: number | null;
    accuracyBlack: number | null;
    links: { scope: string; color: Color }[];
  }

  const winners: Winner[] = [];
  const keptGameIds: number[] = [];
  const droppedGameIds: number[] = [];

  /**
   * Which account a legacy game belongs to. The seat record is the strongest
   * evidence — it is the account that imported the game — with the profiles table
   * as a fallback for rows whose player name is missing. Null means "not
   * attributable yet": those are resolved to the dominant account below.
   */
  const scopeOf = (g: LegacyGame): string | null => {
    const name = g.player_color === "w" ? g.white : g.black;
    if (name && name.trim()) return accountScope(g.source, name);
    if (g.profile_id != null) return profileScope.get(Number(g.profile_id)) ?? null;
    return null;
  };

  const deferred: { gameId: number; color: Color }[] = [];

  for (const members of groups.values()) {
    const ranked = [...members].sort((a, b) => {
      const ca = classified.get(a.id) as { classified: number | null; total: number } | undefined;
      const cb = classified.get(b.id) as { classified: number | null; total: number } | undefined;
      return (
        Number(cb?.classified ?? 0) - Number(ca?.classified ?? 0) ||
        Number(cb?.total ?? 0) - Number(ca?.total ?? 0) ||
        Number(b.analyzed ?? 0) - Number(a.analyzed ?? 0) ||
        a.id - b.id
      );
    });
    const winner = ranked[0];
    let accuracyWhite: number | null = null;
    let accuracyBlack: number | null = null;
    const links: { scope: string; color: Color }[] = [];
    for (const m of members) {
      const value = m.accuracy == null || Number(m.accuracy) < 0 ? null : Number(m.accuracy);
      if (value != null) {
        if (m.player_color === "w") accuracyWhite = accuracyWhite ?? value;
        else accuracyBlack = accuracyBlack ?? value;
      }
      const color: Color = m.player_color === "b" ? "b" : "w";
      const scope = scopeOf(m);
      if (scope) links.push({ scope, color });
      else deferred.push({ gameId: winner.id, color });
      if (m.id !== winner.id) droppedGameIds.push(m.id);
    }
    winners.push({ game: winner, accuracyWhite, accuracyBlack, links });
    keptGameIds.push(winner.id);
  }

  // The account that owns most of the library is the only sensible home for the
  // handful of rows that carry no player name at all.
  const owner =
    dominantScopeFrom(winners.flatMap((w) => w.links.map((l) => l.scope))) ?? "legacy:player";
  for (const d of deferred) {
    const winner = winners.find((w) => w.game.id === d.gameId);
    if (winner) winner.links.push({ scope: owner, color: d.color });
  }

  const oldPuzzles = tableSql(db, "puzzles")
    ? (db.prepare("SELECT * FROM puzzles").all() as unknown as LegacyPuzzle[])
    : [];
  const gameColor = new Map<number, string>(oldGames.map((g) => [Number(g.id), String(g.player_color)]));
  const legacyGame = new Map<number, LegacyGame>(oldGames.map((g) => [Number(g.id), g]));
  const linkScope = new Map<string, string>();
  for (const w of winners) {
    for (const l of w.links) linkScope.set(`${w.game.id}\u0000${l.color}`, l.scope);
  }
  const puzzleScope = (gameId: number, color: string): string => {
    const exact = linkScope.get(`${Number(gameId)}\u0000${color}`);
    if (exact) return exact;
    const g = legacyGame.get(Number(gameId));
    return (g && scopeOf(g)) || owner;
  };

  db.exec("BEGIN IMMEDIATE");
  try {
    // --- games + library -------------------------------------------------
    db.exec("ALTER TABLE games RENAME TO games_pre_library");
    db.exec(`
      CREATE TABLE games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        external_id TEXT NOT NULL DEFAULT '',
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
        total_plies INTEGER NOT NULL DEFAULT 0,
        analyzed INTEGER NOT NULL DEFAULT 0,
        accuracy_white REAL,
        accuracy_black REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(source, external_id)
      );
      CREATE TABLE IF NOT EXISTS library (
        scope TEXT NOT NULL,
        game_id INTEGER NOT NULL,
        player_color TEXT NOT NULL,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (scope, game_id)
      );
    `);

    const insertGame = db.prepare(
      `INSERT INTO games (id, source, external_id, pgn, white, black, white_rating, black_rating,
                          result, time_control, speed, eco, opening_name, played_at, total_plies,
                          analyzed, accuracy_white, accuracy_black, created_at)
       SELECT id, source, external_id, pgn, white, black, white_rating, black_rating,
              result, time_control, speed, eco, opening_name, played_at, total_plies,
              analyzed, ?, ?, created_at
       FROM games_pre_library WHERE id = ?`
    );
    const insertLink = db.prepare(
      "INSERT OR IGNORE INTO library (scope, game_id, player_color) VALUES (?, ?, ?)"
    );
    for (const w of winners) {
      insertGame.run(w.accuracyWhite, w.accuracyBlack, w.game.id);
      for (const link of w.links) insertLink.run(link.scope, w.game.id, link.color);
    }

    // Duplicate copies of a game brought their own positions across; the winner's
    // are the ones that survive.
    const dropPositions = db.prepare("DELETE FROM positions WHERE game_id = ?");
    for (const id of droppedGameIds) dropPositions.run(id);

    // --- puzzles + their schedule ---------------------------------------
    const survivingGame = new Set(keptGameIds);
    const puzzleRows = oldPuzzles.filter((p) => survivingGame.has(Number(p.game_id)));
    const seen = new Set<string>();
    const keptPuzzles: { p: LegacyPuzzle; color: string; scope: string }[] = [];
    for (const p of puzzleRows) {
      const color = gameColor.get(Number(p.game_id)) === "b" ? "b" : "w";
      const key = `${color}\u0000${p.fen}`;
      if (seen.has(key)) continue; // already rebuilt for another game
      seen.add(key);
      keptPuzzles.push({ p, color, scope: puzzleScope(Number(p.game_id), color) });
    }

    if (tableSql(db, "puzzles")) db.exec("DROP TABLE puzzles");
    db.exec(`
      CREATE TABLE puzzles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL,
        position_id INTEGER,
        color TEXT NOT NULL DEFAULT 'w',
        fen TEXT NOT NULL,
        solution_uci TEXT NOT NULL,
        solution_san TEXT,
        theme TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const insertPuzzle = db.prepare(
      `INSERT INTO puzzles (id, game_id, position_id, color, fen, solution_uci, solution_san, theme, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    );
    const insertReview = db.prepare(
      `INSERT OR REPLACE INTO puzzle_reviews
         (scope, puzzle_id, ease, interval_days, repetitions, due_at, solved_count, fail_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const { p, color, scope } of keptPuzzles) {
      insertPuzzle.run(
        p.id,
        p.game_id,
        p.position_id,
        color,
        p.fen,
        p.solution_uci,
        p.solution_san,
        p.theme
      );
      insertReview.run(
        scope,
        p.id,
        Number(p.ease ?? 2.5),
        Number(p.interval_days ?? 0),
        Number(p.repetitions ?? 0),
        p.due_at ?? null,
        Number(p.solved_count ?? 0),
        Number(p.fail_count ?? 0)
      );
    }

    // --- opening reviews -------------------------------------------------
    migrateOpeningReviewScope(db, owner);

    // Jobs are ephemeral and some carry the retired profileId; drop the finished
    // ones and let anything still queued fail rather than run against stale ids.
    db.exec("DELETE FROM jobs WHERE status IN ('done','canceled','failed')");
    db.exec("UPDATE jobs SET max_attempts = 0 WHERE status IN ('queued','running')");

    db.exec("DROP TABLE games_pre_library");
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  dropLegacyProfileTables(db);
}

/**
 * Move an opening schedule onto account scopes.
 *
 * The multi-profile era keyed it `(profile_id, eco)`, which maps straight through
 * the profiles table. The original single-user schema had one global schedule and
 * no person attached to it, so it is awarded to the account that owns most of the
 * library — the person who was using the app.
 */
function migrateOpeningReviewScope(db: DatabaseSync, owner: string | null): void {
  const reviewCols = columns(db, "opening_reviews");
  if (reviewCols.length === 0 || reviewCols.includes("scope")) return;

  const profileScope = readProfileScopes(db);
  const oldReviews = db.prepare("SELECT * FROM opening_reviews").all() as unknown as Record<
    string,
    unknown
  >[];

  db.exec("DROP TABLE opening_reviews");
  db.exec(OPENING_REVIEWS_DDL);
  const insertReview = db.prepare(
    `INSERT OR REPLACE INTO opening_reviews
       (scope, eco, ease, interval_days, repetitions, due_at, clean_count, miss_count, last_reviewed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of oldReviews) {
    const scope = profileScope.get(Number(r.profile_id)) ?? owner;
    if (!scope) continue;
    insertReview.run(
      scope,
      String(r.eco ?? ""),
      Number(r.ease ?? 2.5),
      Number(r.interval_days ?? 0),
      Number(r.repetitions ?? 0),
      r.due_at == null ? null : String(r.due_at),
      Number(r.clean_count ?? 0),
      Number(r.miss_count ?? 0),
      r.last_reviewed_at == null ? null : String(r.last_reviewed_at),
      String(r.created_at ?? new Date().toISOString())
    );
  }
}

/** Profiles and their secrets now live in the browser, not in a shared table. */
function dropLegacyProfileTables(db: DatabaseSync): void {
  for (const name of ["profiles", "profile_secrets", "games_pre_library", "opening_reviews_pre_library"]) {
    if (tableSql(db, name)) db.exec(`DROP TABLE ${name}`);
  }
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

/**
 * Carry the retired FEN-keyed `llm_cache` into `ai_explanations`, then drop it.
 *
 * The old table stored the provider id in its `model` column and keyed on FEN
 * alone. Rows tagged `off` are the deterministic coach and are recomputable, so
 * they are simply discarded; AI rows are re-filed against the position they were
 * generated from (matched by FEN) so they remain viewable as a previous analysis.
 * A failure here is non-fatal: the text also lives denormalised on `positions`,
 * and the table is a cache.
 */
function migrateLlmCache(db: DatabaseSync): void {
  if (!tableSql(db, "llm_cache")) return;
  try {
    const cols = columns(db, "llm_cache");
    if (!cols.includes("fen") || !cols.includes("explanation")) {
      db.exec("DROP TABLE llm_cache");
      return;
    }
    const rows = db.prepare("SELECT * FROM llm_cache").all() as Record<string, unknown>[];
    if (rows.length > 0) {
      const insert = db.prepare(
        `INSERT OR IGNORE INTO ai_explanations
           (fen, played_uci, classification, rating_band, provider, model,
            explanation, key_lesson, drill_suggestion, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const findPosition = db.prepare(
        `SELECT p.uci, p.classification, p.color, g.white_rating, g.black_rating
           FROM positions p JOIN games g ON g.id = p.game_id
          WHERE p.fen = ? LIMIT 1`
      );
      for (const row of rows) {
        const explanation = String(row.explanation ?? "").trim();
        const stored = String(row.model ?? "").trim();
        if (!explanation || stored === "off") continue;
        const meta = providerMeta(stored);
        const provider = meta?.id ?? "deepseek";
        const model = meta?.defaultModel || stored;
        const pos = findPosition.get(String(row.fen ?? "")) as
          | {
              uci?: string | null;
              classification?: string | null;
              color?: string | null;
              white_rating?: number | null;
              black_rating?: number | null;
            }
          | undefined;
        const rating = pos ? (pos.color === "w" ? pos.white_rating : pos.black_rating) ?? 1200 : 1200;
        insert.run(
          String(row.fen ?? ""),
          pos?.uci ?? "",
          pos?.classification ?? "",
          ratingBand(rating),
          provider,
          model,
          explanation,
          String(row.key_lesson ?? ""),
          String(row.drill_suggestion ?? ""),
          String(row.created_at ?? new Date().toISOString())
        );
      }
    }
    db.exec("DROP TABLE llm_cache");
  } catch {
    // Non-fatal see above.
  }
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function toGameRow(r: Record<string, unknown>): GameRow {
  return {
    id: Number(r.id),
    source: r.source as GameRow["source"],
    external_id: r.external_id == null ? null : String(r.external_id),
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
    total_plies: Number(r.total_plies ?? 0),
    analyzed: Number(r.analyzed ?? 0),
    accuracy_white: r.accuracy_white == null ? null : Number(r.accuracy_white),
    accuracy_black: r.accuracy_black == null ? null : Number(r.accuracy_black),
    created_at: String(r.created_at ?? ""),
  };
}

/** A game seen from one account's seat. */
function toLibraryGameRow(r: Record<string, unknown>): LibraryGameRow {
  const accuracy = r.accuracy == null ? null : Number(r.accuracy);
  return {
    ...toGameRow(r),
    scope: String(r.scope ?? ""),
    player_color: (r.player_color as Color) ?? "w",
    player_rating: r.player_rating == null ? null : Number(r.player_rating),
    opponent: String(r.opponent ?? ""),
    opponent_rating: r.opponent_rating == null ? null : Number(r.opponent_rating),
    accuracy: accuracy != null && accuracy < 0 ? null : accuracy,
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

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export interface NewGame {
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
  total_plies: number;
}

/** Store the chess. Analysis already attached to the same game row is kept. */
export function upsertGame(g: NewGame): number {
  const db = getDb();
  db.prepare(
    `INSERT INTO games (
      source, external_id, pgn, white, black, white_rating, black_rating,
      result, time_control, speed, eco, opening_name, played_at, total_plies
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, external_id) DO UPDATE SET
      pgn=excluded.pgn, white=excluded.white, black=excluded.black,
      white_rating=excluded.white_rating, black_rating=excluded.black_rating,
      result=excluded.result, time_control=excluded.time_control,
      speed=excluded.speed, eco=excluded.eco, opening_name=excluded.opening_name,
      played_at=excluded.played_at, total_plies=excluded.total_plies`
  ).run(
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
    g.total_plies
  );

  // With ON CONFLICT DO UPDATE the insert reports an unreliable rowid, so re-select.
  const row = db
    .prepare("SELECT id FROM games WHERE source = ? AND external_id = ?")
    .get(g.source, g.external_id ?? "") as { id: number } | undefined;
  return Number(row?.id ?? 0);
}

/** File a game in an account's library, as the side that account played. */
export function linkGame(scope: string, gameId: number, playerColor: Color): boolean {
  const info = getDb()
    .prepare("INSERT OR IGNORE INTO library (scope, game_id, player_color) VALUES (?, ?, ?)")
    .run(scope, gameId, playerColor);
  // False means this account already held the game — which is how an import can
  // report "already in your library" without a second query.
  return Number(info.changes) > 0;
}

/**
 * Attach every game already stored that this account appears in.
 *
 * This is what makes a second browser instant: the games and their analysis
 * already exist, so the new profile only needs the link — no fetch from Lichess,
 * no engine run. Idempotent, so it is safe to call on any read.
 */
export function linkAccountGames(scope: string, source: string, username: string): number {
  const name = username.trim().toLowerCase();
  if (!name) return 0;
  const info = getDb()
    .prepare(
      `INSERT OR IGNORE INTO library (scope, game_id, player_color)
       SELECT ?, id, CASE WHEN lower(white) = ? THEN 'w' ELSE 'b' END
       FROM games
       WHERE source = ? AND (lower(white) = ? OR lower(black) = ?)`
    )
    .run(scope, name, source, name, name);
  return Number(info.changes);
}

export function countLibraryGames(scopes: string[]): number {
  if (scopes.length === 0) return 0;
  const placeholders = scopes.map(() => "?").join(",");
  const r = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM library WHERE scope IN (${placeholders})`)
    .get(...scopes) as { n: number };
  return Number(r.n);
}

/** Every account whose library holds this game — usually one, sometimes two. */
export function listGameScopes(gameId: number): string[] {
  return (
    getDb().prepare("SELECT scope FROM library WHERE game_id = ?").all(gameId) as {
      scope: string;
    }[]
  ).map((r) => String(r.scope));
}

/** The raw game, with no perspective — engine work does not need one. */
export function getGame(id: number): GameRow | null {
  const r = getDb().prepare("SELECT * FROM games WHERE id = ?").get(id);
  return r ? toGameRow(r as Record<string, unknown>) : null;
}

/** The game as one of these accounts saw it, or null if it is not in their library. */
export function getLibraryGame(id: number, scopes: string[]): LibraryGameRow | null {
  if (scopes.length === 0) return null;
  const placeholders = scopes.map(() => "?").join(",");
  const r = getDb()
    .prepare(`SELECT * FROM library_games WHERE id = ? AND scope IN (${placeholders}) LIMIT 1`)
    .get(id, ...scopes);
  return r ? toLibraryGameRow(r as Record<string, unknown>) : null;
}

/**
 * Remove a game from the viewer's library. The analysis is only deleted once no
 * other account references the game — deleting your copy must not delete
 * everyone else's.
 */
export function unlinkGame(id: number, scopes: string[]): void {
  const db = getDb();
  if (scopes.length === 0) return;
  const placeholders = scopes.map(() => "?").join(",");
  db.prepare(`DELETE FROM library WHERE game_id = ? AND scope IN (${placeholders})`).run(
    id,
    ...scopes
  );
  const remaining = db
    .prepare("SELECT COUNT(*) AS n FROM library WHERE game_id = ?")
    .get(id) as { n: number };
  if (Number(remaining.n) > 0) return;

  db.prepare(
    "DELETE FROM puzzle_reviews WHERE puzzle_id IN (SELECT id FROM puzzles WHERE game_id = ?)"
  ).run(id);
  db.prepare("DELETE FROM puzzles WHERE game_id = ?").run(id);
  db.prepare("DELETE FROM positions WHERE game_id = ?").run(id);
  db.prepare("DELETE FROM games WHERE id = ?").run(id);
}

export interface GameQuery {
  /** The acting account scopes. Games outside them are never returned. */
  scopes: string[];
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
  games: LibraryGameRow[];
  total: number;
  analyzed: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** Paginated, searchable, filterable view of one account's library. */
export function queryGames(query: GameQuery): GameQueryResult {
  const db = getDb();
  if (query.scopes.length === 0) {
    return { games: [], total: 0, analyzed: 0, page: 1, pageSize: 50, pageCount: 1 };
  }

  const where: string[] = [`scope IN (${query.scopes.map(() => "?").join(",")})`];
  const params: (string | number)[] = [...query.scopes];

  if (query.q && query.q.trim()) {
    // `%` and `_` are LIKE wildcards, so a search for "50%" would otherwise match
    // far more than the user typed. Escape them and tell SQLite which escape char.
    const escaped = query.q.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
    const like = `%${escaped}%`;
    where.push(
      `(lower(white) LIKE ? ESCAPE '\\' OR lower(black) LIKE ? ESCAPE '\\'
        OR lower(opponent) LIKE ? ESCAPE '\\'
        OR lower(opening_name) LIKE ? ESCAPE '\\' OR lower(eco) LIKE ? ESCAPE '\\')`
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

  const whereSql = `WHERE ${where.join(" AND ")}`;

  const counts = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN analyzed=1 THEN 1 ELSE 0 END) AS analyzed
       FROM library_games ${whereSql}`
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
       FROM library_games g ${whereSql}
       ORDER BY g.played_at DESC, g.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset) as Record<string, unknown>[];

  return {
    games: rows.map(toLibraryGameRow),
    total,
    analyzed,
    page,
    pageSize,
    pageCount,
  };
}

export interface LibraryCounts {
  games: number;
  analyzed: number;
}

/** Library totals for the acting accounts — used by the profile picker. */
export function libraryCounts(scopes: string[]): LibraryCounts {
  if (scopes.length === 0) return { games: 0, analyzed: 0 };
  const placeholders = scopes.map(() => "?").join(",");
  const r = getDb()
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN analyzed=1 THEN 1 ELSE 0 END) AS analyzed
       FROM library_games WHERE scope IN (${placeholders})`
    )
    .get(...scopes) as Record<string, unknown>;
  return { games: Number(r?.total ?? 0), analyzed: Number(r?.analyzed ?? 0) };
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

/** Accuracy is recorded per side, because the game no longer belongs to one player. */
export function markGameAnalyzed(
  gameId: number,
  accuracy: { white: number | null; black: number | null }
): void {
  getDb()
    .prepare("UPDATE games SET analyzed = 1, accuracy_white = ?, accuracy_black = ? WHERE id = ?")
    .run(accuracy.white, accuracy.black, gameId);
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

// ---------- AI explanations ----------

/**
 * One AI-written reading of one position by one provider/model. Several may
 * exist per position — that is the feature: a user can compare Claude's reading
 * with GPT's.
 */
export interface AiExplanationRow {
  id: number;
  fen: string;
  played_uci: string;
  classification: string;
  rating_band: number;
  provider: string;
  model: string;
  explanation: string;
  key_lesson: string;
  drill_suggestion: string;
  created_at: string;
}

function toAiExplanationRow(r: Record<string, unknown>): AiExplanationRow {
  return {
    id: Number(r.id ?? 0),
    fen: String(r.fen ?? ""),
    played_uci: String(r.played_uci ?? ""),
    classification: String(r.classification ?? ""),
    rating_band: Number(r.rating_band ?? 0),
    provider: String(r.provider ?? ""),
    model: String(r.model ?? ""),
    explanation: String(r.explanation ?? ""),
    key_lesson: String(r.key_lesson ?? ""),
    drill_suggestion: String(r.drill_suggestion ?? ""),
    created_at: String(r.created_at ?? ""),
  };
}

/** An exact provider+model hit. Asking the same model twice never pays twice. */
export function getAiExplanation(
  key: AiExplanationKey,
  provider: string,
  model: string
): AiExplanationRow | null {
  const r = getDb()
    .prepare(
      `SELECT * FROM ai_explanations
        WHERE fen = ? AND played_uci = ? AND classification = ? AND rating_band = ?
          AND provider = ? AND model = ?
        LIMIT 1`
    )
    .get(key.fen, key.playedUci, key.classification, key.ratingBand, provider, model) as
    | Record<string, unknown>
    | undefined;
  return r ? toAiExplanationRow(r) : null;
}

export function setAiExplanation(row: Omit<AiExplanationRow, "id" | "created_at">): void {
  getDb()
    .prepare(
      `INSERT INTO ai_explanations
         (fen, played_uci, classification, rating_band, provider, model,
          explanation, key_lesson, drill_suggestion)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(fen, played_uci, classification, rating_band, provider, model)
       DO UPDATE SET
         explanation=excluded.explanation, key_lesson=excluded.key_lesson,
         drill_suggestion=excluded.drill_suggestion, created_at=datetime('now')`
    )
    .run(
      row.fen,
      row.played_uci,
      row.classification,
      row.rating_band,
      row.provider,
      row.model,
      row.explanation,
      row.key_lesson,
      row.drill_suggestion
    );
}

/**
 * Every AI reading of the given FENs, newest first.
 *
 * The review screen has to show a position's whole AI history (this is how a user
 * sees what Claude said before they asked GPT), so it fetches by the game's FENs
 * in one query and groups in memory. FENs are chunked to stay well under SQLite's
 * bound-parameter limit for a very long game.
 */
export function listAiExplanationsForFens(fens: string[]): AiExplanationRow[] {
  const unique = [...new Set(fens.filter(Boolean))];
  if (unique.length === 0) return [];
  const out: AiExplanationRow[] = [];
  const CHUNK = 400;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const placeholders = slice.map(() => "?").join(",");
    const rows = getDb()
      .prepare(
        `SELECT * FROM ai_explanations WHERE fen IN (${placeholders})
          ORDER BY created_at DESC, id DESC`
      )
      .all(...slice) as Record<string, unknown>[];
    for (const r of rows) out.push(toAiExplanationRow(r));
  }
  return out;
}

/** Group rows by their position key, preserving the newest-first order. */
export function groupAiExplanations(rows: AiExplanationRow[]): Map<string, AiExplanationRow[]> {
  const map = new Map<string, AiExplanationRow[]>();
  for (const row of rows) {
    const key = positionKeyString({
      fen: row.fen,
      playedUci: row.played_uci,
      classification: row.classification,
      ratingBand: row.rating_band,
    });
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

// ---------- Puzzles ----------

export interface NewPuzzle {
  game_id: number;
  position_id: number | null;
  color: Color;
  fen: string;
  solution_uci: string;
  solution_san: string;
  theme: string | null;
}

export function insertPuzzle(p: NewPuzzle): number {
  const info = getDb()
    .prepare(
      `INSERT INTO puzzles (game_id, position_id, color, fen, solution_uci, solution_san, theme)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(p.game_id, p.position_id, p.color, p.fen, p.solution_uci, p.solution_san, p.theme);
  return Number(info.lastInsertRowid);
}

/**
 * Whether this drill already exists. Deduplicated against the whole library, not
 * one player's slice: the position and its solution do not depend on who is
 * looking at them.
 */
export function puzzleExists(fen: string, color: Color): boolean {
  const r = getDb()
    .prepare("SELECT 1 FROM puzzles WHERE fen = ? AND color = ? LIMIT 1")
    .get(fen, color);
  return !!r;
}

export interface PuzzleReviewRow {
  ease: number;
  interval_days: number;
  repetitions: number;
  due_at: string | null;
  solved_count: number;
  fail_count: number;
}

/** The practising state for one drill, defaulted when it has never been seen. */
export function getPuzzleReview(scope: string, puzzleId: number): PuzzleReviewRow {
  const r = getDb()
    .prepare("SELECT * FROM puzzle_reviews WHERE scope = ? AND puzzle_id = ?")
    .get(scope, puzzleId) as Record<string, unknown> | undefined;
  return {
    ease: r?.ease == null ? 2.5 : Number(r.ease),
    interval_days: r?.interval_days == null ? 0 : Number(r.interval_days),
    repetitions: r?.repetitions == null ? 0 : Number(r.repetitions),
    due_at: r?.due_at == null ? null : String(r.due_at),
    solved_count: r?.solved_count == null ? 0 : Number(r.solved_count),
    fail_count: r?.fail_count == null ? 0 : Number(r.fail_count),
  };
}

export function upsertPuzzleReview(
  scope: string,
  puzzleId: number,
  ease: number,
  intervalDays: number,
  repetitions: number,
  dueAt: string,
  solved: boolean
): void {
  getDb()
    .prepare(
      `INSERT INTO puzzle_reviews
         (scope, puzzle_id, ease, interval_days, repetitions, due_at, solved_count, fail_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope, puzzle_id) DO UPDATE SET
         ease = excluded.ease,
         interval_days = excluded.interval_days,
         repetitions = excluded.repetitions,
         due_at = excluded.due_at,
         solved_count = puzzle_reviews.solved_count + excluded.solved_count,
         fail_count = puzzle_reviews.fail_count + excluded.fail_count`
    )
    .run(scope, puzzleId, ease, intervalDays, repetitions, dueAt, solved ? 1 : 0, solved ? 0 : 1);
}

/**
 * Which of the viewer's accounts a drill belongs to — the account that played
 * the side the mistake was made on. The schedule is filed there so it follows
 * the account rather than the browser.
 */
export function puzzleScopeFor(scopes: string[], puzzleId: number): string {
  if (scopes.length === 0) return "";
  const placeholders = scopes.map(() => "?").join(",");
  const r = getDb()
    .prepare(
      `SELECT lg.scope FROM puzzles z
       JOIN library_games lg ON lg.id = z.game_id AND lg.player_color = z.color
       WHERE z.id = ? AND lg.scope IN (${placeholders})
       LIMIT 1`
    )
    .get(puzzleId, ...scopes) as { scope?: string } | undefined;
  return r?.scope ?? scopes[0] ?? "";
}

// ---------- Opening reviews ----------

export interface OpeningReviewRow {
  scope: string;
  eco: string;
  ease: number;
  interval_days: number;
  repetitions: number;
  due_at: string | null;
  clean_count: number;
  miss_count: number;
  last_reviewed_at: string | null;
}

export function listOpeningReviews(scopes: string[]): OpeningReviewRow[] {
  if (scopes.length === 0) return [];
  const placeholders = scopes.map(() => "?").join(",");
  return getDb()
    .prepare(`SELECT * FROM opening_reviews WHERE scope IN (${placeholders})`)
    .all(...scopes) as unknown as OpeningReviewRow[];
}

export function updateOpeningReview(
  scope: string,
  eco: string,
  ease: number,
  intervalDays: number,
  repetitions: number,
  dueAt: string,
  clean: boolean
): void {
  getDb()
    .prepare(
      `INSERT INTO opening_reviews (scope, eco, ease, interval_days, repetitions, due_at, clean_count, miss_count, last_reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(scope, eco) DO UPDATE SET
         ease = excluded.ease,
         interval_days = excluded.interval_days,
         repetitions = excluded.repetitions,
         due_at = excluded.due_at,
         clean_count = opening_reviews.clean_count + excluded.clean_count,
         miss_count = opening_reviews.miss_count + excluded.miss_count,
         last_reviewed_at = datetime('now')`
    )
    .run(scope, eco, ease, intervalDays, repetitions, dueAt, clean ? 1 : 0, clean ? 0 : 1);
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
