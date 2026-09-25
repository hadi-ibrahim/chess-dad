/**
 * The beginner-lesson content.
 *
 * `scripts/verify-lessons.mjs` already does the deep chess verification (only one
 * mate in one, the annotation tells the truth, the tactic really is a fork, …).
 * These tests deliberately do not duplicate that. They pin the *shape* of the
 * data — the invariants a careless edit breaks, like a quiz answer index out of
 * range or a duplicated lesson id — plus the four cheap chess invariants that
 * every move puzzle must satisfy: the solution is legal in its FEN, its LAN and
 * SAN match exactly what chess.js produces, and the side not to move is not
 * already in check (the illegal-position bug the verify script was written for).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Chess, type Square } from "chess.js";
import {
  LESSONS,
  LESSON_GROUPS,
  lessonsByGroup,
  type Lesson,
  type MovePuzzle,
  type QuizPuzzle,
} from "@/lib/lessons";

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const KEBAB_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function loadFen(fen: string): Chess {
  return new Chess(fen);
}

/** The square of the king of the side that is NOT to move, or null. */
function idleKingSquare(chess: Chess): string | null {
  const idle = chess.turn() === "w" ? "b" : "w";
  for (const row of chess.board()) {
    for (const sq of row) {
      if (sq && sq.type === "k" && sq.color === idle) return sq.square;
    }
  }
  return null;
}

/** True when the side not to move is in check — an illegal position. */
function idleKingInCheck(chess: Chess): boolean {
  const idleKing = idleKingSquare(chess);
  if (!idleKing) return false;
  return chess.attackers(idleKing as Square, chess.turn()).length > 0;
}

const movePuzzles = LESSONS.filter(
  (l): l is Lesson & { puzzle: MovePuzzle } => l.puzzle.kind === "move"
);
const quizPuzzles = LESSONS.filter(
  (l): l is Lesson & { puzzle: QuizPuzzle } => l.puzzle.kind === "quiz"
);

describe("lessons: structural invariants", () => {
  test("there is a real set of lessons", () => {
    assert.ok(LESSONS.length >= 10, `expected a real curriculum, got ${LESSONS.length}`);
    assert.equal(movePuzzles.length + quizPuzzles.length, LESSONS.length);
  });

  test("every lesson id is unique and kebab-cased", () => {
    const ids = LESSONS.map((l) => l.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate lesson id");
    for (const id of ids) assert.match(id, KEBAB_ID, `bad lesson id "${id}"`);
  });

  test("every lesson group is one of the declared groups", () => {
    for (const lesson of LESSONS) {
      assert.ok(
        LESSON_GROUPS.includes(lesson.group),
        `${lesson.id} has unknown group "${lesson.group}"`
      );
    }
  });

  test("every lesson has a non-empty title, summary and body", () => {
    for (const lesson of LESSONS) {
      assert.ok(lesson.title.trim(), `${lesson.id} has no title`);
      assert.ok(lesson.summary.trim(), `${lesson.id} has no summary`);
      assert.ok(Array.isArray(lesson.body) && lesson.body.length > 0, `${lesson.id} has no body`);
      for (const [i, para] of lesson.body.entries()) {
        assert.equal(typeof para, "string", `${lesson.id} body[${i}] is not a string`);
        assert.ok(para.trim(), `${lesson.id} body[${i}] is blank`);
      }
    }
  });

  test("declared terms are complete pairs", () => {
    for (const lesson of LESSONS) {
      if (!lesson.terms) continue;
      assert.ok(lesson.terms.length > 0, `${lesson.id} has an empty terms list`);
      for (const t of lesson.terms) {
        assert.ok(t.term.trim(), `${lesson.id} has a blank term`);
        assert.ok(t.def.trim(), `${lesson.id} term "${t.term}" has no definition`);
      }
    }
  });
});

describe("lessons: move puzzles", () => {
  test("every move puzzle has prompt, hint and explain", () => {
    for (const lesson of movePuzzles) {
      const p = lesson.puzzle;
      assert.equal(p.kind, "move");
      assert.ok(p.prompt.trim(), `${lesson.id} has no prompt`);
      assert.ok(p.hint.trim(), `${lesson.id} has no hint`);
      assert.ok(p.explain.trim(), `${lesson.id} has no explanation`);
      assert.ok(p.solutionSan.trim(), `${lesson.id} has no solutionSan`);
    }
  });

  test("solutionUci is well-formed: 4 or 5 chars, squares, optional piece", () => {
    for (const lesson of movePuzzles) {
      const uci = lesson.puzzle.solutionUci;
      assert.match(uci, UCI, `${lesson.id}: "${uci}" is not well-formed UCI`);
      assert.ok(uci.length === 4 || uci.length === 5, `${lesson.id}: "${uci}" has bad length`);
      if (uci.length === 5) {
        assert.ok("qrbn".includes(uci[4]), `${lesson.id}: "${uci}" promotes to something illegal`);
      }
    }
  });

  test("every move puzzle FEN loads", () => {
    for (const lesson of movePuzzles) {
      assert.doesNotThrow(() => loadFen(lesson.puzzle.fen), `${lesson.id} FEN does not load`);
    }
  });

  test("the solution is legal, and its LAN and SAN match chess.js exactly", () => {
    for (const lesson of movePuzzles) {
      const p = lesson.puzzle;
      const chess = loadFen(p.fen);
      const from = p.solutionUci.slice(0, 2);
      const to = p.solutionUci.slice(2, 4);
      const promotion = p.solutionUci.length === 5 ? p.solutionUci[4] : undefined;
      const move = chess.move({ from, to, promotion });
      assert.ok(move, `${lesson.id}: ${p.solutionUci} is not legal in ${p.fen}`);
      assert.equal(move.lan, p.solutionUci, `${lesson.id}: LAN mismatch`);
      assert.equal(move.san, p.solutionSan, `${lesson.id}: SAN mismatch`);
    }
  });

  test("the side NOT to move is not already in check", () => {
    // This is the illegal-position rule: a position where the idle king is in
    // check could not have arisen from a legal move, and renders as a puzzle whose
    // answer is already on the board.
    for (const lesson of movePuzzles) {
      const chess = loadFen(lesson.puzzle.fen);
      assert.equal(
        idleKingInCheck(chess),
        false,
        `${lesson.id}: the side not to move is in check in ${lesson.puzzle.fen}`
      );
    }
  });
});

describe("lessons: quiz puzzles", () => {
  test("every quiz has a non-empty question, explanation and at least two options", () => {
    for (const lesson of quizPuzzles) {
      const p = lesson.puzzle;
      assert.equal(p.kind, "quiz");
      assert.ok(p.question.trim(), `${lesson.id} has no question`);
      assert.ok(p.explain.trim(), `${lesson.id} has no explanation`);
      assert.ok(Array.isArray(p.options) && p.options.length >= 2, `${lesson.id} needs options`);
      for (const [i, option] of p.options.entries()) {
        assert.ok(option.trim(), `${lesson.id} option ${i} is blank`);
      }
    }
  });

  test("the answer index is an integer inside the options array", () => {
    for (const lesson of quizPuzzles) {
      const p = lesson.puzzle;
      assert.ok(Number.isInteger(p.answer), `${lesson.id} answer is not an integer`);
      assert.ok(p.answer >= 0, `${lesson.id} answer is negative`);
      assert.ok(
        p.answer < p.options.length,
        `${lesson.id} answer ${p.answer} is out of range for ${p.options.length} options`
      );
    }
  });

  test("an optional quiz board still loads, and the idle side is not in check", () => {
    for (const lesson of quizPuzzles) {
      const fen = lesson.puzzle.fen;
      if (!fen) continue;
      const load = () => new Chess(fen);
      assert.doesNotThrow(load, `${lesson.id} quiz FEN does not load`);
      assert.equal(
        idleKingInCheck(load()),
        false,
        `${lesson.id}: the side not to move is in check in the quiz FEN`
      );
    }
  });
});

describe("lessonsByGroup", () => {
  test("groups appear in the declared order, and every declared group has lessons", () => {
    const grouped = lessonsByGroup();
    assert.deepEqual(
      grouped.map((g) => g.group),
      LESSON_GROUPS,
      "every declared group should be non-empty and in order"
    );
  });

  test("each lesson appears exactly once, under its own group", () => {
    const grouped = lessonsByGroup();
    const seen: Lesson[] = [];
    for (const { group, lessons } of grouped) {
      assert.ok(lessons.length > 0, `${group} is empty`);
      for (const lesson of lessons) {
        assert.equal(lesson.group, group, `${lesson.id} is filed under the wrong group`);
        seen.push(lesson);
      }
    }
    assert.equal(seen.length, LESSONS.length);
    assert.equal(new Set(seen).size, LESSONS.length);
  });
});
