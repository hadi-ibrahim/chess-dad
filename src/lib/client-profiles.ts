import {
  clearedProfileCookie,
  emptyProfile,
  newProfileId,
  profileCookie,
  profileFromCookieHeader,
  type BrowserProfile,
} from "./profile-cookie";
import { normaliseConnections, type LlmConnection } from "./llm-providers";

/**
 * Profiles the browser owns.
 *
 * The list lives in `localStorage` and the acting one rides the `cd_profile`
 * cookie, so the server never has a row about anybody. Clearing site data
 * removes them, which is the intended trade: nothing to leak, nothing shared
 * with the next visitor to the deployment.
 *
 * The **Lichess token** and every **LLM API key** are stored here too, keyed by
 * profile id. The token only ever travels on an import request; a provider key
 * only ever travels on the one AI request that needs it. `encodeProfile`
 * whitelists the four public profile fields, so neither can pick up a cookie by
 * accident.
 */

const STORAGE_KEY = "chessdad.profiles";

export interface StoredProfile extends BrowserProfile {
  /** Lichess personal API token. Never sent anywhere except an import call. */
  token: string;
  /** AI provider connections for this profile. Keys are sent only on an AI call. */
  llm: LlmConnection[];
  /** Which connection the review screen preselects. Empty = first one. */
  defaultLlmId: string;
}

function isProfile(value: unknown): value is Partial<StoredProfile> {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return typeof p.id === "string" && p.id.length > 0;
}

export function loadProfiles(): StoredProfile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isProfile).map((p) => ({
      id: p.id as string,
      name: String(p.name ?? ""),
      lichess: String(p.lichess ?? ""),
      chesscom: String(p.chesscom ?? ""),
      token: String(p.token ?? ""),
      // Junk or hand-edited entries are dropped rather than trusted.
      llm: normaliseConnections(p.llm),
      defaultLlmId: String(p.defaultLlmId ?? ""),
    }));
  } catch {
    return [];
  }
}

export function saveProfiles(profiles: StoredProfile[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

/** The profile this browser is acting as, read back out of the cookie. */
export function activeProfile(): BrowserProfile | null {
  if (typeof document === "undefined") return null;
  return profileFromCookieHeader(document.cookie);
}

export function setActiveProfile(profile: BrowserProfile): void {
  document.cookie = profileCookie(profile);
}

export function clearActiveProfile(): void {
  document.cookie = clearedProfileCookie();
}

export function createProfile(
  name: string,
  lichess: string,
  chesscom: string,
  token: string,
  llm: LlmConnection[] = [],
  defaultLlmId = ""
): StoredProfile {
  return { ...emptyProfile(newProfileId()), name, lichess, chesscom, token, llm, defaultLlmId };
}

/** The stored token for whichever profile is acting, for the import call. */
export function activeToken(): string {
  const active = activeProfile();
  if (!active) return "";
  return loadProfiles().find((p) => p.id === active.id)?.token ?? "";
}

/** The acting profile's AI connections, for the review screen's provider picker. */
export function activeLlmConnections(): LlmConnection[] {
  const active = activeProfile();
  if (!active) return [];
  return loadProfiles().find((p) => p.id === active.id)?.llm ?? [];
}

/** The acting profile's chosen default connection id, or "". */
export function activeDefaultLlmId(): string {
  const active = activeProfile();
  if (!active) return "";
  return loadProfiles().find((p) => p.id === active.id)?.defaultLlmId ?? "";
}

/** Keep the cookie in step after an edit to the profile currently in use. */
export function refreshCookie(profile: BrowserProfile): void {
  const current = activeProfile();
  if (current && current.id === profile.id) setActiveProfile(profile);
}
