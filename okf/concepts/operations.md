---
type: Reference
title: Operations
description: How Chess Dad is run — health, logs, backups and the startup sequence — and the failure modes each one exists to catch.
tags: [operations, deployment, health, logging, backup, docker]
status: draft
generated: { by: "process:okf-code-sync", at: 2026-09-24 }
updated: { by: "process:rate-limiting", at: 2026-09-25 }
sources:
  - id: rate-limit-code
    resource: src/lib/rate-limit.ts
    title: Chess Dad — the per-IP throttle on the expensive routes
  - id: health-code
    resource: src/lib/health.ts
    title: Chess Dad — health checks and the engine probe
  - id: log-code
    resource: src/lib/log.ts
    title: Chess Dad — structured logger
  - id: backup-code
    resource: src/lib/backup.ts
    title: Chess Dad — VACUUM INTO snapshots, verification and retention
  - id: instrumentation-code
    resource: src/instrumentation-node.ts
    title: Chess Dad — Node-only startup
  - id: dockerfile
    resource: Dockerfile
    title: Chess Dad — container image and pinned Stockfish
---

# Overview

Chess Dad runs as a single container: one Next.js server that also hosts the
analysis worker pool and the Stockfish processes it drives. This document covers
how that process starts, how an operator sees what it is doing, and how the one
irreplaceable thing — the database — is protected.

# Startup

`src/instrumentation.ts` is the dispatcher; all Node-only work lives in
`src/instrumentation-node.ts`, because Next compiles the former for the **Edge**
runtime too, where `process.on` and the filesystem do not exist. Splitting them is
what keeps the Edge compilation clean.

`register()` runs once per process, before traffic, and:

1. installs `unhandledRejection` / `uncaughtException` handlers (an exception exits
   the process deliberately, so the platform restarts it cleanly);
2. runs `bootProbe()` — database usable, disk space, and a **real Stockfish
   `uciok` handshake**;
3. starts the worker pool, unless `CHESSDAD_DISABLE_WORKER=1`;
4. starts the backup scheduler.

It is guarded against `NEXT_PHASE=phase-production-build` so building never starts
workers or timers, and against double-registration because dev hot-reload calls it
again.

Before this existed the worker was started lazily by whichever request happened to
hit one of four routes first — so a redeploy with jobs queued sat idle until
somebody opened a page.

# Health

`GET /api/health` returns **200** or **503** and is what the container health check
and the platform's rollout gate use. It is unauthenticated, so it reports states
and never paths, environment values or error text.

| Check | Fails when |
|---|---|
| `db` | The database cannot be opened, `PRAGMA quick_check` fails, or its directory is not writable. |
| `engine` | Stockfish does not answer `uciok` within the probe timeout. Cached for `HEALTH_ENGINE_TTL_MS`. |
| `worker` | The worker pool was never started. |
| `disk` | Under ~50 MB free, where SQLite can fail mid-write. |
| `stalled` | The worker is absent **and** the queue has work — the "jobs never run" state. |

The engine check is the important one. The app boots happily with no engine at
all: every page renders, and every analysis job dies on a 60-second timeout. A
health check that only proved the HTTP server answers would have repeated exactly
that mistake, so this one spawns the binary. The child is always killed — an
unkilled probe would leak a process per health check.

# Logging

One JSON object per line on stdout (`src/lib/log.ts`), which is what a platform log
viewer and any collector want. `LOG_LEVEL` selects verbosity. Logged: worker
start/stop, every job claim/complete/fail with duration and attempt, engine spawn
failure and exit (with the tail of its stderr, which used to be discarded
entirely), imports, and every backup. The worker polls several times a second, so
its repetitive failures go through `throttle()` and cannot bury everything else;
that throttle's key map is bounded, unlike the library-sync one it mirrors.

Errors are flattened rather than lost to `JSON.stringify` (which renders an `Error`
as `{}`), and any field whose **key** looks like a credential is replaced with
`[redacted]` before it is written.

# Backups

`VACUUM INTO` takes a consistent snapshot of a live database in one statement, with
no downtime, that stands alone (no WAL to replay). `src/lib/backup.ts` runs it on a
timer; `scripts/backup-db.mjs` does the same thing from the command line.

Every snapshot is **reopened and checked with `PRAGMA integrity_check` before
older copies are pruned**, so a corrupt backup can never displace a good one. That
ordering is the point: an unverified backup is a rumour.

A snapshot on the same volume is not a real backup. It survives a bad write or a
mistaken delete, not losing the volume — so `--out` / `BACKUP_DIR` should point at
a mounted bucket or a synced directory for anything that matters.

# Rate limiting

The app has no accounts, so every route is reachable by anyone with the URL. The
endpoints that cost real work are throttled per IP, in process
(`src/lib/rate-limit.ts`):

| Route | Limit |
|---|---|
| `POST /api/games/[id]/analyze` | 5 / minute |
| `POST /api/import` | 5 / minute |
| `POST /api/jobs` | 30 / minute |

`analyze` is the one that matters: it runs a whole game of Stockfish inside a
single request, so a loop over sequential game ids used to be a way to occupy the
engine pool. It is also now **gated** — the caller must have an active profile and
the game must be in one of its accounts' libraries — matching every other route.

Two honest limits of this:

* It is **best-effort, not a security boundary.** It lives in one process, is
  keyed on the address the proxy reports, and an attacker with many addresses
  defeats any per-IP limit. It stops the naive loop and bounds one caller.
* It **fails open** when no caller address can be determined. A shared "unknown"
  bucket would let a proxy misconfiguration lock out every user, which is worse
  than no limit; Railway's proxy sets `x-forwarded-for`, so this is a misconfig
  path, not a normal one.

Still open before a public launch: a queue-depth cap, so one importer cannot fill
the queue, and a per-account fair share of worker slots.

# Deployment invariants

* **A volume.** `CHESSDAD_DB_PATH` must point at mounted storage. The default is
  relative to the working directory, which on an ephemeral container filesystem is
  discarded on every redeploy — silently destroying every imported game and the
  analysis behind it.
* **The engine.** The image installs the same pinned Stockfish as local
  development, so a laptop and production run identical builds. See
  [Updating Stockfish](../../docs/updating-stockfish.md).
* **One replica.** The worker pool and the engine pool are per process, and
  `requeueOrphanedJobs()` resets *every* `running` row it finds, so a second replica
  steals the first one's in-flight work. Scale up, not out, until the queue moves
  off SQLite.
* **GPLv3.** Distributing the Stockfish binary in the image carries the licence's
  obligations; its `Copying.txt` is kept beside the binary.
