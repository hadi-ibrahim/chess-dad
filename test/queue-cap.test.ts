/**
 * Queue backpressure.
 *
 * `enqueueAnalyzeJobs` accepts work only while there is headroom under
 * `MAX_QUEUE_DEPTH`; past that it turns work away and says so. Nothing is lost —
 * the caller is told how many were not queued, and re-running the import re-queues
 * whatever is still pending once the queue drains.
 *
 * The cap is read from config at import time, so this file sets the environment
 * before loading the queue. `node --test` runs each file in its own process, which
 * is what makes that safe (and why the other queue tests are unaffected).
 */
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createTempDatabase, removeTempDatabase, loadQueue } from "./helpers/db";

process.env.MAX_QUEUE_DEPTH = "3";
const CAP = 3;

const tmp = createTempDatabase("queue-cap");
const q = await loadQueue();
const db = await import("@/lib/db");
const config = await import("@/lib/config");

beforeEach(() => {
  db.getDb().exec("DELETE FROM jobs");
});

after(() => removeTempDatabase(tmp.dir));

describe("queue depth cap", () => {
  test("the environment override is what the queue sees", () => {
    assert.equal(config.config.maxQueueDepth, CAP);
  });

  test("enqueues up to the cap and reports the rest as rejected", () => {
    const result = q.enqueueAnalyzeJobs([1, 2, 3, 4, 5]);

    assert.equal(result.enqueued, CAP);
    assert.equal(result.rejected, 2);
    assert.equal(result.skipped, 0);
    assert.equal(result.capped, true);
    assert.equal(q.queueDepth(), CAP);
  });

  test("a full queue turns away everything", () => {
    q.enqueueAnalyzeJobs([1, 2, 3]);
    const result = q.enqueueAnalyzeJobs([10, 11]);

    assert.equal(result.enqueued, 0);
    assert.equal(result.rejected, 2);
    assert.equal(result.capped, true);
    assert.equal(q.queueDepth(), CAP, "the queue did not grow past the cap");
  });

  test("headroom returns as the queue drains", () => {
    q.enqueueAnalyzeJobs([1, 2, 3]);
    const claimed = q.claimNextJob("test-worker", 30_000);
    assert.ok(claimed, "a worker should be able to claim a job");
    assert.equal(q.queueDepth(), 2);

    const result = q.enqueueAnalyzeJobs([10, 11]);
    assert.equal(result.enqueued, 1, "one slot of headroom");
    assert.equal(result.rejected, 1);
    assert.equal(q.queueDepth(), CAP);
  });

  test("a game that is already queued is skipped rather than rejected", () => {
    q.enqueueAnalyzeJobs([1, 2]);
    const result = q.enqueueAnalyzeJobs([1, 2]);

    assert.equal(result.enqueued, 0);
    assert.equal(result.skipped, 2);
    assert.equal(result.rejected, 0);
    assert.equal(result.capped, false, "a duplicate is not a capacity problem");
  });

  test("a repeat within one call is skipped, not queued twice", () => {
    const result = q.enqueueAnalyzeJobs([7, 7, 8]);

    assert.equal(result.enqueued, 2);
    assert.equal(result.skipped, 1);
    assert.equal(result.rejected, 0);
  });
});
