---
type: Playbook
title: Job Queue
description: The durable typed job queue and worker pool that run imports and engine analysis in the background so the app stays responsive.
tags: [architecture, queue, worker, engine, performance]
status: stable
generated: { by: chessdad/1.0, at: 2026-09-22 }
updated: { by: "process:okf-code-sync", at: 2026-09-23 }
sources:
  - id: queue-code
    resource: src/lib/queue.ts
    title: Chess Dad — durable job queue, leases, and retry policy
  - id: worker-code
    resource: src/lib/worker.ts
    title: Chess Dad — worker pool and job dispatch
  - id: config-code
    resource: src/lib/config.ts
    title: Chess Dad — concurrency, lease, and pool defaults
---

# Overview

**Analysing** a game is slow — Stockfish runs on every position — and doing it
inside an HTTP request would block the request and lock the UI. So analysis is
published as **jobs** onto a durable queue and executed by a background **worker
pool**.

**Fetching** a game history is not queued. It runs inside the import request,
because that request is the only place the caller's Lichess token exists: the
token lives in the browser and is handed over per call, so there is nothing for a
worker to pick up later. See [Game import](game-import.md).

# Job types

Each job stores a `type` and a JSON `payload`. There is exactly one type.

| Type | Payload | Does |
|------|---------|------|
| `analyze` | `{ gameId, depth, explain, generatePuzzles }` | Run the engine pipeline over one game |

Because a game is stored once for everyone who played it, an analysis already
pending for a game is skipped rather than queued twice — two accounts holding the
same game share the one run.

An earlier version also queued `import` jobs, which forced the caller's token to
be parked somewhere between the request and the worker. Retiring the type is what
lets the server hold no secret at all; any leftover `import` row is deleted on
startup.

# Chaining

The import request chains straight into analysis: once the games are stored, the
ones that have moves and are not yet analysed are published as `analyze` jobs, so
importing and analysing is one action rather than two. The import response
records what it did per account
(`{ source, username, imported, analysisQueued, alreadyKnown }`).

# The queue

`jobs` is a SQLite-backed message queue — transactional, at-least-once, and
surviving restarts. Alongside routing fields it tracks `status`, `progress`,
`stage`, `attempts`, `result`, and a `leased_until` timestamp.

| Status | Meaning |
|--------|---------|
| `queued` | Waiting for a worker |
| `running` | Claimed under a lease |
| `done` | Finished, with a `result` |
| `failed` | Exhausted its attempts |
| `canceled` | Canceled before it ran |

Claiming is atomic inside a transaction. A lease plus periodic heartbeats let a
crashed worker's job be reclaimed; on startup any `running` row is orphaned and
requeued immediately — the interrupted attempt is handed back rather than spent
(a restart is not a failure), unless it had already exhausted its attempts, in
which case it is marked `failed`.

# The worker pool

`workerConcurrency` loops (default `min(4, max(1, cpus − 1))`) each claim a job
and dispatch on its type. Because the CPU-heavy work happens in Stockfish
**child processes**, the Node event loop stays free and the HTTP server remains
responsive — pages render in a few milliseconds while hundreds of games are
processed.

Analysis concurrency is backed by an engine **pool** (`enginePoolSize`, default
the same derived concurrency `+ 1`): each game checks out one Stockfish process
for its whole run, so games genuinely run in parallel instead of serialising.
The extra engine keeps interactive single-game analysis from waiting behind the
queue.

# Progress and control

`/api/jobs/status` reports queue depth, per-type counts, per-job progress, and
worker state; the UI polls it to render the live progress panel. Control is
`DELETE /api/jobs?action=cancel|retry|clear` — cancelling every `queued` job,
retrying every `failed` job, or deleting every `done`/`canceled` one.

# Failure handling

A failed job is retried while attempts remain, then marked `failed` with its
error. Failures never block the queue, and the UI surfaces the count with a
one-click retry.
