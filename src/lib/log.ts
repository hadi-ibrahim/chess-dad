import "server-only";

/**
 * A tiny structured logger.
 *
 * The deployment runs as a single container with no log aggregator, so the job
 * here is to put one JSON object per line on stdout, where `railway logs` and
 * anything else can read it. No dependencies, no transports, no configuration
 * beyond `LOG_LEVEL`.
 *
 * Two rules it exists to enforce:
 *
 *  1. **Never throw.** A logger that can fail a request is worse than no logger,
 *     so every field is scrubbed and serialised defensively.
 *  2. **Never leak a secret.** Anything whose key looks like a credential is
 *     replaced before it is written. This is belt-and-braces — the app does not
 *     log tokens — but a log line is the easiest place to leak one by accident.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const LEVEL_NAMES: Record<string, LogLevel> = {
  debug: "debug",
  info: "info",
  warn: "warn",
  warning: "warn",
  error: "error",
  silent: "error",
};

/** Fields whose *key* marks the value as sensitive. */
const SECRET_KEY = /token|secret|passw|api[-_]?key|authorization|cookie|credential/i;
/**
 * Exceptions to the rule above: a token *count* is not a credential.
 *
 * Without this, `promptTokens` and `totalTokens` were redacted — which silently
 * hid the LLM cost telemetry, the exact numbers that make a bill explicable.
 * This is an allowlist rather than "plural is safe", so a future `accessTokens`
 * stays redacted until someone deliberately clears it.
 */
const COUNT_KEY = /^(prompt|completion|total|cumulative|input|output|max|used)?Tokens$/i;
const REDACTED = "[redacted]";
const MAX_DEPTH = 4;

function level(): number {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  const name = LEVEL_NAMES[raw] ?? "info";
  return RANK[name];
}

/** Errors do not survive JSON.stringify, so they are flattened by hand. */
function normalise(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? String(value) : value;
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return "[depth]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.slice(0, 50).map((v) => normalise(v, depth + 1, seen));

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY.test(key) && !COUNT_KEY.test(key) ? REDACTED : normalise(v, depth + 1, seen);
  }
  return out;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  /** A logger that stamps every line with extra fields, e.g. a component or job id. */
  child(fields: Record<string, unknown>): Logger;
}

/**
 * The single place a line is emitted. Kept deliberately dumb: one `write` to
 * stdout, everything else guarded.
 */
function emit(base: Record<string, unknown>, lvl: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  if (RANK[lvl] < level()) return;
  try {
    const line = JSON.stringify({
      t: new Date().toISOString(),
      level: lvl,
      msg,
      ...base,
      ...(fields ? (normalise(fields) as Record<string, unknown>) : {}),
    });
    // stdout, not stderr: these are structured records, not crashes.
    process.stdout.write(`${line}\n`);
  } catch {
    // Serialising the log must never be the thing that breaks a request.
    try {
      process.stdout.write(`{"level":"error","msg":"log serialisation failed"}\n`);
    } catch {
      // Give up quietly.
    }
  }
}

function make(base: Record<string, unknown>): Logger {
  return {
    debug: (msg, fields) => emit(base, "debug", msg, fields),
    info: (msg, fields) => emit(base, "info", msg, fields),
    warn: (msg, fields) => emit(base, "warn", msg, fields),
    error: (msg, fields) => emit(base, "error", msg, fields),
    child: (fields) => make({ ...base, ...fields }),
  };
}

export const log: Logger = make({ service: "chessdad" });

/**
 * Rate-limit a repetitive log line.
 *
 * The worker polls a few times a second, so a persistent failure (a locked
 * database, a dead engine) would otherwise emit thousands of identical lines and
 * bury everything useful. Returns true when the caller should log this time.
 *
 * The key map is bounded: an unbounded one would be the same slow leak this
 * codebase already had in the library-sync throttle.
 */
const throttleState = new Map<string, number>();

export function throttle(key: string, everyMs = 60_000, maxKeys = 200): boolean {
  const now = Date.now();
  if (throttleState.size > maxKeys) throttleState.clear();
  const last = throttleState.get(key) ?? 0;
  if (now - last < everyMs) return false;
  throttleState.set(key, now);
  return true;
}

/**
 * Run something and log how long it took, and whether it failed. Used around
 * jobs, imports and backups — the operations whose duration an operator cares
 * about.
 */
export async function timed<T>(
  logger: Logger,
  msg: string,
  fn: () => Promise<T>,
  fields: Record<string, unknown> = {}
): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    logger.info(msg, { ...fields, ms: Date.now() - started, ok: true });
    return result;
  } catch (e) {
    logger.error(msg, { ...fields, ms: Date.now() - started, ok: false, err: e });
    throw e;
  }
}

export { REDACTED as LOG_REDACTED, normalise as logFields };
