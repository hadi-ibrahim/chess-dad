import "server-only";
import { accountScope, linkAccountGames } from "./db";
import { accountsOf, identityOf, scopesOf, type BrowserProfile } from "./identity";

/**
 * Attaching an account to the games that are already stored.
 *
 * This is the whole point of keying the library by account rather than by
 * profile: when the same person opens the app in a second browser and enters the
 * accounts they already use, every game is already here and already analysed, so
 * the profile is finished the moment this runs — no fetch from Lichess, no
 * engine run, no waiting.
 */

/** Cheap guard against re-running the link on every keystroke-triggered fetch. */
const SYNC_INTERVAL_MS = 10_000;

const globalForSync = globalThis as unknown as { __chessdadSync?: Map<string, number> };

function lastSync(): Map<string, number> {
  if (!globalForSync.__chessdadSync) globalForSync.__chessdadSync = new Map();
  return globalForSync.__chessdadSync;
}

/** File every already-stored game this profile's accounts appear in. Idempotent. */
export function syncLibrary(profile: BrowserProfile, opts: { force?: boolean } = {}): number {
  const scopes = scopesOf(profile);
  if (scopes.length === 0) return 0;
  const key = scopes.join("|");
  const seen = lastSync();
  const now = Date.now();
  if (!opts.force && now - (seen.get(key) ?? 0) < SYNC_INTERVAL_MS) return 0;
  seen.set(key, now);

  let linked = 0;
  for (const account of accountsOf(profile)) {
    linked += linkAccountGames(
      accountScope(account.source, account.username),
      account.source,
      account.username
    );
  }
  return linked;
}

export interface Viewer {
  profile: BrowserProfile;
  scopes: string[];
}

/**
 * Resolve the acting viewer, or null when nobody is set up to look at a library.
 *
 * Every viewer-scoped read starts here, and the sync runs alongside it, so a
 * profile that has just been created finds its games without an extra round
 * trip.
 */
export function viewerOf(request: Request, opts: { sync?: boolean } = {}): Viewer | null {
  const profile = identityOf(request);
  if (!profile) return null;
  const scopes = scopesOf(profile);
  if (scopes.length === 0) return null;
  if (opts.sync !== false) {
    try {
      syncLibrary(profile);
    } catch {
      // Linking is an optimisation; never fail a read because of it.
    }
  }
  return { profile, scopes };
}
