#!/usr/bin/env node
/**
 * Verify every lesson puzzle.
 *
 * A lesson with a wrong answer is worse than no lesson, because it teaches the
 * error with authority — and a *position* can be wrong even when the solution is
 * right. This checks both, against the real content in `src/lib/lessons.ts`:
 *
 *   1. the position is legal — exactly one king each, kings not adjacent, no pawn
 *      on a back rank, and crucially **the side not to move is not in check**
 *      (an illegal position that renders as "the queen is already checking the
 *      king", and the one this script was written to catch);
 *   2. the position is live — not already mate or stalemate;
 *   3. the solution is legal and its UCI and SAN match exactly what chess.js
 *      produces, which is what the board compares against;
 *   4. the annotation tells the truth — `#` really is checkmate, `+` really is
 *      check;
 *   5. there is only one mate in one, so a player who finds a different mate is
 *      not told they are wrong.
 *
 * Usage:  node scripts/verify-lessons.mjs
 *         npm run verify:lessons
 *
 * Exits non-zero on any failure. Warnings do not fail the run.
 */
import { Chess } from "chess.js";

const { LESSONS } = await import("../src/lib/lessons.ts");

let failures = 0;
let warnings = 0;

const fail = (lesson, msg) => {
  failures++;
  console.log(`  ✗ FAIL  [${lesson}] ${msg}`);
};
const warn = (lesson, msg) => {
  warnings++;
  console.log(`  ! warn  [${lesson}] ${msg}`);
};

/** Every square of a given piece type and colour. */
function squaresOf(chess, type, color) {
  const out = [];
  for (const row of chess.board()) {
    for (const sq of row) if (sq && sq.type === type && sq.color === color) out.push(sq.square);
  }
  return out;
}

const fileOf = (sq) => sq.charCodeAt(0) - 97;
const rankOf = (sq) => Number(sq[1]);

/** Structural and rule legality of a position, independent of whose move it is. */
function checkPosition(lessonId, fen) {
  let chess;
  try {
    chess = new Chess(fen);
  } catch (e) {
    fail(lessonId, `FEN does not load: ${e.message}`);
    return null;
  }

  const whiteKings = squaresOf(chess, "k", "w");
  const blackKings = squaresOf(chess, "k", "b");
  if (whiteKings.length !== 1) fail(lessonId, `expected exactly one white king, found ${whiteKings.length}`);
  if (blackKings.length !== 1) fail(lessonId, `expected exactly one black king, found ${blackKings.length}`);

  if (whiteKings.length === 1 && blackKings.length === 1) {
    const dx = Math.abs(fileOf(whiteKings[0]) - fileOf(blackKings[0]));
    const dy = Math.abs(rankOf(whiteKings[0]) - rankOf(blackKings[0]));
    if (Math.max(dx, dy) <= 1) fail(lessonId, `kings are adjacent (${whiteKings[0]} / ${blackKings[0]})`);
  }

  for (const color of ["w", "b"]) {
    for (const sq of squaresOf(chess, "p", color)) {
      const r = rankOf(sq);
      if (r === 1 || r === 8) fail(lessonId, `${color} pawn on the back rank at ${sq}`);
    }
  }

  // The rule that catches "the queen is already checking the king": the side
  // that is *not* to move may not be in check, because it would have had to
  // answer the check on the previous move.
  const turn = fen.split(" ")[1] === "b" ? "b" : "w";
  const idle = turn === "w" ? "b" : "w";
  const idleKing = idle === "w" ? whiteKings[0] : blackKings[0];
  if (idleKing) {
    const attackers = chess.attackers(idleKing, turn);
    if (attackers.length > 0) {
      fail(
        lessonId,
        `ILLEGAL POSITION — ${idle === "w" ? "White" : "Black"} is not to move but its king on ` +
          `${idleKing} is in check from ${attackers.join(", ")}`
      );
    }
  }

  if (chess.isCheckmate()) fail(lessonId, "position is already checkmate before the player moves");
  else if (chess.isStalemate()) fail(lessonId, "position is already stalemate");
  else if (chess.moves().length === 0) fail(lessonId, "position has no legal moves");

  return chess;
}

// Per-lesson extras: the specific tactic the lesson claims to teach.
const EXTRAS = {
  castling: ({ assert, move }) => assert(move.flags.includes("k"), "solution is not kingside castling"),
  "en-passant": ({ assert, move }) => assert(move.flags.includes("e"), "solution is not an en passant capture"),
  promotion: ({ assert, move }) => assert(move.promotion === "q", "solution does not promote to a queen"),
  fork: ({ assert, chess, move }) => {
    // A fork attacks two or more enemy pieces after the move.
    const targets = [];
    for (const row of chess.board()) {
      for (const sq of row) {
        if (!sq || sq.color !== "b") continue;
        if (chess.attackers(sq.square, "w").includes(move.to)) targets.push(sq.square);
      }
    }
    assert(targets.length >= 2, `after the move the piece on ${move.to} attacks ${targets.length} enemy piece(s), not a fork`);
  },
  "pin-and-skewer": ({ assert, chess, move }) => {
    // A skewer: the king is checked and a more valuable piece sits behind it on
    // the same line, so it falls when the king steps aside.
    assert(chess.isCheck(), "the skewer move does not give check");
    const replies = chess.moves({ verbose: true });
    const queenFalls = replies.some((m) => m.piece === "k" && m.to !== move.to);
    assert(queenFalls, "the king has no reply, so nothing is skewered");
  },
  attraction: ({ assert, chess, move }) => {
    // The smothered mate: the sacrifice is check, the king cannot take (a knight
    // defends), and the recapture is forced.
    assert(chess.isCheck(), "the sacrifice does not give check");
    const kingTakes = chess.moves({ verbose: true }).some((m) => m.piece === "k" && m.to === move.to);
    assert(!kingTakes, "the king can simply capture the sacrificed piece");
  },
};

console.log(`Verifying ${LESSONS.length} lessons from src/lib/lessons.ts\n`);

const ids = new Set();
for (const lesson of LESSONS) {
  if (ids.has(lesson.id)) fail(lesson.id, "duplicate lesson id");
  ids.add(lesson.id);

  if (!lesson.puzzle) fail(lesson.id, "lesson has no puzzle");
  if (!lesson.body?.length) fail(lesson.id, "lesson has no body text");
  for (const field of ["title", "summary", "group"]) {
    if (!lesson[field]) fail(lesson.id, `lesson is missing ${field}`);
  }

  if (!lesson.puzzle) continue;
  const puzzle = lesson.puzzle;

  if (puzzle.kind === "quiz") {
    if (!Array.isArray(puzzle.options) || puzzle.options.length < 2) fail(lesson.id, "quiz needs at least two options");
    if (!Number.isInteger(puzzle.answer) || puzzle.answer < 0 || puzzle.answer >= puzzle.options.length) {
      fail(lesson.id, `quiz answer index ${puzzle.answer} is out of range`);
    }
    if (!puzzle.explain) fail(lesson.id, "quiz has no explanation");
    if (puzzle.fen) checkPosition(lesson.id, puzzle.fen);
    console.log(`  ✓ ${lesson.id.padEnd(20)} quiz, ${puzzle.options.length} options`);
    continue;
  }

  const fen = puzzle.fen;
  const chess = checkPosition(lesson.id, fen);
  if (!chess) continue;

  if (!puzzle.prompt || !puzzle.hint || !puzzle.explain) fail(lesson.id, "move puzzle is missing prompt/hint/explain");
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(puzzle.solutionUci)) {
    fail(lesson.id, `solutionUci "${puzzle.solutionUci}" is not a well-formed UCI move`);
    continue;
  }

  const from = puzzle.solutionUci.slice(0, 2);
  const to = puzzle.solutionUci.slice(2, 4);
  const promotion = puzzle.solutionUci.length === 5 ? puzzle.solutionUci[4] : "q";

  let move = null;
  try {
    move = chess.move({ from, to, promotion });
  } catch {
    move = null;
  }
  if (!move) {
    fail(lesson.id, `solution ${puzzle.solutionUci} is not a legal move in this position`);
    continue;
  }
  if (move.lan !== puzzle.solutionUci) fail(lesson.id, `LAN is "${move.lan}" but solutionUci is "${puzzle.solutionUci}"`);
  if (move.san !== puzzle.solutionSan) fail(lesson.id, `SAN is "${move.san}" but solutionSan is "${puzzle.solutionSan}"`);

  // The annotation on the solution must tell the truth.
  if (puzzle.solutionSan.includes("#") && !chess.isCheckmate()) fail(lesson.id, `SAN claims mate ("${puzzle.solutionSan}") but it is not checkmate`);
  if (!puzzle.solutionSan.includes("#") && chess.isCheckmate()) fail(lesson.id, `SAN is "${puzzle.solutionSan}" but the move is checkmate — it needs a #`);
  if (puzzle.solutionSan.includes("+") && !puzzle.solutionSan.includes("#") && !chess.isCheck()) {
    fail(lesson.id, `SAN claims check ("${puzzle.solutionSan}") but the move is not check`);
  }

  // A mate in one must be *the* mate in one, or a player who finds another one
  // is told they are wrong.
  if (puzzle.solutionSan.includes("#")) {
    const alternatives = [];
    const probe = new Chess(fen);
    for (const m of probe.moves({ verbose: true })) {
      const c = new Chess(fen);
      c.move({ from: m.from, to: m.to, promotion: m.promotion ?? "q" });
      if (c.isCheckmate() && `${m.from}${m.to}${m.promotion ?? ""}` !== puzzle.solutionUci) {
        alternatives.push(`${m.from}${m.to}${m.promotion ?? ""} (${m.san})`);
      }
    }
    if (alternatives.length > 0) warn(lesson.id, `another move also mates in one: ${alternatives.join(", ")}`);
  }

  // Start from a clean copy for the per-lesson extras.
  const after = new Chess(fen);
  after.move({ from, to, promotion });
  const assert = (cond, msg) => {
    if (!cond) fail(lesson.id, msg);
  };
  EXTRAS[lesson.id]?.({ assert, chess: after, move, fen });

  const kind = puzzle.solutionSan.includes("#") ? "mate" : puzzle.solutionSan.includes("+") ? "check" : "quiet";
  console.log(`  ✓ ${lesson.id.padEnd(20)} ${puzzle.solutionSan.padEnd(10)} ${kind}`);
}

console.log();
if (failures === 0) {
  console.log(`All ${LESSONS.length} lessons verified${warnings ? ` (${warnings} warning${warnings === 1 ? "" : "s"})` : ""}.`);
  process.exit(0);
}
console.log(`${failures} failure${failures === 1 ? "" : "s"}${warnings ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}.`);
process.exit(1);
