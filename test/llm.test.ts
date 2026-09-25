/**
 * The deterministic coach.
 *
 * This is the text every review shows as the baseline, and it is the only coach
 * when a profile has not configured an AI provider — so it is the app's baseline,
 * not a degraded mode. It has shipped self-contradictory sentences before, which
 * is what these tests exist to prevent.
 *
 * `fallbackExplain` is pure and offline: no network, no key, no database.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { fallbackExplain, illegalMovesNamed, type ExplainInput } from "@/lib/llm";

function input(overrides: Partial<ExplainInput> = {}): ExplainInput {
  return {
    fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
    playedSan: "Kb1",
    bestSan: "Kb2",
    evalBeforeCp: 300,
    evalAfterCp: 100,
    classification: "mistake",
    motif: "tactical",
    openingName: "Test",
    rating: 1200,
    ...overrides,
  };
}

describe("fallbackExplain", () => {
  test("names the engine's move when it differs from the one played", () => {
    const out = fallbackExplain(input());
    assert.match(out.explanation, /preferred Kb2 instead of Kb1/);
    assert.ok(out.explanation.length > 0);
  });

  test("never compares a move to itself", () => {
    // Real output used to read "the engine preferred Kh8 instead of Kh8" on a
    // forced move where the player had no choice and agreed with the engine.
    const out = fallbackExplain(
      input({ playedSan: "Kh8", bestSan: "Kh8", classification: "forced" })
    );
    assert.ok(!/instead of/.test(out.explanation), `self-comparison: ${out.explanation}`);
    assert.ok(!/preferred Kh8/.test(out.explanation));
  });

  test("describes a forced move as forced, not as suboptimal", () => {
    const out = fallbackExplain(input({ playedSan: "Kh8", bestSan: "Kh8", classification: "forced" }));
    assert.match(out.explanation, /only one legal move/);
    assert.ok(!/suboptimal/.test(out.explanation));
  });

  test("describes a book move without calling it an error", () => {
    const out = fallbackExplain(input({ classification: "book", playedSan: "e4", bestSan: "e4" }));
    assert.match(out.explanation, /book move/);
    assert.ok(!/suboptimal/.test(out.explanation));
  });

  test("gives every classification a sensible verb", () => {
    const expected: Record<string, RegExp> = {
      blunder: /blundered/,
      mistake: /made a mistake/,
      miss: /missed a winning chance/,
      inaccuracy: /played an inaccuracy/,
      forced: /only one legal move/,
      book: /book move/,
    };
    for (const [classification, pattern] of Object.entries(expected)) {
      const out = fallbackExplain(input({ classification }));
      assert.match(out.explanation, pattern, `${classification} produced: ${out.explanation}`);
    }
  });

  test("handles a missing played move without printing an empty slot", () => {
    const out = fallbackExplain(input({ playedSan: "", bestSan: "Nf3" }));
    assert.match(out.explanation, /preferred Nf3 instead of your move/);
  });

  test("never reports a mate score as a pawn swing", () => {
    // Mate scores are encoded as +/-100000 cp, which used to render as
    // "+999.98 to +999.98 (a 0.0-pawn swing)".
    const out = fallbackExplain(input({ evalBeforeCp: 100000, evalAfterCp: 99998 }));
    assert.ok(!/999\.98/.test(out.explanation), out.explanation);
    assert.match(out.explanation, /forced mate/);
  });

  test("always returns a lesson and a drill", () => {
    for (const classification of ["blunder", "mistake", "miss", "inaccuracy", "good", "forced", "book"]) {
      const out = fallbackExplain(input({ classification }));
      assert.ok(out.key_lesson.trim().length > 0, `${classification} had no lesson`);
      assert.ok(out.drill_suggestion.trim().length > 0, `${classification} had no drill`);
    }
  });

  test("drills come from the OKF bundle, not hard-coded strings", () => {
    const out = fallbackExplain(input({ motif: "hung-piece" }));
    assert.match(out.drill_suggestion, /Solve themed puzzle sets/);
  });

  test("phrases a motif as English, not as a detector key", () => {
    // "The pattern involved a tactical." was the old output.
    const out = fallbackExplain(input({ motif: "hung-piece" }));
    assert.match(out.explanation, /The pattern was a hung piece/);
  });

  test("still returns text for an unmapped motif", () => {
    const out = fallbackExplain(input({ motif: "some-new-tag" }));
    assert.match(out.explanation, /some new tag/);
    assert.ok(out.key_lesson.length > 0);
  });
});

/**
 * The hallucination guard.
 *
 * These are REAL generated explanations the app produced and would have shown,
 * from a run of 25 in which 3 of the 21 that named a move named an impossible one.
 * Each is a confident "they can just take it" claim where the capturing piece
 * cannot reach the square. The FEN and moves are the exact ones the explanation
 * was generated from — if a pairing were wrong, the *played* move would not be
 * legal in the position, which is the first thing each test would then catch.
 */
describe("illegalMovesNamed", () => {
  // Black to move; White's knight really is on e2, but e2 cannot reach d5.
  const FORK_FEN = "r2q1rk1/pb3pbp/1p2p1p1/2p1Pn2/3p1P2/P2P4/BPP1NRPP/R1B1Q1K1 b - - 1 15";

  test("catches a capture the named piece cannot geometrically make", () => {
    const text =
      "Bd5 walks it into a spot where White's knight on e2 can simply take it with Nxd5 — that's why the engine calls this a hung piece.";
    assert.deepEqual(illegalMovesNamed(text, FORK_FEN, "Bd5", "Qh4"), ["Nxd5"]);
  });

  test("catches an invented queen trade", () => {
    // Black's queen is on e5; e5 to b3 is not a queen move, so the trade is fiction.
    const fen = "5rk1/1r3ppp/4p3/4q3/1p2p3/2P1R2P/1P3PP1/R2Q2K1 w - - 0 24";
    const text =
      "The engine prefers Qb3, which trades queens — after Qxb3 axb3 your rook on a1 gets the open a-file.";
    assert.deepEqual(illegalMovesNamed(text, fen, "Ra4", "Qb3"), ["Qxb3", "axb3"]);
  });

  test("catches captures a knight geometrically cannot make", () => {
    // A knight on c4 can reach neither c2 (straight back) nor d3 (one diagonal).
    const fen = "4r1k1/pp3pp1/1b5p/3p1b2/2n2q2/1NP2N1P/PPQ1BPP1/3R1K2 w - - 7 23";
    const text = "Instead, after Bd3, Black can simply take your queen with Nxc2 or Nxd3.";
    assert.deepEqual(illegalMovesNamed(text, fen, "Bd3", "Qc1"), ["Nxc2", "Nxd3"]);
  });

  test("passes an explanation that only names legal moves", () => {
    const text = "Qh4 keeps the pressure on and threatens ideas against h2. Your Bd5 drifted.";
    assert.deepEqual(illegalMovesNamed(text, FORK_FEN, "Bd5", "Qh4"), []);
  });

  test("accepts a move that is only legal after the engine's move", () => {
    // The guard must not discard legitimate continuations, so it also considers
    // the position after each of the two moves it was given.
    const fen = "5rk1/1r3ppp/4p3/4q3/1p2p3/2P1R2P/1P3PP1/R2Q2K1 w - - 0 24";
    const after = new Chess(fen);
    after.move("Qb3");
    const reply = after.moves({ verbose: true })[0].san;
    assert.deepEqual(illegalMovesNamed(`After Qb3, Black may try ${reply}.`, fen, "Ra4", "Qb3"), []);
  });

  test("does not mistake a bare square reference for a named move", () => {
    // "on b5" is a square, not a move — flagging it would discard good text.
    const fen = "5rk1/1r3ppp/4p3/4q3/1p2p3/2P1R2P/1P3PP1/R2Q2K1 w - - 0 24";
    const text = "Your queen on b5 was doing nothing, and your rook on a1 was tied down.";
    assert.deepEqual(illegalMovesNamed(text, fen, "Ra4", "Qb3"), []);
  });

  test("reads a piece already on its square as a label, not a named move", () => {
    // Real Claude output that the guard discarded: "the Nc3/Rd1 battery" names
    // White's pieces where they already stand, and both look exactly like SAN.
    const fen = "r1bqk2r/pp1n1ppp/2p2n2/3p4/4PP2/2N1QN2/PPP3PP/2KR1B1R b kq - 0 10";
    const text =
      "Castling looks natural, but it lets White keep the initiative. The Nc3/Rd1 battery against d5 stays annoying.";
    assert.deepEqual(illegalMovesNamed(text, fen, "O-O", "Qb6"), []);
  });

  test("the label exemption does not weaken the capture guard", () => {
    // Same position: Bxf4 cannot be played (the bishop cannot reach f4), so a
    // capture claim must still be rejected.
    const fen = "r1bqk2r/pp1n1ppp/2p2n2/3p4/4PP2/2N1QN2/PPP3PP/2KR1B1R b kq - 0 10";
    assert.deepEqual(illegalMovesNamed("You can win with Bxf4.", fen, "O-O", "Qb6"), ["Bxf4"]);
  });

  test("ignores text with no moves at all", () => {
    const out = illegalMovesNamed("Your pieces were uncoordinated and the king was exposed.", input().fen, "Kb1", "Kb2");
    assert.deepEqual(out, []);
  });

  test("does not reject anything when the position will not parse", () => {
    assert.deepEqual(illegalMovesNamed("Nf3 and e4.", "not-a-fen", "e4", "Nf3"), []);
  });
});
