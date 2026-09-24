import "server-only";
import { getFirstProfileId, getProfileById } from "./db";
import { PROFILE_COOKIE } from "./profile-cookie";

export { PROFILE_COOKIE };

export function parseProfileCookie(header: string | null): number | null {
  const m = (header ?? "").match(/(?:^|;\s*)cd_profile=(\d+)/);
  const id = m ? Number(m[1]) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Resolve the acting profile for a request.
 *
 * There are deliberately no accounts: the id is a browser preference, validated
 * against the database and falling back to the first profile. It selects which
 * library a page shows — it is not an access-control boundary, and the app should
 * not be exposed publicly without adding real auth first.
 */
export function activeProfileId(req: Request): number | null {
  const id = parseProfileCookie(req.headers.get("cookie"));
  if (id != null && getProfileById(id)) return id;
  return getFirstProfileId();
}
