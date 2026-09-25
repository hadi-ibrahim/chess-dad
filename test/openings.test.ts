/**
 * The opening catalogue: the curated ECO data, lookup, main-line deviation
 * detection, and the join of theory with the player's own results and review
 * schedule.
 *
 * Deviation detection is the heart of the Openings screen: it decides whether a
 * game is "still in theory", where it left the book, and therefore which line to
 * show. The join is tested against a throwaway SQLite database — never the app's
 * real `data/chessdad.db` — so the result/win-rate/review derivation is exercised
 * for real rather than mocked.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point config at a scratch database *before* anything imports it. config reads
// the environment at module load, so the dynamic import below must come after.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chessdad-openings-"));
process.env.CHESSDAD_DATA_DIR = tmpDir;
process.env.CHESSDAD_DB_PATH = path.join(tmpDir, "chessdad.db");

const { OPENINGS, findOpening, getOpenings, detectDeviation, getOpeningEntries } = await import(
  "@/lib/openings"
);
const { getDb } = await import("@/lib/db");
const { Chess } = await import("chess.js");

const ALICE = "lichess:alice";
const BOB = "lichess:bob";

interface NewGame {
  eco: string;
  scope: string;
  color: "w" | "b";
  result: string;
  accuracy: number;
  analyzed?: number;
  playedAt: string;
}

function addGame(g: NewGame, n: number): number {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO games (source, external_id, pgn, white, black, result, eco, analyzed,
                          accuracy_white, accuracy_black, played_at)
       VALUES ('lichess', ?, '', 'White', 'Black', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      `${g.scope}-${n}`,
      g.result,
      g.eco,
      g.analyzed ?? 1,
      g.accuracy,
      g.accuracy,
      g.playedAt
    );
  const gameId = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO library (scope, game_id, player_color) VALUES (?, ?, ?)").run(
    g.scope,
    gameId,
    g.color
  );
  return gameId;
}

function addReview(eco: string, scope: string, dueAt: string, overrides: Record<string, unknown> = {}) {
  getDb()
    .prepare(
      `INSERT INTO opening_reviews (scope, eco, ease, interval_days, repetitions, due_at,
                                    clean_count, miss_count, last_reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      scope,
      eco,
      (overrides.ease as number) ?? 2.6,
      (overrides.intervalDays as number) ?? 4,
      (overrides.repetitions as number) ?? 3,
      dueAt,
      (overrides.cleanCount as number) ?? 2,
      (overrides.missCount as number) ?? 0,
      (overrides.lastReviewedAt as string) ?? "2024-05-01T00:00:00.000Z"
    );
}

describe("OPENINGS catalogue", () => {
  test("is non-trivial and every ECO code is unique and well-formed", () => {
    assert.ok(OPENINGS.length >= 20, `expected a real catalogue, got ${OPENINGS.length}`);
    const ecos = OPENINGS.map((o) => o.eco);
    assert.equal(new Set(ecos).size, ecos.length, "duplicate ECO code in the catalogue");
    for (const o of OPENINGS) {
      assert.match(o.eco, /^[A-E]\d{2}$/, `${o.eco} is not an ECO code`);
      assert.ok(o.name.trim().length > 0, `${o.eco} has no name`);
      assert.match(o.wikipedia, /^https:\/\//, `${o.eco} needs an https reference`);
    }
  });

  test("every main line is a sequence of legal moves that reaches the named position", () => {
    // A typo in an opening line would make deviation detection meaningless, so the
    // data is replayed against chess.js rather than trusted.
    for (const o of OPENINGS) {
      assert.ok(o.uci.length > 0, `${o.eco} has an empty main line`);
      const chess = new Chess();
      o.uci.forEach((uci, i) => {
        assert.match(uci, /^[a-h][1-8][a-h][1-8][qrbn]?$/, `${o.eco} ply ${i}: bad UCI "${uci}"`);
        const move = chess.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci.length > 4 ? uci[4] : undefined,
        });
        assert.equal(move?.lan, uci, `${o.eco} ply ${i}: "${uci}" is not legal or not the LAN`);
      });
    }
  });
});

describe("findOpening / getOpenings", () => {
  test("finds an entry by its exact ECO code", () => {
    assert.equal(findOpening("C50")?.name, "Italian Game");
    assert.equal(findOpening("B90")?.name, "Sicilian Defense: Najdorf");
  });

  test("is case-sensitive and returns undefined for an unknown code", () => {
    assert.equal(findOpening("c50"), undefined);
    assert.equal(findOpening("Z99"), undefined);
    assert.equal(findOpening(""), undefined);
  });

  test("getOpenings returns the catalogue itself", () => {
    assert.equal(getOpenings(), OPENINGS);
  });
});

describe("detectDeviation", () => {
  const italian = findOpening("C50")!;
  const english = findOpening("A10")!;

  test("a game that matches the main line exactly is still in theory", () => {
    const d = detectDeviation(["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"], italian);
    assert.equal(d.deviatedAt, -1);
    assert.equal(d.expected, null);
    assert.equal(d.played, null);
    assert.equal(d.opening, italian);
  });

  test("a game that stops early is still in theory — it has not deviated yet", () => {
    // Leaving the book because the game ended is not a deviation.
    const d = detectDeviation(["e2e4", "e7e5", "g1f3"], italian);
    assert.equal(d.deviatedAt, -1);
    assert.equal(d.played, null);
  });

  test("an empty move list is still in theory", () => {
    const d = detectDeviation([], italian);
    assert.equal(d.deviatedAt, -1);
    assert.equal(d.expected, null);
    assert.equal(d.played, null);
  });

  test("reports the first ply that leaves the main line, with both moves", () => {
    const d = detectDeviation(["e2e4", "e7e5", "g1f3", "b8c6", "d2d4"], italian);
    assert.equal(d.deviatedAt, 4);
    assert.equal(d.expected, "f1c4");
    assert.equal(d.played, "d2d4");
  });

  test("reports a deviation on the very first move", () => {
    const d = detectDeviation(["d2d4"], italian);
    assert.equal(d.deviatedAt, 0);
    assert.equal(d.expected, "e2e4");
    assert.equal(d.played, "d2d4");
  });

  test("a complete line played one move deeper reports the follow-up as the deviation", () => {
    // The line is exhausted, so there is no expected move — the first extra move
    // is where the game left theory.
    const d = detectDeviation(
      ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"],
      italian
    );
    assert.equal(d.deviatedAt, italian.uci.length);
    assert.equal(d.expected, null);
    assert.equal(d.played, "g8f6");
  });

  test("a one-move line flags a different first move immediately", () => {
    const d = detectDeviation(["e2e4", "e7e5"], english); // English is 1. c4
    assert.equal(d.deviatedAt, 0);
    assert.equal(d.expected, "c2c4");
    assert.equal(d.played, "e2e4");
  });

  test("returns the opening and the played moves unchanged for the caller to render", () => {
    const played = ["e2e4", "e7e5", "g1f3"];
    const d = detectDeviation(played, italian);
    assert.equal(d.opening, italian);
    assert.equal(d.playedMoves, played);
  });
});

describe("getOpeningEntries without an account", () => {
  test("returns every opening unjoined, with due=false", () => {
    const entries = getOpeningEntries([]);
    assert.equal(entries.length, OPENINGS.length);
    for (const e of entries) {
      assert.equal(e.record, null);
      assert.equal(e.review, null);
      assert.equal(e.due, false);
    }
    assert.equal(entries[0].eco, OPENINGS[0].eco);
    assert.equal(entries[0].name, OPENINGS[0].name);
  });
});

describe("getOpeningEntries joined with the library", () => {
  before(() => {
    const db = getDb();
    db.exec("DELETE FROM library; DELETE FROM games; DELETE FROM opening_reviews;");

    let n = 0;
    // Italian (C50): 1 win, 1 loss, 1 draw, accuracies 90 / 60 / 75.
    addGame({ eco: "C50", scope: ALICE, color: "w", result: "1-0", accuracy: 90, playedAt: "2024-01-01T00:00:00.000Z" }, n++);
    addGame({ eco: "C50", scope: ALICE, color: "w", result: "0-1", accuracy: 60, playedAt: "2024-02-01T00:00:00.000Z" }, n++);
    addGame({ eco: "C50", scope: ALICE, color: "w", result: "1/2-1/2", accuracy: 75, playedAt: "2024-03-01T00:00:00.000Z" }, n++);
    // Sicilian (B20) as Black: one win (result 0-1), and an unanalyzed loss to ignore.
    addGame({ eco: "B20", scope: ALICE, color: "b", result: "0-1", accuracy: 80, playedAt: "2024-04-01T00:00:00.000Z" }, n++);
    addGame({ eco: "B20", scope: ALICE, color: "b", result: "1-0", accuracy: 10, analyzed: 0, playedAt: "2024-04-02T00:00:00.000Z" }, n++);
    // Junk rows: no ECO, and a game with no library link at all.
    addGame({ eco: "", scope: ALICE, color: "w", result: "1-0", accuracy: 50, playedAt: "2024-01-01T00:00:00.000Z" }, n++);
    // English (A10): 2 wins + 1 draw -> the 83.3 rounding boundary.
    addGame({ eco: "A10", scope: ALICE, color: "w", result: "1-0", accuracy: 50, playedAt: "2024-01-01T00:00:00.000Z" }, n++);
    addGame({ eco: "A10", scope: ALICE, color: "w", result: "1-0", accuracy: 50, playedAt: "2024-01-01T00:00:00.000Z" }, n++);
    addGame({ eco: "A10", scope: ALICE, color: "w", result: "1/2-1/2", accuracy: 50, playedAt: "2024-01-01T00:00:00.000Z" }, n++);
    // Another account's games must not leak into Alice's record.
    addGame({ eco: "C50", scope: BOB, color: "w", result: "1-0", accuracy: 100, playedAt: "2024-06-01T00:00:00.000Z" }, n++);

    addReview("C50", ALICE, "2020-01-01T00:00:00.000Z");
    addReview("B20", ALICE, "2999-01-01T00:00:00.000Z");
    // A review for a line Alice has never played: not due, per the module's comment.
    addReview("D80", ALICE, "2020-01-01T00:00:00.000Z", { cleanCount: 0, missCount: 1, ease: 2.5 });
  });

  after(() => {
    try {
      getDb().close();
    } catch {
      /* already closed */
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const entriesByEco = () => new Map(getOpeningEntries([ALICE]).map((e) => [e.eco, e]));

  test("returns every opening, preserving the theory fields", () => {
    const entries = getOpeningEntries([ALICE]);
    assert.equal(entries.length, OPENINGS.length);
    const c50 = entriesByEco().get("C50")!;
    assert.equal(c50.name, "Italian Game");
    assert.equal(c50.uci.length, 5);
    assert.equal(c50.wikipedia, OPENINGS.find((o) => o.eco === "C50")!.wikipedia);
  });

  test("derives games, wins, draws, losses, win rate and average accuracy", () => {
    const c50 = entriesByEco().get("C50")!;
    assert.deepEqual(c50.record, {
      games: 3,
      wins: 1,
      draws: 1,
      losses: 1,
      winRate: 50, // (1 + 0.5) / 3
      avgAccuracy: 75, // (90 + 60 + 75) / 3
      lastPlayed: "2024-03-01T00:00:00.000Z",
    });
  });

  test("credits a Black win from the player's side, not the board's", () => {
    // result 0-1 with player_color b is a win for the player.
    const b20 = entriesByEco().get("B20")!;
    assert.equal(b20.record?.games, 1);
    assert.equal(b20.record?.wins, 1);
    assert.equal(b20.record?.losses, 0);
    assert.equal(b20.record?.winRate, 100);
    assert.equal(b20.record?.avgAccuracy, 80);
  });

  test("rounds the win rate to one decimal", () => {
    assert.equal(entriesByEco().get("A10")!.record?.winRate, 83.3);
  });

  test("excludes unanalyzed games, blank ECO codes, and other accounts", () => {
    const entries = getOpeningEntries([ALICE]);
    // The unanalyzed B20 game has accuracy 10; if it leaked in the average would move.
    assert.equal(entriesByEco().get("B20")!.record?.games, 1);
    // No opening should pick up the blank-ECO row: every other record stays null.
    const withRecords = entries.filter((e) => e.record !== null).map((e) => e.eco).sort();
    assert.deepEqual(withRecords, ["A10", "B20", "C50"]);
    assert.equal(entriesByEco().get("C50")!.record?.wins, 1);
  });

  test("maps the spaced-repetition review onto the entry", () => {
    const c50 = entriesByEco().get("C50")!;
    assert.deepEqual(c50.review, {
      ease: 2.6,
      intervalDays: 4,
      repetitions: 3,
      dueAt: "2020-01-01T00:00:00.000Z",
      cleanCount: 2,
      missCount: 0,
      lastReviewedAt: "2024-05-01T00:00:00.000Z",
    });
  });

  test("an overdue line you have played is due; one due in the future is not", () => {
    assert.equal(entriesByEco().get("C50")!.due, true);
    assert.equal(entriesByEco().get("B20")!.due, false);
  });

  test("a line with results but no review row is due", () => {
    const a10 = entriesByEco().get("A10")!;
    assert.ok(a10.record);
    assert.equal(a10.review, null);
    assert.equal(a10.due, true);
  });

  test("an overdue review for a line you have never played is NOT due", () => {
    const d80 = entriesByEco().get("D80")!;
    assert.equal(d80.record, null);
    assert.ok(d80.review, "the review row should still be joined");
    assert.equal(d80.due, false, "an opening never on the board cannot be overdue");
  });

  test("an opening with neither results nor a review has no record, no review, not due", () => {
    const e60 = entriesByEco().get("E60")!;
    assert.equal(e60.record, null);
    assert.equal(e60.review, null);
    assert.equal(e60.due, false);
  });

  test("scopes combine without double-counting", () => {
    const entries = new Map(getOpeningEntries([ALICE, BOB]).map((e) => [e.eco, e]));
    assert.equal(entries.get("C50")!.record?.games, 4);
    assert.equal(entries.get("C50")!.record?.wins, 2);
  });

  test("a hostile scope string is parameterised, not executed", () => {
    // scopes come from the browser; the IN (...) list is built from placeholders.
    const entries = getOpeningEntries(["'; DROP TABLE games; --"]);
    assert.equal(entries.length, OPENINGS.length);
    assert.ok(entries.every((e) => e.record === null));
    const count = getDb().prepare("SELECT COUNT(*) AS c FROM games").get() as { c: number };
    assert.ok(count.c > 0, "the games table must still exist");
  });
});
