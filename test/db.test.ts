/**
 * The SQLite persistence layer.
 *
 * These tests run against the real `node:sqlite` engine on a throwaway file, so
 * they exercise the actual schema, view and upserts rather than a mock. The
 * theme running through them is the library's central promise: a game (and its
 * engine analysis) exists once, and is *shared* between the accounts that played
 * it — so re-importing must repair rather than duplicate, and unlinking one
 * person's copy must never destroy the other's.
 *
 * One getDb() connection is cached per process, so this file owns exactly one
 * temporary database for its lifetime.
 */
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createTempDatabase, removeTempDatabase, loadDb } from "./helpers/db";

const tmp = createTempDatabase("db");
const db = await loadDb();

// Types are derived from the module itself, so this file needs no runtime import
// of the source (which must not happen before the temp database path is set).
type Db = typeof db;
type NewGame = Parameters<Db["upsertGame"]>[0];
type PositionInput = Parameters<Db["upsertPosition"]>[0];
type GameQuery = Parameters<Db["queryGames"]>[0];
type GameQueryResult = ReturnType<Db["queryGames"]>;
type Color = PositionInput["color"];

const conn = () => db.getDb();

function count(table: string): number {
  const row = conn().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/** Every table a test may write to, cleared between tests so they stay isolated. */
const TABLES = [
  "jobs",
  "engine_cache",
  "ai_explanations",
  "puzzle_reviews",
  "puzzles",
  "positions",
  "library",
  "games",
  "opening_reviews",
  "settings",
];

beforeEach(() => {
  for (const table of TABLES) conn().exec(`DELETE FROM ${table}`);
});

after(() => removeTempDatabase(tmp.dir));

let seq = 0;

const GAME_DEFAULTS: NewGame = {
  source: "lichess",
  external_id: null,
  pgn: "1. e4 e5",
  white: "White Player",
  black: "Black Player",
  white_rating: null,
  black_rating: null,
  result: "*",
  time_control: "300+0",
  speed: "blitz",
  eco: "",
  opening_name: "",
  played_at: null,
  total_plies: 0,
};

/** Insert a game with readable defaults; every field can be overridden. */
function newGame(overrides: Partial<NewGame> = {}): number {
  seq += 1;
  const game: NewGame = Object.assign({}, GAME_DEFAULTS, { external_id: `g${seq}` }, overrides);
  return db.upsertGame(game);
}

/** A complete position row; overrides carry the fields a test cares about. */
function position(
  gameId: number,
  ply: number,
  color: Color,
  overrides: Partial<PositionInput> = {}
): PositionInput {
  const base: PositionInput = {
    game_id: gameId,
    ply,
    color,
    fen: `fen-${gameId}-${ply}`,
    san: null,
    uci: null,
    fen_after: `fen-after-${gameId}-${ply}`,
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
    clock_seconds: null,
    is_critical: 0,
    explanation: null,
    key_lesson: null,
    drill_suggestion: null,
  };
  return Object.assign(base, overrides);
}

// ---------------------------------------------------------------------------
// upsertGame
// ---------------------------------------------------------------------------

describe("upsertGame", () => {
  test("re-importing the same (source, external_id) updates in place and returns the same id", () => {
    const first = newGame({ external_id: "abc", white: "Alice", black: "Bob", result: "1-0" });
    const second = newGame({
      external_id: "abc",
      white: "Alice",
      black: "Bob",
      result: "0-1",
      white_rating: 2100,
      total_plies: 42,
      opening_name: "Italian Game",
    });

    assert.equal(second, first, "the id must be stable across a re-import");
    assert.equal(count("games"), 1, "a re-import must not duplicate the row");

    const game = db.getGame(first)!;
    assert.equal(game.result, "0-1");
    assert.equal(game.white_rating, 2100);
    assert.equal(game.total_plies, 42);
    assert.equal(game.opening_name, "Italian Game");
    // The insert's rowid is unreliable on the DO UPDATE path, so this is really
    // proving the re-select resolves to the original row.
    assert.equal(game.pgn, "1. e4 e5");
  });

  test("a different external_id is a different game", () => {
    const a = newGame({ external_id: "a" });
    const b = newGame({ external_id: "b" });
    assert.notEqual(a, b);
    assert.equal(count("games"), 2);
  });

  test("the same external_id under another source is a different game", () => {
    const lichessId = newGame({ source: "lichess", external_id: "x" });
    const chesscomId = newGame({ source: "chesscom", external_id: "x" });
    assert.notEqual(lichessId, chesscomId);
    assert.equal(count("games"), 2);
  });

  test("a re-import keeps the analysis already attached to the row", () => {
    const id = newGame({ external_id: "keep", total_plies: 10 });
    db.markGameAnalyzed(id, { white: 91, black: 82.5 });
    db.upsertPosition(position(id, 2, "w", { classification: "blunder", centipawn_loss: 400 }));

    newGame({ external_id: "keep", total_plies: 12, pgn: "1. d4 d5" });

    const game = db.getGame(id)!;
    assert.equal(game.analyzed, 1, "re-import must not clear the analyzed flag");
    assert.equal(game.accuracy_white, 91);
    assert.equal(game.accuracy_black, 82.5);
    assert.equal(db.getPosition(id, 2)!.classification, "blunder");
  });
});

// ---------------------------------------------------------------------------
// Linking
// ---------------------------------------------------------------------------

describe("linkGame", () => {
  test("the first link reports true, a repeat reports false and writes no second row", () => {
    const id = newGame();
    assert.equal(db.linkGame("lichess:alice", id, "w"), true);
    assert.equal(db.linkGame("lichess:alice", id, "w"), false);
    assert.equal(count("library"), 1);
  });

  test("a second link with a different colour is ignored, not overwritten", () => {
    const id = newGame();
    db.linkGame("lichess:alice", id, "w");
    assert.equal(db.linkGame("lichess:alice", id, "b"), false);
    assert.equal(db.getLibraryGame(id, ["lichess:alice"])!.player_color, "w");
  });

  test("a second account is a separate link onto the same game row", () => {
    const id = newGame();
    db.linkGame("lichess:alice", id, "w");
    assert.equal(db.linkGame("lichess:bob", id, "b"), true);
    assert.equal(count("games"), 1, "the shared game must not be copied per account");
    assert.deepEqual(db.listGameScopes(id).sort(), ["lichess:alice", "lichess:bob"]);
  });
});

describe("linkAccountGames", () => {
  test("attaches every game the account appears in, as the correct colour", () => {
    const asWhite = newGame({ source: "lichess", white: "Alice", black: "Bob" });
    const asBlack = newGame({ source: "lichess", white: "Carol", black: "ALICE" });
    const otherSource = newGame({ source: "chesscom", white: "Alice", black: "Bob" });
    const unrelated = newGame({ source: "lichess", white: "Erin", black: "Frank" });

    assert.equal(db.linkAccountGames("lichess:alice", "lichess", "Alice"), 2);
    assert.equal(db.getLibraryGame(asWhite, ["lichess:alice"])!.player_color, "w");
    assert.equal(db.getLibraryGame(asBlack, ["lichess:alice"])!.player_color, "b");
    assert.equal(db.getLibraryGame(otherSource, ["lichess:alice"]), null);
    assert.equal(db.getLibraryGame(unrelated, ["lichess:alice"]), null);
  });

  test("is idempotent — a second pass attaches nothing", () => {
    newGame({ source: "lichess", white: "Alice", black: "Bob" });
    assert.equal(db.linkAccountGames("lichess:alice", "lichess", "Alice"), 1);
    assert.equal(db.linkAccountGames("lichess:alice", "lichess", "Alice"), 0);
    assert.equal(db.countLibraryGames(["lichess:alice"]), 1);
  });

  test("trims and case-folds the username; a blank name links nothing", () => {
    newGame({ source: "lichess", white: "alice", black: "Bob" });
    assert.equal(db.linkAccountGames("lichess:alice", "lichess", "  ALICE "), 1);
    assert.equal(db.linkAccountGames("lichess:empty", "lichess", "   "), 0);
    assert.equal(db.countLibraryGames(["lichess:empty"]), 0);
  });
});

describe("library aggregates", () => {
  test("countLibraryGames counts links, libraryCounts splits analyzed out", () => {
    const analyzed = newGame();
    db.markGameAnalyzed(analyzed, { white: 90, black: 80 });
    const pending = newGame();
    db.linkGame("scope:a", analyzed, "w");
    db.linkGame("scope:a", pending, "w");
    db.linkGame("scope:b", analyzed, "b");

    assert.equal(db.countLibraryGames(["scope:a"]), 2);
    assert.equal(db.countLibraryGames(["scope:a", "scope:b"]), 3);
    assert.equal(db.countLibraryGames([]), 0);

    assert.deepEqual(db.libraryCounts(["scope:a"]), { games: 2, analyzed: 1 });
    assert.deepEqual(db.libraryCounts(["scope:b"]), { games: 1, analyzed: 1 });
    assert.deepEqual(db.libraryCounts([]), { games: 0, analyzed: 0 });
  });
});

// ---------------------------------------------------------------------------
// The view's perspective
// ---------------------------------------------------------------------------

describe("library_games perspective", () => {
  test("a 'w' link sees the white side and a 'b' link sees the mirrored side", () => {
    const id = newGame({ white: "Alice", black: "Bob", white_rating: 2000, black_rating: 1800 });
    db.markGameAnalyzed(id, { white: 88.5, black: 61.25 });
    db.linkGame("scope:w", id, "w");
    db.linkGame("scope:b", id, "b");

    const asWhite = db.getLibraryGame(id, ["scope:w"])!;
    assert.equal(asWhite.player_color, "w");
    assert.equal(asWhite.opponent, "Bob");
    assert.equal(asWhite.player_rating, 2000);
    assert.equal(asWhite.opponent_rating, 1800);
    assert.equal(asWhite.accuracy, 88.5);

    const asBlack = db.getLibraryGame(id, ["scope:b"])!;
    assert.equal(asBlack.player_color, "b");
    assert.equal(asBlack.opponent, "Alice");
    assert.equal(asBlack.player_rating, 1800);
    assert.equal(asBlack.opponent_rating, 2000);
    assert.equal(asBlack.accuracy, 61.25, "the viewer's own accuracy must flip with the seat");
  });

  test("an unknown game, or an empty scope list, sees nothing", () => {
    const id = newGame();
    db.linkGame("scope:a", id, "w");
    assert.equal(db.getLibraryGame(id, ["scope:other"]), null);
    assert.equal(db.getLibraryGame(id, []), null);
    assert.equal(db.getLibraryGame(99999, ["scope:a"]), null);
  });
});

// ---------------------------------------------------------------------------
// queryGames
// ---------------------------------------------------------------------------

describe("queryGames", () => {
  const alice = ["lichess:alice"];
  let white = 0;
  let black = 0;
  let chesscom = 0;
  let erin = 0;

  beforeEach(() => {
    white = newGame({
      source: "lichess",
      white: "Alice",
      black: "Bob",
      white_rating: 2000,
      black_rating: 1800,
      result: "1-0",
      speed: "blitz",
      eco: "C50",
      opening_name: "Italian Game",
      played_at: "2024-01-10T12:00:00Z",
      total_plies: 40,
    });
    db.linkGame("lichess:alice", white, "w");

    black = newGame({
      source: "lichess",
      white: "Carol",
      black: "Alice",
      white_rating: 1600,
      black_rating: 2050,
      result: "1-0",
      speed: "rapid",
      eco: "B20",
      opening_name: "Sicilian Defense",
      played_at: "2024-02-15T09:00:00Z",
      total_plies: 30,
    });
    db.linkGame("lichess:alice", black, "b");

    chesscom = newGame({
      source: "chesscom",
      white: "Alice",
      black: "Dave",
      result: "1/2-1/2",
      speed: "blitz",
      eco: "D00",
      opening_name: "Queen's Pawn Game",
      played_at: "2024-03-20T18:30:00Z",
      total_plies: 0,
    });
    db.linkGame("chesscom:alice", chesscom, "w");

    erin = newGame({
      source: "lichess",
      white: "Erin",
      black: "Frank",
      opening_name: "English Opening",
      played_at: "2024-04-01T00:00:00Z",
    });
    db.linkGame("lichess:erin", erin, "w");

    db.markGameAnalyzed(white, { white: 88.5, black: 61.25 });
  });

  const ids = (result: GameQueryResult): number[] => result.games.map((g) => g.id);
  const q = (overrides: Partial<Omit<GameQuery, "scopes">> = {}): GameQueryResult =>
    db.queryGames({ scopes: alice, ...overrides });

  test("returns only games inside the viewer's scopes", () => {
    const result = q();
    assert.equal(result.total, 2);
    assert.equal(result.analyzed, 1);
    assert.deepEqual(ids(result), [black, white], "newest game first");
    assert.ok(!ids(result).includes(chesscom));
    assert.ok(!ids(result).includes(erin));

    assert.deepEqual(ids(db.queryGames({ scopes: ["chesscom:alice"] })), [chesscom]);
    assert.deepEqual(ids(db.queryGames({ scopes: ["lichess:erin"] })), [erin]);
  });

  test("an empty scope list returns nothing", () => {
    const result = db.queryGames({ scopes: [] });
    assert.deepEqual(result.games, []);
    assert.equal(result.total, 0);
    assert.equal(result.analyzed, 0);
    assert.equal(result.page, 1);
    assert.equal(result.pageCount, 1);
  });

  test("search matches either player, the opponent, opening and ECO, case-insensitively", () => {
    assert.deepEqual(ids(q({ q: "alice" })), [black, white], "Alice is white in one, black in the other");
    assert.deepEqual(ids(q({ q: "BOB" })), [white], "the opponent is searchable");
    assert.deepEqual(ids(q({ q: "italian" })), [white]);
    assert.deepEqual(ids(q({ q: "c50" })), [white]);
    assert.deepEqual(ids(q({ q: "sicil" })), [black]);
    assert.deepEqual(ids(q({ q: "zzz" })), []);
    assert.deepEqual(ids(q({ q: "   " })), [black, white], "a blank search is no filter");
  });

  test("trims the search term", () => {
    assert.deepEqual(ids(q({ q: "  alice  " })), [black, white]);
  });

  test("filters by source, speed, analyzed and colour", () => {
    assert.deepEqual(ids(q({ source: "lichess" })), [black, white]);
    assert.deepEqual(ids(q({ source: "chesscom" })), []);

    assert.deepEqual(ids(q({ speed: "blitz" })), [white]);
    assert.deepEqual(ids(q({ speed: "rapid" })), [black]);

    assert.deepEqual(ids(q({ analyzed: 1 })), [white]);
    assert.deepEqual(ids(q({ analyzed: 0 })), [black]);

    assert.deepEqual(ids(q({ color: "w" })), [white]);
    assert.deepEqual(ids(q({ color: "b" })), [black]);
  });

  test("translates win/loss/draw into the viewer's perspective", () => {
    // white: Alice won as white (1-0). black: Alice lost as black (1-0).
    assert.deepEqual(ids(q({ result: "win" })), [white]);
    assert.deepEqual(ids(q({ result: "loss" })), [black]);
    assert.deepEqual(ids(q({ result: "draw" })), []);
    assert.deepEqual(ids(db.queryGames({ scopes: ["chesscom:alice"], result: "draw" })), [chesscom]);
    assert.deepEqual(ids(db.queryGames({ scopes: ["chesscom:alice"], result: "win" })), []);
  });

  test("bounds played_at inclusively at both ends", () => {
    assert.deepEqual(ids(q({ from: "2024-02-01" })), [black]);
    assert.deepEqual(ids(q({ to: "2024-01-31" })), [white]);
    assert.deepEqual(ids(q({ from: "2024-01-01", to: "2024-02-28" })), [black, white]);
    assert.deepEqual(ids(q({ from: "2024-03-01" })), []);
    assert.deepEqual(
      ids(q({ from: "2024-01-10T12:00:00Z", to: "2024-01-10T12:00:00Z" })),
      [white],
      "an exact bound still matches"
    );
  });

  test("orders by played_at descending, then by id descending on a tie", () => {
    const first = newGame({ played_at: "2024-05-05T00:00:00Z" });
    db.linkGame("scope:tie", first, "w");
    const second = newGame({ played_at: "2024-05-05T00:00:00Z" });
    db.linkGame("scope:tie", second, "w");

    assert.deepEqual(ids(db.queryGames({ scopes: ["scope:tie"] })), [second, first]);
  });

  test("clamps pageSize into 1..200", () => {
    assert.equal(q({ pageSize: 0 }).pageSize, 1);
    assert.equal(q({ pageSize: -25 }).pageSize, 1);
    assert.equal(q({ pageSize: 1000 }).pageSize, 200);
    assert.equal(q({ pageSize: 2 }).pageSize, 2);
    assert.equal(q({ pageSize: 0 }).games.length, 1, "the clamp must bound the page too");
    assert.equal(q({ pageSize: 1000 }).games.length, 2);
  });

  test("clamps page into range and computes pageCount from the unclamped total filter", () => {
    const page1 = q({ pageSize: 1, page: 1 });
    assert.equal(page1.pageCount, 2);
    assert.equal(page1.page, 1);
    assert.deepEqual(ids(page1), [black]);

    const page2 = q({ pageSize: 1, page: 2 });
    assert.equal(page2.page, 2);
    assert.deepEqual(ids(page2), [white]);

    const past = q({ pageSize: 1, page: 3 });
    assert.equal(past.page, 2, "a page past the end clamps to the last page");
    assert.deepEqual(ids(past), [white]);

    assert.equal(q({ pageSize: 1, page: 0 }).page, 1);
    assert.equal(q({ pageSize: 1, page: -4 }).page, 1);

    // The clamp is against the filter, not the whole library.
    assert.equal(q({ pageSize: 1, analyzed: 1, page: 9 }).page, 1);
    assert.equal(q({ pageSize: 1, analyzed: 1, page: 9 }).pageCount, 1);
  });

  test("counts and paginates across every one of the viewer's scopes", () => {
    const result = db.queryGames({ scopes: ["lichess:alice", "chesscom:alice"] });
    assert.equal(result.total, 3);
    assert.equal(result.analyzed, 1);
    assert.deepEqual(ids(result), [chesscom, black, white]);
  });

  test("derives flagged moves and the decisive moment from the viewer's own side", () => {
    db.upsertPosition(
      position(white, 4, "w", { classification: "blunder", centipawn_loss: 1500, san: "Qh5", motif: "hung-piece" })
    );
    db.upsertPosition(position(white, 8, "w", { classification: "mistake", centipawn_loss: 250, san: "Nf3" }));
    db.upsertPosition(
      position(white, 6, "b", { classification: "blunder", centipawn_loss: 900, san: "Bc5", motif: "missed-capture" })
    );

    const [game] = q({ color: "w" }).games;
    assert.equal(game.id, white);
    assert.equal(game.flagged, 2, "only the white moves are Alice's");
    assert.equal(game.blunders, 1);
    assert.equal(game.decisive_ply, 4);
    assert.equal(game.decisive_cpl, 1000, "the cost is capped at 1000 for display");
    assert.equal(game.decisive_san, "Qh5");
    assert.equal(game.decisive_motif, "hung-piece");
  });
});

// ---------------------------------------------------------------------------
// unlinkGame — the shared-analysis invariant
// ---------------------------------------------------------------------------

describe("unlinkGame", () => {
  test("removes only that scope's link and keeps the game for everyone else", () => {
    const id = newGame();
    db.markGameAnalyzed(id, { white: 90, black: 80 });
    db.upsertPosition(position(id, 4, "w", { classification: "blunder" }));
    db.upsertPosition(position(id, 5, "b", { classification: "mistake" }));
    const puzzleId = db.insertPuzzle({
      game_id: id,
      position_id: null,
      color: "w",
      fen: "puzzle-fen",
      solution_uci: "e2e4",
      solution_san: "e4",
      theme: "hanging-piece",
    });
    db.linkGame("scope:a", id, "w");
    db.linkGame("scope:b", id, "b");
    db.upsertPuzzleReview("scope:b", puzzleId, 2.5, 1, 1, "2024-06-01", true);

    db.unlinkGame(id, ["scope:a"]);

    assert.deepEqual(db.listGameScopes(id), ["scope:b"]);
    assert.notEqual(db.getGame(id), null, "the shared game row must survive");
    assert.equal(db.getPositions(id).length, 2, "the shared analysis must survive");
    assert.equal(db.puzzleExists("puzzle-fen", "w"), true);
    assert.equal(db.getPuzzleReview("scope:b", puzzleId).solved_count, 1);
    assert.equal(db.getLibraryGame(id, ["scope:a"]), null);
    assert.equal(db.getLibraryGame(id, ["scope:b"])!.player_color, "b");
  });

  test("deletes the game, positions, puzzles and reviews only when the last link goes", () => {
    const id = newGame();
    db.upsertPosition(position(id, 4, "w"));
    const puzzleId = db.insertPuzzle({
      game_id: id,
      position_id: null,
      color: "w",
      fen: "last-fen",
      solution_uci: "d2d4",
      solution_san: "d4",
      theme: null,
    });
    db.linkGame("scope:a", id, "w");
    db.linkGame("scope:b", id, "b");
    db.upsertPuzzleReview("scope:b", puzzleId, 2.5, 1, 1, "2024-06-01", false);

    db.unlinkGame(id, ["scope:a", "scope:b"]);

    assert.equal(db.getGame(id), null);
    assert.deepEqual(db.getPositions(id), []);
    assert.equal(count("puzzles"), 0);
    assert.equal(count("puzzle_reviews"), 0, "the practice state goes with the drill");
    assert.deepEqual(db.listGameScopes(id), []);
  });

  test("does nothing when the caller's scopes are empty or hold no link", () => {
    const id = newGame();
    db.linkGame("scope:a", id, "w");

    db.unlinkGame(id, []);
    db.unlinkGame(id, ["scope:other"]);

    assert.notEqual(db.getGame(id), null);
    assert.deepEqual(db.listGameScopes(id), ["scope:a"]);
  });

  test("two accounts can unlink in either order without losing shared analysis", () => {
    const id = newGame();
    db.markGameAnalyzed(id, { white: 70, black: 60 });
    db.upsertPosition(position(id, 4, "w", { classification: "blunder" }));
    db.linkGame("scope:a", id, "w");
    db.linkGame("scope:b", id, "b");

    db.unlinkGame(id, ["scope:b"]);
    assert.equal(db.getLibraryGame(id, ["scope:a"])!.accuracy, 70);
    assert.equal(db.getPositions(id).length, 1);

    db.unlinkGame(id, ["scope:a"]);
    assert.equal(db.getGame(id), null);
  });
});

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

describe("engine cache", () => {
  test("round-trips a position and misses return null", () => {
    assert.equal(db.getEngineCache("missing-fen"), null);

    db.setEngineCache("fen-1", "e2e4", 34.5, null, "e2e4 e7e5", 18);
    assert.deepEqual(db.getEngineCache("fen-1"), {
      best_move: "e2e4",
      score_cp: 34.5,
      mate: null,
      pv: "e2e4 e7e5",
      depth: 18,
    });

    db.setEngineCache("mate-fen", "h5g6", 99999, 3, "h5g6", 12);
    assert.equal(db.getEngineCache("mate-fen")!.mate, 3);
  });

  test("writing the same FEN overwrites rather than accumulating rows", () => {
    db.setEngineCache("fen-2", "d2d4", 10, null, "pv", 10);
    db.setEngineCache("fen-2", "c2c4", -25, null, "pv2", 22);

    assert.equal(count("engine_cache"), 1);
    const cached = db.getEngineCache("fen-2")!;
    assert.equal(cached.best_move, "c2c4");
    assert.equal(cached.score_cp, -25);
    assert.equal(cached.depth, 22);
  });
});

describe("ai explanations", () => {
  const key = { fen: "fen-1", playedUci: "e2e4", classification: "blunder", ratingBand: 1200 };
  const row = (over: Partial<Parameters<Db["setAiExplanation"]>[0]> = {}) => ({
    fen: key.fen,
    played_uci: key.playedUci,
    classification: key.classification,
    rating_band: key.ratingBand,
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    explanation: "You hung a knight.",
    key_lesson: "Loose pieces drop off.",
    drill_suggestion: "Drill forks.",
    ...over,
  });

  test("round-trips a reading and misses return null", () => {
    assert.equal(db.getAiExplanation(key, "anthropic", "claude-sonnet-4-5"), null);

    db.setAiExplanation(row());
    const found = db.getAiExplanation(key, "anthropic", "claude-sonnet-4-5");
    assert.equal(found?.explanation, "You hung a knight.");
    assert.equal(found?.key_lesson, "Loose pieces drop off.");
    assert.equal(found?.drill_suggestion, "Drill forks.");
    assert.equal(found?.provider, "anthropic");
  });

  test("different providers and models coexist for the same position", () => {
    // The point of the feature: Claude's reading from last time stays viewable
    // after GPT gives today's.
    db.setAiExplanation(row());
    db.setAiExplanation(row({ provider: "openai", model: "gpt-5", explanation: "GPT's take." }));

    const all = db.listAiExplanationsForFens([key.fen]);
    assert.equal(all.length, 2);
    assert.deepEqual(
      all.map((r) => r.explanation).sort(),
      ["GPT's take.", "You hung a knight."]
    );
  });

  test("the same provider and model overwrites rather than accumulating rows", () => {
    db.setAiExplanation(row({ explanation: "first" }));
    db.setAiExplanation(row({ explanation: "second" }));

    assert.equal(count("ai_explanations"), 1);
    assert.equal(db.getAiExplanation(key, "anthropic", "claude-sonnet-4-5")?.explanation, "second");
  });

  test("a different played move is a different cache entry", () => {
    // A FEN does not determine what was played from it; the old FEN-only cache
    // served users text written about somebody else's move.
    db.setAiExplanation(row());
    assert.equal(
      db.getAiExplanation({ ...key, playedUci: "d2d4" }, "anthropic", "claude-sonnet-4-5"),
      null
    );
  });

  test("a different rating band is a different entry", () => {
    db.setAiExplanation(row());
    assert.equal(
      db.getAiExplanation({ ...key, ratingBand: 2000 }, "anthropic", "claude-sonnet-4-5"),
      null
    );
  });

  test("groupAiExplanations groups by the full position key", () => {
    db.setAiExplanation(row());
    db.setAiExplanation(row({ provider: "openai", model: "gpt-5" }));
    const grouped = db.groupAiExplanations(db.listAiExplanationsForFens([key.fen]));
    assert.equal(grouped.size, 1);
    assert.equal([...grouped.values()][0].length, 2);
  });

  test("listAiExplanationsForFens tolerates unknown FENs and empty input", () => {
    db.setAiExplanation(row());
    assert.equal(db.listAiExplanationsForFens(["not-a-known-fen"]).length, 0);
    assert.equal(db.listAiExplanationsForFens([]).length, 0);
  });
});

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

describe("positions", () => {
  test("upsertPosition on (game_id, ply) updates the same row", () => {
    const id = newGame();
    db.upsertPosition(position(id, 4, "w", { classification: "good", centipawn_loss: 20 }));
    db.upsertPosition(
      position(id, 4, "w", {
        classification: "blunder",
        centipawn_loss: 600,
        explanation: "you dropped a piece",
        is_critical: 1,
      })
    );

    assert.equal(db.getPositions(id).length, 1);
    const stored = db.getPosition(id, 4)!;
    assert.equal(stored.classification, "blunder");
    assert.equal(stored.centipawn_loss, 600);
    assert.equal(stored.explanation, "you dropped a piece");
    assert.equal(stored.is_critical, 1);
  });

  test("insertPositionIfMissing adds a new ply but never overwrites an existing one", () => {
    const id = newGame();
    db.upsertPosition(
      position(id, 4, "w", {
        fen: "engine-fen",
        san: "Qh5",
        classification: "blunder",
        explanation: "engine wrote this",
      })
    );

    // A re-import parses the game again; its row for ply 4 must be ignored so the
    // engine's work is not wiped.
    db.insertPositionIfMissing({
      game_id: id,
      ply: 4,
      color: "w",
      fen: "import-fen",
      san: "Qh4",
      uci: "d1h5",
      fen_after: "import-after",
      clock_seconds: 12,
    });
    // A genuinely new ply is inserted.
    db.insertPositionIfMissing({
      game_id: id,
      ply: 6,
      color: "b",
      fen: "fresh-fen",
      san: "e5",
      uci: "e7e5",
      fen_after: "fresh-after",
      clock_seconds: 14,
    });

    const rows = db.getPositions(id);
    assert.equal(rows.length, 2, "the existing ply is not duplicated, the new ply is added");
    const ply4 = db.getPosition(id, 4)!;
    assert.equal(ply4.fen, "engine-fen");
    assert.equal(ply4.san, "Qh5");
    assert.equal(ply4.classification, "blunder");
    assert.equal(ply4.explanation, "engine wrote this");
    assert.equal(db.getPosition(id, 6)!.fen, "fresh-fen");
  });

  test("getPositions is ordered by ply", () => {
    const id = newGame();
    for (const ply of [8, 2, 6, 0, 4]) db.upsertPosition(position(id, ply, "w"));
    assert.deepEqual(
      db.getPositions(id).map((p) => p.ply),
      [0, 2, 4, 6, 8]
    );
  });

  test("deletePositions clears one game without touching another", () => {
    const a = newGame();
    const b = newGame();
    db.upsertPosition(position(a, 2, "w"));
    db.upsertPosition(position(b, 2, "w"));

    db.deletePositions(a);

    assert.deepEqual(db.getPositions(a), []);
    assert.equal(db.getPositions(b).length, 1);
  });
});
