import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * Facts about the machine the app is running on.
 *
 * This exists for one failure mode: a container with **no volume mounted** at the
 * data directory looks perfectly healthy — the database is created, games import,
 * analysis runs — until the next redeploy silently destroys all of it. Nothing in
 * the app could see that before, so the deployment could not answer "is my data
 * actually on a volume?" from the outside.
 */

export type MountState = "mounted" | "not-mounted" | "unknown";

/**
 * Is `dir` itself a mount point?
 *
 * Reads `/proc/self/mountinfo`, which only exists on Linux. Anywhere else the
 * answer is **"unknown"** rather than a guess: a macOS laptop is not a broken
 * deployment, and warning about it would train the operator to ignore the warning.
 * `mountInfo` is injectable so the parsing can be tested without /proc.
 */
export function mountState(dir: string, mountInfo?: string | null): MountState {
  let info = mountInfo;
  if (info === undefined) {
    try {
      info = fs.readFileSync("/proc/self/mountinfo", "utf8");
    } catch {
      return "unknown";
    }
  }
  if (info == null) return "unknown";

  const target = path.resolve(dir);
  for (const line of info.split("\n")) {
    // mountinfo fields: id parent major:minor root mountpoint options … - fstype source super
    const fields = line.split(" ");
    if (fields.length > 4 && fields[4] === target) return "mounted";
  }
  return "not-mounted";
}

/** Are we inside a container? `/.dockerenv` is Docker's marker. */
export function inContainer(): boolean {
  return fs.existsSync("/.dockerenv") || fs.existsSync("/run/.containerenv");
}
