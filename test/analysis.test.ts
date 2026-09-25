/**
 * The scoring core: win probability, per-move accuracy, move classification and
 * motif detection.
 *
 * These are the numbers the whole product rests on — the accuracy trend, the
 * weakness profile, the review screen's glyphs and the puzzle thresholds all come
 * out of this file. They are pure functions, so they are tested exhaustively,
 * including the boundaries and the precedence between the branches.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { winProb, moveAccuracy, classifyMove, detectMotif, type ClassifyInput } from "@/lib/analysis";

/** A mediocre-but-legal default, so each test only states what it is about. */
function move(overrides: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    playedUci: "e2e4",
    bestUci: "e2e4",
    cpLoss: 0,
    evalBeforeCp: 0,
    mateBefore: null,
    isForced: false,
    inBook: false,
    deliveredMate: false,
    isSacrifice: false,
    ...overrides,
  };
}

describe("winProb", () => {
  test("a level position is a coin flip", () => {
    assert.equal(winProb(0), 0.5);
  });

  test("is symmetric about zero", () => {
    for (const cp of [50, 100, 250, 400, 900, 1000]) {
      assert.ok(
        Math.abs(winProb(-cp) - (1 - winProb(cp))) < 1e-12,
        `winProb(${-cp}) should mirror winProb(${cp})`
      );
    }
  });

  test("increases with the evaluation", () => {
    const series = [-1000, -300, -100, 0, 100, 300, 1000].map(winProb);
    for (let i = 1; i < series.length; i++) {
      assert.ok(series[i] > series[i - 1], `expected ${series[i]} > ${series[i - 1]}`);
    }
  });

  test("clamps beyond +/-1000cp so mate scores cannot distort it", () => {
    assert.equal(winProb(5000), winProb(1000));
    assert.equal(winProb(-5000), winProb(-1000));
  });

  test("stays within [0,1]", () => {
    for (const cp of [-9999, -100, 0, 100, 9999]) {
      const p = winProb(cp);
      assert.ok(p >= 0 && p <= 1, `winProb(${cp}) = ${p}`);
    }
  });
});

describe("moveAccuracy", () => {
  test("a move that changes nothing scores ~100", () => {
    // The curve is fitted (103.1668 - 3.1669 = 99.9999), so a perfect move lands
    // a hair under 100 rather than exactly on it.
    const perfect = moveAccuracy(0.5, 0.5);
    assert.ok(Math.abs(perfect - 100) < 1e-3, `expected ~100, got ${perfect}`);
    assert.ok(perfect <= 100);
  });

  test("losing win probability lowers the score", () => {
    const gentle = moveAccuracy(0.6, 0.5);
    const bad = moveAccuracy(0.9, 0.4);
    assert.ok(gentle < 100 && gentle > 0, `gentle = ${gentle}`);
    assert.ok(bad < gentle, `expected ${bad} < ${gentle}`);
  });

  test("is clamped into [0,100]", () => {
    assert.equal(moveAccuracy(1, 0), 0);
    assert.ok(moveAccuracy(0, 0) <= 100);
    assert.ok(moveAccuracy(1, 1) >= 0);
  });

  test("is monotonically worse as more is given away", () => {
    const series = [0, 0.05, 0.1, 0.2, 0.4, 0.8].map((loss) => moveAccuracy(0.9, 0.9 - loss));
    for (let i = 1; i < series.length; i++) {
      assert.ok(series[i] <= series[i - 1], `expected ${series[i]} <= ${series[i - 1]}`);
    }
  });
});

describe("classifyMove", () => {
  test("delivering mate is always best", () => {
    assert.equal(classifyMove(move({ deliveredMate: true, cpLoss: 900 })), "best");
  });

  test("delivering mate outranks forced", () => {
    assert.equal(classifyMove(move({ deliveredMate: true, isForced: true })), "best");
  });

  test("a position with one legal move is forced", () => {
    assert.equal(classifyMove(move({ isForced: true, cpLoss: 300 })), "forced");
  });

  test("forced outranks a missed mate", () => {
    assert.equal(classifyMove(move({ isForced: true, mateBefore: 3, playedUci: "a2a3", bestUci: "e2e4" })), "forced");
  });

  test("missing a forced mate is a miss", () => {
    assert.equal(classifyMove(move({ mateBefore: 2, playedUci: "a2a3", bestUci: "e2e4", cpLoss: 20 })), "miss");
  });

  test("taking the mating move is not a miss", () => {
    // mateBefore set, but the played move IS the engine's choice
    assert.equal(classifyMove(move({ mateBefore: 2, playedUci: "e2e4", bestUci: "e2e4" })), "best");
  });

  test("a big loss while clearly winning is a miss", () => {
    assert.equal(classifyMove(move({ evalBeforeCp: 300, cpLoss: 200 })), "miss");
  });

  test("the same loss is only a mistake when the game was not already won", () => {
    assert.equal(classifyMove(move({ evalBeforeCp: 100, cpLoss: 200 })), "mistake");
  });

  test("book only applies when the move is nearly free", () => {
    assert.equal(classifyMove(move({ inBook: true, cpLoss: 20 })), "book");
    assert.equal(classifyMove(move({ inBook: true, cpLoss: 40 })), "good");
  });

  test("a near-free engine move is best, and a sacrifice is brilliant", () => {
    assert.equal(classifyMove(move({ cpLoss: 6, playedUci: "e2e4", bestUci: "e2e4" })), "best");
    assert.equal(
      classifyMove(move({ cpLoss: 6, playedUci: "e2e4", bestUci: "e2e4", isSacrifice: true })),
      "brilliant"
    );
  });

  test("a near-free move that differs from the engine's is great, not best", () => {
    assert.equal(classifyMove(move({ cpLoss: 6, playedUci: "d2d4", bestUci: "e2e4" })), "great");
  });

  test("walks the loss thresholds in order", () => {
    const cases: [number, ReturnType<typeof classifyMove>][] = [
      [10, "best"],
      [11, "good"],
      [50, "good"],
      [51, "inaccuracy"],
      [100, "inaccuracy"],
      [101, "mistake"],
      [300, "mistake"],
      [301, "blunder"],
      [1200, "blunder"],
    ];
    for (const [cpLoss, expected] of cases) {
      assert.equal(
        classifyMove(move({ cpLoss, evalBeforeCp: 0 })),
        expected,
        `cpLoss ${cpLoss} should classify as ${expected}`
      );
    }
  });
});

describe("detectMotif", () => {
  const base = {
    mateBefore: null as number | null,
    cpLoss: 300,
    playedUci: "d3f4",
    bestUci: "d3e5",
    bestAfterUci: "e8e7",
    fen: "4k3/8/8/4n3/8/3N4/8/4K3 w - - 0 1",
  };

  test("a missed mate is reported first", () => {
    assert.equal(detectMotif({ ...base, mateBefore: 2 }), "missed-mate");
  });

  test("nothing is reported for a quiet move", () => {
    assert.equal(detectMotif({ ...base, cpLoss: 40 }), null);
  });

  test("hanging a piece is detected when the opponent's best reply lands on it", () => {
    assert.equal(detectMotif({ ...base, bestAfterUci: "e8f4" }), "hung-piece");
  });

  test("a missed capture of a valuable piece is detected", () => {
    // bestUci d3e5 captures a knight (value 3)
    assert.equal(detectMotif(base), "missed-capture");
  });

  test("falling back to a generic tactical tag when no capture was available", () => {
    assert.equal(
      detectMotif({
        ...base,
        bestUci: "d3e5",
        fen: "4k3/8/8/8/8/3N4/8/4K3 w - - 0 1",
      }),
      "tactical"
    );
  });

  test("a capture filter of a minor piece only counts as tactical below the value bar", () => {
    // bestUci d3f4 captures nothing at all
    assert.equal(detectMotif({ ...base, bestUci: "d3f4", fen: "4k3/8/8/8/8/3N4/8/4K3 w - - 0 1" }), "tactical");
  });

  test("no played move means no motif", () => {
    assert.equal(detectMotif({ ...base, playedUci: null }), null);
  });
});
