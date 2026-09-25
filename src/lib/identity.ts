import "server-only";
import { profileFromCookieHeader, type BrowserProfile } from "./profile-cookie";
import { accountScope } from "./db";

/**
 * Who a request is acting as.
 *
 * There are deliberately no accounts and no server-side profiles: the browser
 * sends its own profile in the `cd_profile` cookie, and the server reads it. That
 * is why the app can be published without a user table to leak, and why one
 * person setting up a second browser does not disturb anybody else.
 *
 * It remains a **preference, not a boundary** — the cookie names which library a
 * page shows, and nothing stops a visitor from writing a different one. The
 * library is keyed by public account name, so this reveals no more than the
 * games themselves already do.
 */

export type { BrowserProfile };

export function identityOf(request: Request): BrowserProfile | null {
  return profileFromCookieHeader(request.headers.get("cookie"));
}

export interface Account {
  source: "lichess" | "chesscom";
  username: string;
}

/** The accounts a profile plays under. Either, both, or none. */
export function accountsOf(profile: BrowserProfile): Account[] {
  const accounts: Account[] = [];
  if (profile.lichess.trim()) accounts.push({ source: "lichess", username: profile.lichess.trim() });
  if (profile.chesscom.trim()) accounts.push({ source: "chesscom", username: profile.chesscom.trim() });
  return accounts;
}

/**
 * The library keys this profile reads from: `lichess:rooronoa` and so on. Every
 * viewer-scoped query is built from these.
 */
export function scopesOf(profile: BrowserProfile): string[] {
  return accountsOf(profile).map((a) => accountScope(a.source, a.username));
}

export function labelOf(profile: BrowserProfile): string {
  return profile.name.trim() || profile.lichess.trim() || profile.chesscom.trim() || "Player";
}
