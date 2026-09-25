import "server-only";

/**
 * A small in-process, per-IP rate limiter for the expensive endpoints.
 *
 * Why it exists: the app has no accounts, so every route is reachable by anyone
 * with the URL, and `POST /api/games/[id]/analyze` runs a whole game of Stockfish
 * inside one request. A single client looping over game ids could occupy the
 * engine pool — on a public deployment that is the realistic way to wedge the app.
 *
 * This is a **best-effort throttle, not a security boundary.** It lives in one
 * process (the app is one Node process, worker included), is keyed on an address
 * the proxy reports, and an attacker with many addresses defeats any per-IP limit.
 * The point is to stop the naive loop and bound what one caller can do.
 *
 * It deliberately **fails open** when no caller address can be determined: a
 * shared "unknown" bucket would let a proxy misconfiguration lock out every user,
 * which is worse than no limit at all.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Bound memory: a public endpoint would otherwise accumulate a bucket per address. */
const MAX_BUCKETS = 10_000;

export const LIMITS = {
  /** Runs the engine over a whole game, synchronously: the most expensive route. */
  analyze: { limit: 5, windowMs: 60_000 },
  /** Fetches up to `MAX_GAMES_PER_SOURCE` games from Lichess/Chess.com. */
  import: { limit: 5, windowMs: 60_000 },
  /** Enqueues analysis work for one or many games. */
  jobs: { limit: 30, windowMs: 60_000 },
} as const;

export type RateLimitScope = keyof typeof LIMITS;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

function prune(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Still full of live buckets: drop the oldest so memory stays bounded. That can
  // forgive an attacker who floods with distinct addresses, but a per-address
  // limit is best-effort by nature.
  while (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}

/** Count one request against `key` in a fixed window. `now` is injectable for tests. */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): RateLimitResult {
  prune(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }
  if (bucket.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  bucket.count += 1;
  return {
    ok: true,
    remaining: limit - bucket.count,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/**
 * The caller's address, as the platform's proxy reports it.
 *
 * `x-forwarded-for` may be a chain; the first entry is the client. Railway's proxy
 * sets it. If nothing is available there is nothing to key on, so this returns
 * `null` and the limiter stands down rather than lumping every caller together.
 */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || null;
}

export function rateLimited(retryAfterSeconds: number): Response {
  return Response.json(
    { error: `Too many requests. Try again in ${retryAfterSeconds}s.` },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

/**
 * Count this request against a scope's limit, returning the 429 to send back when
 * the caller has had too much. `null` means "carry on".
 */
export function enforceRateLimit(request: Request, scope: RateLimitScope): Response | null {
  const { limit, windowMs } = LIMITS[scope];
  const ip = clientIp(request);
  if (!ip) return null;
  const result = rateLimit(`${scope}:${ip}`, limit, windowMs);
  return result.ok ? null : rateLimited(result.retryAfterSeconds);
}

/** Test helper: forget every bucket. */
export function resetRateLimits(): void {
  buckets.clear();
}
