---
type: Playbook
title: Analysis Queue
description: The durable job queue and worker pool that analyse games in the background so the app stays responsive.
tags: [architecture, queue, worker, engine, performance]
status: stable
generated: { by: chessmentor/1.0, at: 2026-09-22 }
---

# Overview

Analysing a game means running Stockfish on every position — seconds of work
per game, minutes across a library. Doing that inside an HTTP request would
block the request and lock the UI, so ChessMentor publishes each game as a
**job** onto a durable queue and a background **worker pool** consumes it.

# The queue (MQ)

`analysis_jobs` is a SQLite-backed message queue. It is transactional,
at-least-once, and survives restarts. Each job carries its game, options
(depth, explain, puzzles), status, progress, attempt count, and a lease.

| Status | Meaning |
|--------|---------|
| `queued` | Waiting for a worker |
| `running` | Claimed by a worker under a lease |
| `done` | Analysed successfully |
| `failed` | Exhausted its attempts |
| `canceled` | Canceled before it ran |

Jobs are claimed atomically inside a transaction. A lease plus periodic
heartbeats let a crashed worker's job be reclaimed; on startup any `running`
row is orphaned and requeued immediately.

# The worker pool

`workerConcurrency` loops (default `min(4, cpus − 1)`) each claim one job and
run the analysis. Because the CPU-heavy work happens in Stockfish **child
processes**, the Node event loop stays free and the HTTP server remains
responsive — pages render in a few milliseconds while games are analysed.

Concurrency is backed by an engine **pool** (`enginePoolSize`, default
`workerConcurrency + 1`): each game checks out one Stockfish process for its
whole run, so games genuinely run in parallel instead of serialising. The extra
engine keeps interactive single-game analysis from waiting behind the queue.

# Progress and control

`/api/analysis/status` reports queue depth, per-game progress, and worker
state; the UI polls it to render the live progress panel. The queue supports
cancelling pending jobs, retrying failures, and clearing finished jobs.

# Failure handling

A failed job is retried while attempts remain, then marked `failed` with its
error. Failures never block the queue, and the UI surfaces the count with a
one-click retry.
