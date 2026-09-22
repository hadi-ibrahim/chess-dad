import "server-only";

export const USER_AGENT = "ChessMentor/1.0 (open-source chess tutor)";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse a `Retry-After` header (delta-seconds or HTTP date) into milliseconds. */
export function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

export interface BackoffOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (info: { attempt: number; delayMs: number; status: number }) => void;
}

/**
 * `fetch()` with bounded exponential backoff for 429 / 5xx responses.
 *
 * Lichess throttles anonymous game exports aggressively and advertises the wait
 * in `Retry-After`; honoring it (up to `maxDelayMs`, ~one Lichess window) lets a
 * single import ride out the throttle instead of failing outright.
 */
export async function fetchWithBackoff(
  url: string,
  init: RequestInit = {},
  options: BackoffOptions = {}
): Promise<Response> {
  const retries = options.retries ?? 2;
  const base = options.baseDelayMs ?? 1500;
  const maxDelay = options.maxDelayMs ?? 65_000;

  let res = await fetch(url, init);
  for (let attempt = 1; attempt <= retries; attempt++) {
    if (res.status !== 429 && res.status < 500) return res;
    const retryAfter = parseRetryAfterMs(res.headers.get("retry-after"));
    const delayMs = Math.min(maxDelay, retryAfter ?? base * 2 ** (attempt - 1));
    options.onRetry?.({ attempt, delayMs, status: res.status });
    await sleep(delayMs);
    res = await fetch(url, init);
  }
  return res;
}
