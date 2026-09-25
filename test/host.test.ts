/**
 * Host facts: is the data directory actually a volume?
 *
 * This is the check that catches the quiet data-loss case — a container running
 * happily with its database on the container filesystem, one redeploy away from
 * an empty library. The parsing is what is worth pinning; reading the real
 * `/proc/self/mountinfo` is injected so the test does not depend on the host.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mountState } from "@/lib/host";

/** A realistic mountinfo: overlay root, a volume at /data, and /proc. */
const MOUNTINFO = [
  "21 27 0:20 / / rw,relatime - overlay overlay rw,lowerdir=/a:/b",
  "30 21 8:1 / /data rw,relatime - ext4 /dev/sdb rw",
  "31 21 0:22 / /proc rw,nosuid,nodev,noexec - proc proc rw",
].join("\n");

describe("mountState", () => {
  test("recognises a mount at the directory", () => {
    assert.equal(mountState("/data", MOUNTINFO), "mounted");
  });

  test("a plain directory inside the container is not a mount", () => {
    // The failing deployment: /app/data is just a directory on the overlay.
    assert.equal(mountState("/app/data", MOUNTINFO), "not-mounted");
  });

  test("resolves the path before comparing", () => {
    assert.equal(mountState("/data/chessdad/..", MOUNTINFO), "mounted");
  });

  test("does not match on a shared prefix", () => {
    assert.equal(mountState("/database", MOUNTINFO), "not-mounted");
  });

  test("answers 'unknown' when there is no mountinfo to read", () => {
    // Anything that is not Linux: a macOS laptop must not look like a bad deploy.
    assert.equal(mountState("/data", null), "unknown");
  });
});
