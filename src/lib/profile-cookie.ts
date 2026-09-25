/**
 * The browser's profile, carried in a cookie.
 *
 * Kept out of `identity.ts` on purpose: that module is server-only, and the
 * client needs the same encoding to write the cookie and read it back for the
 * Profiles screen. There is no profile row on the server any more — the browser
 * is the only place a person is written down.
 */

export const PROFILE_COOKIE = "cd_profile";

export interface BrowserProfile {
  /** Random and client-generated. Scopes which local profile is active. */
  id: string;
  /** What to call this player in the UI. */
  name: string;
  lichess: string;
  chesscom: string;
}

/** Short JSON keys: this rides on every request, so keep it small. */
interface Packed {
  i: string;
  n: string;
  l: string;
  c: string;
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeProfile(profile: BrowserProfile): string {
  const packed: Packed = {
    i: profile.id,
    n: profile.name ?? "",
    l: profile.lichess ?? "",
    c: profile.chesscom ?? "",
  };
  return toBase64Url(JSON.stringify(packed));
}

export function decodeProfile(raw: string | null | undefined): BrowserProfile | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(raw)) as Partial<Packed>;
    if (!parsed || typeof parsed !== "object" || !parsed.i) return null;
    return {
      id: String(parsed.i),
      name: typeof parsed.n === "string" ? parsed.n : "",
      lichess: typeof parsed.l === "string" ? parsed.l : "",
      chesscom: typeof parsed.c === "string" ? parsed.c : "",
    };
  } catch {
    // A hand-edited or truncated cookie is simply "nobody is active".
    return null;
  }
}

/** Read the active profile out of a `Cookie:` header (or `document.cookie`). */
export function profileFromCookieHeader(header: string | null): BrowserProfile | null {
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;\\s*)${PROFILE_COOKIE}=([^;]+)`));
  return match ? decodeProfile(match[1]) : null;
}

/**
 * The active profile lives a year. It is a preference, not a session, and losing
 * it on every browser restart would look like the app forgot the user.
 */
export function profileCookie(profile: BrowserProfile): string {
  return `${PROFILE_COOKIE}=${encodeProfile(profile)}; path=/; max-age=31536000; samesite=lax`;
}

export function clearedProfileCookie(): string {
  return `${PROFILE_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

/** A new local profile id. `crypto.randomUUID` is available in every target. */
export function newProfileId(): string {
  return crypto.randomUUID();
}

export function emptyProfile(id: string = newProfileId()): BrowserProfile {
  return { id, name: "", lichess: "", chesscom: "" };
}

export function profileLabel(profile: BrowserProfile): string {
  return (
    profile.name.trim() || profile.lichess.trim() || profile.chesscom.trim() || "This player"
  );
}
