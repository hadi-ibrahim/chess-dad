---
type: Playbook
title: Job Queue
description: The durable typed job queue and worker pool that run imports and engine analysis in the background so the app stays responsive.
tags: [architecture, queue, worker, engine, performance]
status: stable
generated: { by: chessmentor/1.0, at: 2026-09-22 }
---

# Overview

Two things take real time: **fetching** a game history (network, and Lichess can
throttle for a minute) and **analysing** one (running Stockfish on every
position). Doing either inside an HTTP request would block the request and lock
the UI, so both are published as **jobs** onto a durable queue and executed by a
background **worker pool**.

# Job types

One queue carries every kind of background work; each job stores a `type` and a
JSON `payload`.

| Type | Payload | Does |
|------|---------|------|
| `import` | `{ source, username, max, analyzeAfter }` | Fetch a profile's games and store their positions |
| `analyze` | `{ gameId, depth, explain, generatePuzzles }` | Run the engine pipeline over one game |

Imports are user-initiated, so they carry a higher `priority` and are claimed
ahead of a long analysis backlog. Duplicate jobs are rejected: an import already
pending for the same source+username, or an analysis already pending for a game,
is skipped rather than queued twice.

# Chaining

An `import` job with `analyzeAfter` **enqueues analysis for the games it just
brought in**, so importing and analysing is one action rather than two. The
import's result records how much it did (`{ imported, analysisQueued }`).

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
requeued immediately — without spending a retry attempt.

# The worker pool

`workerConcurrency` loops (default `min(4, cpus − 1)`) each claim a job and
dispatch on its type. Because the CPU-heavy work happens in Stockfish **child
processes**, the Node event loop stays free and the HTTP server remains
responsive — pages render in a few milliseconds while hundreds of games are
processed.

Analysis concurrency is backed by an engine **pool** (`enginePoolSize`, default
`workerConcurrency + 1`): each game checks out one Stockfish process for its
whole run, so games genuinely run in parallel instead of serialising. The extra
engine keeps interactive single-game analysis from waiting behind the queue.

# Progress and control

`/api/jobs/status` reports queue depth, per-type counts, per-job progress, and
worker state; the UI polls it to render the live progress panel. Jobs can be
cancelled while queued, retried after failing, and cleared once finished.

# Failure handling

A failed job is retried while attempts remain, then marked `failed` with its
error. Failures never block the queue, and the UI surfaces the count with a
one-click retry.
