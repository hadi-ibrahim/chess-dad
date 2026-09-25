/**
 * The client-safe scoring helpers. `winProb` here is the same sigmoid the server
 * analysis uses, duplicated so the review screen can render a position's win
 * probability without pulling in `server-only`. If the two drift, the number on
 * screen stops matching the number stored on the move — so the shape and clamps
 * are pinned.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { winProb, fmtCp } from "@/lib/score";

describe("winProb", () => {
  test("a level position is a coin flip", () => {
    assert.equal(winProb(0), 0.5);
  });

  test("uses the logistic curve, so +400cp is 10/11", () => {
    assert.ok(Math.abs(winProb(400) - 10 / 11) < 1e-12, `got ${winProb(400)}`);
    assert.ok(Math.abs(winProb(-400) - 1 / 11) < 1e-12, `got ${winProb(-400)}`);
  });

  test("is symmetric about zero", () => {
    for (const cp of [1, 50, 100, 250, 400, 900, 1000]) {
      assert.ok(
        Math.abs(winProb(-cp) - (1 - winProb(cp))) < 1e-12,
        `winProb(${-cp}) should mirror winProb(${cp})`
      );
    }
  });

  test("increases monotonically with the evaluation", () => {
    const series = [-1000, -300, -100, -50, 0, 50, 100, 300, 1000].map(winProb);
    for (let i = 1; i < series.length; i++) {
      assert.ok(series[i] > series[i - 1], `expected ${series[i]} > ${series[i - 1]}`);
    }
  });

  test("clamps beyond +/-1000cp so mate sentinels cannot distort it", () => {
    assert.equal(winProb(5000), winProb(1000));
    assert.equal(winProb(-5000), winProb(-1000));
    assert.equal(winProb(100000), winProb(1000));
  });

  test("stays strictly inside (0,1) at the clamps", () => {
    for (const cp of [-1000, 0, 1000]) {
      const p = winProb(cp);
      assert.ok(p > 0 && p < 1, `winProb(${cp}) = ${p}`);
    }
  });
});

describe("fmtCp", () => {
  test("renders pawns with two decimals and an explicit sign", () => {
    assert.equal(fmtCp(0), "+0.00");
    assert.equal(fmtCp(100), "+1.00");
    assert.equal(fmtCp(250), "+2.50");
    assert.equal(fmtCp(1), "+0.01");
    assert.equal(fmtCp(-100), "-1.00");
    assert.equal(fmtCp(-50), "-0.50");
    assert.equal(fmtCp(-1), "-0.01");
    assert.equal(fmtCp(12345), "+123.45");
  });

  test("negative zero still renders as positive zero", () => {
    assert.equal(fmtCp(-0), "+0.00");
  });

  test("rounds to the nearest centipawn", () => {
    // 0.005 of a pawn rounds up under IEEE-754's representation of 0.005.
    assert.equal(fmtCp(0.5), "+0.01");
    assert.equal(fmtCp(-0.5), "-0.01");
  });
});
