/**
 * The chess primitives every other server module builds on: PGN parsing, FEN
 * phase detection, UCI/SAN translation, terminal-position predicates and the
 * material values the analysis pipeline uses.
 *
 * These are thin wrappers over chess.js, so the value of testing them is the
 * boundary behaviour: what happens on malformed PGNs, positions that are already
 * over, and the exact ply/phase thresholds the rest of the app keys off. A wrong
 * `detectPhase` boundary silently reclassifies every opening move of a game.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parsePgn,
  detectPhase,
  legalMoveCount,
  isCheckmate,
  isDraw,
  uciToSan,
  sanToUci,
  attackersOf,
  pieceValue,
  STARTING_FEN,
} from "@/lib/chess-core";

/** A real Ruy Lopez with castling on both sides, used wherever a normal game is enough. */
const RUY_LOPEZ = `[Event "Test"]
[Site "?"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 1-0`;

/** Black plays a pawn to g8 and White captures it, promoting on the last ply. */
const PROMOTION = `[Result "1-0"]

1. h4 g5 2. hxg5 h6 3. gxh6 Nf6 4. h7 Ng8 5. hxg8=Q`;

/** Black pushes d7-d5 to dodge White's e5 pawn; the only reply is en passant. */
const EN_PASSANT = `[Result "1-0"]

1. e4 Nf6 2. e5 d5 3. exd6`;

const CHECKMATE_FEN = "4R1k1/5ppp/8/8/8/8/8/6K1 b - - 1 1";
const STALEMATE_FEN = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1";
const BARE_KINGS_FEN = "8/8/8/4k3/8/8/8/4K3 w - - 0 1";

describe("parsePgn", () => {
  test("keeps the headers and reports the game result", () => {
    const game = parsePgn(RUY_LOPEZ);
    assert.equal(game.headers.White, "Alice");
    assert.equal(game.headers.Black, "Bob");
    assert.equal(game.headers.Event, "Test");
    assert.equal(game.result, "1-0");
  });

  test("emits one ply per half-move with 0-based ply and 1-based move number", () => {
    const game = parsePgn(RUY_LOPEZ);
    assert.equal(game.plies.length, 18);
    assert.equal(game.plies[0].ply, 0);
    assert.equal(game.plies[0].moveNumber, 1);
    assert.equal(game.plies[0].color, "w");
    assert.equal(game.plies[1].color, "b");
    assert.equal(game.plies[1].moveNumber, 1);
    assert.equal(game.plies[2].moveNumber, 2);
    assert.equal(game.plies[17].ply, 17);
    assert.equal(game.plies[17].moveNumber, 9);
  });

  test("records the position before and after each move, and they chain", () => {
    const game = parsePgn(RUY_LOPEZ);
    assert.equal(game.plies[0].fen, STARTING_FEN);
    for (let i = 1; i < game.plies.length; i++) {
      assert.equal(
        game.plies[i].fen,
        game.plies[i - 1].fenAfter,
        `ply ${i} should start where ply ${i - 1} ended`
      );
    }
    assert.equal(game.finalFen, game.plies[game.plies.length - 1].fenAfter);
  });

  test("UCI is chess.js's LAN, so it always round-trips through the engine format", () => {
    const game = parsePgn(RUY_LOPEZ);
    assert.equal(game.plies[0].uci, "e2e4");
    assert.equal(game.plies[2].uci, "g1f3");
    assert.equal(game.plies[2].san, "Nf3");
  });

  test("handles castling on both sides, with the king as the from-square", () => {
    const game = parsePgn(RUY_LOPEZ);
    const castles = game.plies.filter((p) => (p.san ?? "").includes("O-O"));
    assert.equal(castles.length, 2);
    assert.equal(castles[0].san, "O-O");
    assert.equal(castles[0].uci, "e1g1"); // the king moves, not the rook
    assert.equal(castles[1].uci, "e8g8");
  });

  test("handles promotion and keeps the lowercase promotion piece in UCI", () => {
    const game = parsePgn(PROMOTION);
    const last = game.plies[game.plies.length - 1];
    assert.equal(last.san, "hxg8=Q");
    assert.equal(last.uci, "h7g8q");
    assert.equal(last.color, "w");
  });

  test("handles en passant", () => {
    const game = parsePgn(EN_PASSANT);
    const last = game.plies[game.plies.length - 1];
    assert.equal(last.san, "exd6");
    assert.equal(last.uci, "e5d6");
  });

  test("a missing Result header reads as an unfinished game", () => {
    const game = parsePgn('[White "W"]\n[Black "B"]\n\n1. e4 e5');
    assert.equal(game.result, "*");
    assert.equal(game.plies.length, 2);
  });

  test("an empty PGN is an empty game, not an error", () => {
    const game = parsePgn("");
    assert.equal(game.plies.length, 0);
    assert.equal(game.finalFen, STARTING_FEN);
    assert.equal(game.result, "*");
  });

  test("clock annotations are accepted but NOT parsed into clockSeconds", () => {
    // The reader has no clock parser: importers/chesscom.ts extracts `[%clk …]`
    // itself via extractClocks(). parsePgn deliberately leaves the field null.
    const game = parsePgn(`[Result "1/2-1/2"]\n\n1. e4 {[%clk 0:03:00]} e5 {[%clk 0:02:59]} 2. Nf3 1/2-1/2`);
    assert.equal(game.plies.length, 3);
    assert.deepEqual(
      game.plies.map((p) => p.clockSeconds),
      [null, null, null]
    );
  });

  test("garbage that is not a PGN throws rather than returning a half-parsed game", () => {
    assert.throws(() => parsePgn("not a chess game at all"));
  });

  test("an illegal move inside an otherwise valid PGN throws, naming the move", () => {
    assert.throws(() => parsePgn("1. e4 e5 2. Qh5 xyz"), /xyz/);
  });
});

describe("detectPhase", () => {
  test("the first 16 plies are the opening regardless of the material left", () => {
    // A bare-kings position at ply 15 is still labelled opening: the early plies
    // are book territory and the app builds its opening report from them.
    assert.equal(detectPhase(BARE_KINGS_FEN, 0), "opening");
    assert.equal(detectPhase(BARE_KINGS_FEN, 15), "opening");
  });

  test("ply 16 flips the decision to material", () => {
    assert.equal(detectPhase(STARTING_FEN, 16), "middlegame");
  });

  test("no queens is an endgame even with lots of other material", () => {
    const noQueens = "3rk2r/8/8/8/8/4N3/8/R3KB1R w KQk - 0 1";
    assert.equal(detectPhase(noQueens, 40), "endgame");
  });

  test("six or fewer rooks/bishops/knights is the endgame boundary", () => {
    const six = "3rk2r/8/8/8/8/4N3/8/R2QKB1R w KQk - 0 1"; // 6 majors/minors + a queen
    const seven = "3rk2r/8/8/8/8/4N3/8/R2QKBNR w KQk - 0 1"; // 7 majors/minors + a queen
    assert.equal(detectPhase(six, 40), "endgame");
    assert.equal(detectPhase(seven, 40), "middlegame");
  });

  test("a full board after the opening is a middlegame", () => {
    assert.equal(detectPhase(STARTING_FEN, 20), "middlegame");
  });
});

describe("legalMoveCount", () => {
  test("counts the twenty opening moves", () => {
    assert.equal(legalMoveCount(STARTING_FEN), 20);
  });

  test("a checked king still has its escapes counted", () => {
    // Rook on e2 checks the white king on e1 with nothing else on the board.
    assert.equal(legalMoveCount("4k3/8/8/8/8/8/4r3/4K3 w - - 0 1"), 3);
  });

  test("checkmate and stalemate are zero", () => {
    assert.equal(legalMoveCount(CHECKMATE_FEN), 0);
    assert.equal(legalMoveCount(STALEMATE_FEN), 0);
  });

  test("a terminal draw is zero even though pieces could still move", () => {
    // K vs K is a draw by insufficient material; legalMoveCount reports 0 because
    // it treats isGameOver() as terminal, which is what the forced-move logic wants.
    assert.equal(legalMoveCount(BARE_KINGS_FEN), 0);
    // Same for the fifty-move rule: no move can change the result.
    assert.equal(legalMoveCount("8/8/8/4k3/8/8/8/4K3 w - - 100 200"), 0);
  });
});

describe("isCheckmate / isDraw", () => {
  test("recognises a back-rank mate", () => {
    assert.equal(isCheckmate(CHECKMATE_FEN), true);
    assert.equal(isDraw(CHECKMATE_FEN), false);
  });

  test("recognises stalemate as a draw, not a mate", () => {
    assert.equal(isCheckmate(STALEMATE_FEN), false);
    assert.equal(isDraw(STALEMATE_FEN), true);
  });

  test("recognises insufficient material", () => {
    assert.equal(isDraw(BARE_KINGS_FEN), true);
    assert.equal(isCheckmate(BARE_KINGS_FEN), false);
  });
});

describe("uciToSan", () => {
  test("translates quiet moves, captures and checks", () => {
    assert.equal(uciToSan(STARTING_FEN, "e2e4"), "e4");
    assert.equal(uciToSan(STARTING_FEN, "g1f3"), "Nf3");
    // Legal's mate: Qxf7 is mate in this position.
    assert.equal(
      uciToSan("r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4", "h5f7"),
      "Qxf7#"
    );
  });

  test("translates castling", () => {
    assert.equal(uciToSan("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1g1"), "O-O");
    assert.equal(uciToSan("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1c1"), "O-O-O");
  });

  test("translates promotion, with or without the piece suffix", () => {
    const fen = "7k/1P6/8/8/8/8/8/6K1 w - - 0 1";
    assert.equal(uciToSan(fen, "b7b8q"), "b8=Q+");
    assert.equal(uciToSan(fen, "b7b8n"), "b8=N"); // a knight on b8 does not check h8
    assert.equal(uciToSan(fen, "b7b8r"), "b8=R+"); // a rook on the eighth rank does
  });

  test("translates en passant", () => {
    assert.equal(
      uciToSan("rnbqkb1r/ppp1pppp/5n2/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3", "e5d6"),
      "exd6"
    );
  });

  test("returns null for an empty, malformed or illegal move", () => {
    assert.equal(uciToSan(STARTING_FEN, ""), null);
    assert.equal(uciToSan(STARTING_FEN, "e2"), null);
    assert.equal(uciToSan(STARTING_FEN, "zzzz"), null);
    assert.equal(uciToSan(STARTING_FEN, "e2e5"), null); // three squares
    assert.equal(uciToSan(STARTING_FEN, "e7e5"), null); // wrong side to move
  });
});

describe("sanToUci", () => {
  test("translates standard algebraic notation", () => {
    assert.equal(sanToUci(STARTING_FEN, "e4"), "e2e4");
    assert.equal(sanToUci(STARTING_FEN, "Nf3"), "g1f3");
  });

  test("translates castling and promotion, returning lowercase promotion pieces", () => {
    assert.equal(sanToUci("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "O-O"), "e1g1");
    assert.equal(sanToUci("7k/1P6/8/8/8/8/8/6K1 w - - 0 1", "b8=Q+"), "b7b8q");
  });

  test("translates en passant", () => {
    assert.equal(
      sanToUci("rnbqkb1r/ppp1pppp/5n2/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3", "exd6"),
      "e5d6"
    );
  });

  test("returns null for empty or illegal SAN", () => {
    assert.equal(sanToUci(STARTING_FEN, ""), null);
    assert.equal(sanToUci(STARTING_FEN, "Qh5"), null);
    assert.equal(sanToUci(STARTING_FEN, "zzz"), null);
  });
});

describe("attackersOf", () => {
  const fen = "4k3/8/8/3p4/4N3/8/8/4K3 w - - 0 1";

  test("reports the legal moves of the side to move that land on the square", () => {
    // The knight on e4 can capture the pawn on f6 in the capture variant below.
    assert.deepEqual(attackersOf("4k3/8/5p2/8/4N3/8/8/4K3 w - - 0 1", "f6"), [
      { piece: "n", from: "e4" },
    ]);
  });

  test("counts control of an empty square (a knight move, not just a capture)", () => {
    assert.deepEqual(attackersOf(fen, "f6"), [{ piece: "n", from: "e4" }]);
  });

  test("ignores the opponent's attacks, because only the side to move can move", () => {
    // Black's rook attacks e1, where the white king sits, but it is White's turn:
    // no white move lands on e1, so the list is empty.
    assert.deepEqual(attackersOf("4k3/8/8/8/8/8/4r3/4K3 w - - 0 1", "e1"), []);
    assert.deepEqual(attackersOf(fen, "d5"), []); // e4 is not a knight hop to d5
  });

  test("returns nothing for an unattacked square", () => {
    assert.deepEqual(attackersOf(fen, "a1"), []);
  });
});

describe("pieceValue", () => {
  test("uses the standard pawn-relative values", () => {
    assert.equal(pieceValue("p"), 1);
    assert.equal(pieceValue("n"), 3);
    assert.equal(pieceValue("b"), 3);
    assert.equal(pieceValue("r"), 5);
    assert.equal(pieceValue("q"), 9);
  });

  test("the king is worth zero: it can never be captured", () => {
    assert.equal(pieceValue("k"), 0);
  });

  test("is case-insensitive", () => {
    assert.equal(pieceValue("P"), pieceValue("p"));
    assert.equal(pieceValue("Q"), pieceValue("q"));
  });

  test("unknown or empty input is zero", () => {
    assert.equal(pieceValue("x"), 0);
    assert.equal(pieceValue(""), 0);
    assert.equal(pieceValue("pawn"), 0);
  });
});

describe("STARTING_FEN", () => {
  test("is the standard start position, and parses", () => {
    assert.equal(STARTING_FEN, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    assert.equal(legalMoveCount(STARTING_FEN), 20);
  });
});
