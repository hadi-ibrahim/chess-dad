/**
 * The cookie that remembers which profile a browser is acting as.
 *
 * Kept out of `active-profile.ts` because that module is server-only and the
 * client needs the same name to set it.
 */
export const PROFILE_COOKIE = "cd_profile";
