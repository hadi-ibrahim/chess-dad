# Chess Dad — Production Readiness Review

**Reviewed:** `chessdad` @ `893f9ce` (Next.js 16 + React 19 + SQLite/`node:sqlite` + Stockfish)
**Method:** full source read, live DB inspection (379 games / 25,555 positions), production build, exploit verification.

> **Status update — one blocker closed, the rest open.** The analysis below is the
> original snapshot and still describes the right shape of the problem. What has
> actually changed since:
>
> - **B1 (arbitrary file read) — FIXED.** The `/api/okf` route was removed together
>   with the screen that was its only consumer, and `readOkfDoc` now confines every
>   read to the bundle directory and allows only `.md` files. Verified: `GET /api/okf`
>   returns 404 and the containment guard is in place.
> - **B2 … B9, backups, and tests — ALL STILL OPEN.** No authentication, no rate
>   limiting, no deploy artifacts, no health endpoint, no volume, no worker bootstrap,
>   no logging, no backups.
>
> ⚠️ **The one item needing a human:** the leaked Lichess token is *still* recoverable
> from `data/chessdad.db` (re-verified — one `lip_…` occurrence in a freed page).
> Rotate that token at <https://lichess.org/account/oauth/token>, then `VACUUM` the
> file with `PRAGMA secure_delete = ON`. Deleting the file is not enough; the bytes
> survive until the pages are rewritten.

---

## 1. Verdict

**No — not as it stands. But the gap is small and specific, and most of it is a weekend of work.**

The *architecture* is genuinely good (see §7) — better than most hobby apps I'd expect to see.
The *security posture* is the problem, and it is not a "harden it later" problem: today the app
has no authentication boundary at all, by explicit design, and that design was chosen for a
single-tenant local-first tool. The moment it sits on a public URL, the design assumptions
stop holding.

Three things are true simultaneously:

| | |
|---|---|
| **Two exploitable bugs** | An unauthenticated **arbitrary file read**, and unauthenticated **data destruction / CPU exhaustion** endpoints. Both verified against the code, one verified against a live run. |
| **It cannot currently be deployed** | There is no Dockerfile, no `railway.json`/`fly.toml`/`Procfile`, no CI, no health endpoint, and no automated way for a fresh box to obtain Stockfish. Nothing in the repo describes how it reaches a server. |
| **The data model is a real asset** | `games` is global and shared; analysis is stored **once per game**, and two users who played each other share one row. That is the single best scaling decision in the codebase. |

If you fix the blockers in §2, this is entirely reasonable for a group of friends, and it will
comfortably hold **1,000 users at ~200 games each on one modest VPS** (§3 for storage, §9 for
sizing) — disk is not your constraint. CPU and memory are.

---

## 2. Blockers — fix before it gets a public URL

### B1. Arbitrary file read via `/api/okf?path=` — CRITICAL

`src/app/api/okf/route.ts:8-17` passes the raw query parameter straight into `path.join`:

```ts
const docPath = url.searchParams.get("path");
const doc = readOkfDoc(docPath);          // → path.join(config.okfDir, relativePath)
```

`src/lib/okf.ts:35` `path.join` **normalises `..`**, so escaping the bundle is trivial.

**Verified live** (not theoretical) — read a file outside `okf/`, and a system file:

```
GET /api/okf?path=../../../../../../etc/hosts
→ 200 {"path":"...","body":"##\n# Host Database\n..."}
```

On the real deployment `process.cwd()` is the app root, so `?path=../../../proc/self/environ`
returns the process environment — i.e. **`DEEPSEEK_API_KEY` and `LICHESS_TOKEN`**. It also
reaches `data/chessdad.db`.

**Fix**
```ts
const full = path.resolve(config.okfDir, relativePath);
const root = path.resolve(config.okfDir);
if (full !== root && !full.startsWith(root + path.sep)) return null;
```
Also allow only `.md`, and reject absolute paths. ~5 lines.

---

### B2. A real Lichess token is still recoverable from the DB file — HIGH

The schema once had a `profile_secrets(lichess_token)` table; it was dropped in the
profiles → library migration. **Dropped rows are not overwritten.** A raw scan of
`data/chessdad.db` still yields a live token:

```
... '=lichess_token lip_Hq62gM***   (1 occurrence, in a freed page)
```

`freelist_count` is 8 — the pages are genuinely free, not in use.

**Fix:** **rotate that token**, then `VACUUM;` (and set `PRAGMA secure_delete = ON;` so future
deletes are scrubbed). Do this *before* the DB file is copied anywhere.

---

### B3. No authentication, and the cookie *is* the identity — CRITICAL

`identityOf()` (`src/lib/identity.ts:21`) reads a **base64 JSON cookie with no signature**:

```
cd_profile = base64({"i":"<uuid>","n":"name","l":"lichess_user","c":"chesscom_user"})
```

The server then derives the viewer's library scope from the `l`/`c` fields
(`scopesOf` → `lichess:rooronoa`). Nothing stops a visitor writing a different one. The code
*acknowledges* this (`identity.ts:13-16`: "a **preference, not a boundary**"), which is a fair
call for a local-first single-tenant tool — but it is not a call you can make on a public
server, because the consequence is not just "reads someone's library".

Impersonation is a one-liner — `{"i":"x","n":"pwn","l":"rooronoa","c":""}` base64url-encodes to:

```
curl -b 'cd_profile=eyJpIjoieCIsIm4iOiJwd24iLCJsIjoicm9vcm9ub2EiLCJjIjoiIn0' https://host/api/games
```

Note the `id` field plays no part in authorization — only `l`/`c` choose the scopes.

| Endpoint | Guard today | Consequence |
|---|---|---|
| `GET /api/games/[id]` | cookie scope | Any user's games, PGN, and full engine analysis readable by anyone who knows a (public) Lichess/Chess.com username. |
| `DELETE /api/games/[id]` | cookie scope | Forge the cookie → **deletes the game and its analysis globally** (`unlinkGame`, `db.ts:891`, drops `games`/`positions`/`puzzles` once the last library link goes). |
| `POST /api/games/[id]/analyze` | **none at all** | Unauthenticated. Any `id` → burns CPU on Stockfish, up to `maxDuration=300`. |
| `POST /api/jobs` (`gameIds`) | **none** (`jobs/route.ts:48-50`) | Unauthenticated. Enqueue analysis for arbitrary game IDs in bulk. |
| `GET /api/jobs` | **none** | Lists jobs globally, unscoped — leaks the whole queue. |
| `DELETE /api/jobs?action=…` | **none** | **Global** cancel / clear / retry of everyone's queue. |
| `POST /api/okf/progress` | cookie scope | Writes files into `okf/progress/` under an attacker-chosen scope. |

Worth being precise about the worst one: **B1 plus B3 is the end of the story.** File read gives
you secrets; the write endpoints let an anonymous party destroy other people's analysed games.

**Fix (minimum viable):** put the app behind one shared secret. Either
(a) HTTP Basic auth via `middleware.ts` matching everything except a `/api/health`, or
(b) a signed cookie (HMAC with a server secret) so the profile can't be forged, or
(c) deploy on a platform with its own access gate and share the URL privately.

Any of these is ~30-60 minutes, and (a) is adequate for "a few friends". Also add the
`viewerOf()` check to `analyze` and to the `gameIds` branch of `POST /api/jobs`, and scope
`listJobs` by the viewer's game IDs — those are correctness bugs regardless.

---

### B4. No rate limiting or admission control anywhere — HIGH

There is no `middleware.ts`, no quota, no per-user concurrency cap, and no cap on queue depth.
`POST /api/import` will fetch and then enqueue analysis for **200 games per call, per account**,
repeatably. A single actor looping that endpoint can occupy every engine slot indefinitely.
The queue is one global FIFO with no fairness, so a burst from one user starves everyone.

**Fix:** a small in-process token bucket per IP on the mutating routes, plus a global cap on
`queued` jobs (reject when the queue is longer than, say, `20 × WORKER_CONCURRENCY`).

---

### B5. It cannot actually be deployed — HIGH

Missing, verified by search: `Dockerfile`, `docker-compose`, `railway.json`/`railway.toml`,
`fly.toml`, `render.yaml`, `vercel.json`, `Procfile`, `nixpacks.toml`, `.github/workflows`,
and any health endpoint (`grep -rn health src/` → nothing).

The AGENTS.md deployment notes describe the **Lustre** project, not this one. Chess Dad has
never been shipped.

The specific trap: **Stockfish is not obtainable in production — and the installer is broken.**
`scripts/setup-engine.mjs` is a *developer* convenience (Homebrew on macOS, or a `curl` on
Linux). It is wired into nothing: no `postinstall`, no `setup` script, no Dockerfile.
`/engines/` is gitignored and empty.

Its Linux path is **dead**, verified:

```
$ curl -sIL .../releases/latest/download/stockfish-ubuntu-x86-64-avx2.tar
final_http=404  →  .../releases/download/sf_19/stockfish-ubuntu-x86-64-avx2.tar
```

Stockfish 19 renamed its assets (`stockfish-linux-x86-64-universal.tar.gz`); the
`-ubuntu-*-avx2.tar` names no longer exist. Two further bugs follow: `curl` without `-f`
returns exit 0 on a 404 so the failure is missed, and the tarball is **nested**
(`stockfish/stockfish-linux-x86-64-universal`), so the `existsSync(engines/stockfish)` check
at line 61 matches a *directory* and the script reports success while installing nothing.

On a fresh box, `config.stockfishPath` falls back to `"stockfish"` on `PATH`
(`config.ts:24`). If absent, the app **still boots and looks healthy** — `pnpm build` needs
neither the engine nor the DB, and every API route is `force-dynamic`. Failure appears only
when the first job runs, as per-job 60-second timeouts. Worse, the spawn `error` handler
(`engine.ts:55-58`) never resets `this.proc`/`this.ready` (only the `exit` handler does, and
ENOENT emits no `exit`), so the dead engine is **released back into the pool and reused
forever**.

Also: it downloads from `releases/latest` — **unpinned, unchecksummed**, so two deploys of the
same commit can ship different engines. And shipping the Stockfish binary carries **GPLv3
obligations** (include `Copying.txt`, offer corresponding source); the app is MIT and only
talks UCI to a separate process, so the app isn't derived work — the *distribution* is what
attaches.

**Fix:** a Dockerfile that installs a **pinned, checksummed** Stockfish at image build time,
sets `STOCKFISH_PATH`, runs `next build`, and starts the server; a startup assertion that
spawns the engine and requires a `uciok`/`isready` reply, failing loudly otherwise; reset
`this.proc`/`this.ready` in the engine's `error` handler; ship the GPLv3 notice.

---

### B7. The database defaults onto the ephemeral layer — HIGH

`config.dbPath` falls back to `process.cwd()/data/chessdad.db` (`config.ts:21`). There is no
Dockerfile, no compose file, and no volume declaration, so on a container/PaaS with an
ephemeral root filesystem **the entire DB sits on a layer that is discarded on every
redeploy**. That silently destroys every user's games and all the analysis behind them — the
re-analysis alone is hours of CPU. `.env.example` leaves `CHESSDAD_DB_PATH` commented out and
never mentions `CHESSDAD_DATA_DIR` (which is dead config — unused anywhere in `src/`).

**Fix:** mount a volume, set `CHESSDAD_DB_PATH=/data/chessdad.db` explicitly, and log the
resolved path plus a writability check at boot. Combine with the backup work in §6.

---

### B8. `next start` does not start the worker — HIGH

`ensureWorkerStarted()` is called from exactly four places — `jobs/status`, both `GET`/`POST`
of `jobs`, and `import`. There is no `instrumentation.ts`, no separate worker entrypoint, and
no `register()` hook. So after a redeploy with jobs queued, **nothing processes them until a
human happens to load a page**. (`page.tsx` mounts `AnalysisQueue`, which polls
`/api/jobs/status` every 1.5 s — so an open tab does revive it.)

There's a latent version of the same hole: `void loop(slot)` (`worker.ts:72`) has no `.catch`,
and there is no `process.on("unhandledRejection")` handler anywhere — Node 22's default is to
terminate the process.

**Fix:** add `src/instrumentation.ts` calling `ensureWorkerStarted()` from `register()`, plus
an opt-out env flag for stateless web replicas, plus an `unhandledRejection` handler that logs
before exiting.

---

### B9. Zero operational visibility — HIGH (you are the operator)

`grep -rn "console\." src/` returns **0 matches**. No logger, no metrics, no error tracking,
no request logs, no `process.on` handlers. The empty catches swallow exactly what you'd need:
`engine.ts:54` discards Stockfish's stderr entirely; `worker.ts:68,86,99,113` swallow requeue,
claim, heartbeat and progress failures; `llm.ts:232` silently degrades every LLM error.

So the questions that matter have no answer from the running system: *is the worker alive? is
the engine missing? is the disk filling? is the LLM key expired?* — you cannot tell. The only
introspection is `getWorkerState()`, which reports configured values, not liveness.

**Fix:** a small JSON logger on worker start/stop, job claim/complete/fail (with id, duration,
error), engine spawn/exit, and every currently-swallowed catch; `/api/health` wired to an
uptime monitor; an alert when failed jobs increase or queue depth is non-zero with zero
running workers.

---

### B6. The LLM cache hands users each other's explanations — HIGH (correctness)

`llm_cache` is keyed on **FEN alone** (`db.ts:128`) and `explainPosition` looks up
`getLlmCache(i.fen)` (`llm.ts:220`). But the prompt input includes the *played move*, the
best move, the classification, the motif, **and the player's rating** (`analysis.ts:341-353`).

A FEN does **not** determine what move was played from it. Two players reaching the same
position and playing *different* moves get one shared explanation — either describing the
wrong move, or calibrated to the wrong rating. `analysis.ts:351` even documents the intent
("the same position is a different lesson for a 900 and a 2100") that the cache key defeats.

This is invisible today because there is effectively one user. It becomes visible — and looks
like the app is broken — as soon as a handful of people use it.

**Fix:** key on `(fen, played_uci, classification, rating_band)`. This makes the cache *less*
shareable, so budget for a somewhat larger `llm_cache` than §6 models.

---

## 3. Storage: current, and the model to 1,000 users

### What you have now

| | |
|---|---|
| Live DB file | **17.5 MiB** (`dbstat` total 17.0 MiB) |
| WAL | **+4.3 MiB** (`-shm` 32 KiB) |
| Content | 379 games · 25,555 positions · 23,566 engine rows · 3,072 LLM rows · 4 accounts (383 library links) |
| Per game | **47.1 KB** all-in |
| Positions per game | 67.4 (5–189) |

`data/` reports as 51 MiB, but ~33 MiB of that is **cruft you should not ship**: a stale
`chessdad.db.pre-profiles-*` backup (10.6 MiB + its own WAL), an orphaned `chessmentor.db`
(10.4 MiB, from before the rename), and their `-shm`/`-wal` files. Nothing prunes these.

### Where the bytes go

| Table | Bytes/game | Share | Notes |
|---|---|---|---|
| `positions` | 21,193 | 45.0% | 67.4 rows/game × ~314 B incl. two indexes |
| `engine_cache` | 15,336 | 32.6% | 62.2 rows/game; ~247 B/row — the `(fen)` PK index alone is 75 B/row |
| `llm_cache` | 6,420 | 13.6% | 8.1 rows/game; ~578 B of prose per critical position |
| `games` | 2,345 | 5.0% | PGN averages 1,461 B |
| `puzzles` | 1,016 | 2.2% | 8 rows/game, globally deduped |
| `puzzle_reviews` | 638 | 1.4% | per account × per puzzle practised |
| `library` + `opening_reviews` | 141 | 0.3% | |

### The thing to understand about growth

`engine_cache` and `llm_cache` are keyed on **FEN**, and the README frames them as globally
shared — so growth should be sub-linear. **Measured, it mostly isn't:**

- One player's 25,555 positions contain only **23,266 distinct FENs — 91% unique.** Players
  barely repeat their own positions (move numbers are in the FEN, so transpositions often
  don't even collide).
- `engine_cache` holds 62.2 rows/game against 67.4 positions/game — it *mirrors the game*.
- Cross-user sharing is real but concentrated in the first ~10-16 plies and then diverges.
  I model **15%** overlap for the engine cache and **5%** for the LLM cache (critical moments
  sit deep in the middlegame, where positions are near-unique). Friends playing each other
  helps, but it's already handled — those games share one row.

**So: storage is very close to linear in total games analysed.** Marginal cost per additional
game at scale ≈ **43 KiB** (vs 47 KiB for the first user). Do not budget on the assumption
that the caches make user #1,000 cheap; they don't.

### Projection

Assumes every user imports the same number of games.

| Users | 100 gms each | 200 | 500 | 1,000 | 2,000 |
|---|---|---|---|---|---|
| **10** | 42 MiB | 84 MiB | 211 MiB | 422 MiB | 844 MiB |
| **100** | 422 MiB | 844 MiB | 2.1 GiB | 4.1 GiB | 8.2 GiB |
| **1,000** | **4.1 GiB** | **8.2 GiB** | **20.6 GiB** | **41.2 GiB** | **82.4 GiB** |

Plus: **backups** (2× if kept on the same volume), WAL (~4-16 MiB, auto-checkpointed),
`okf/progress/*.md` (~2-3 KiB per account — negligible in size, but see §5 on the rewrite cost).

### Answer to "how much more would I need"

- **Today → a few friends (≤10 users × 200 games):** ~84 MiB of data. **Round to 1 GB of
  volume** and you will never think about it again.
- **1,000 users × 200 games (the realistic "grew a lot" case): ~8.2 GiB.** With backups and
  headroom, **provision 32-64 GB.** Even the pessimistic *1,000 users × 1,000 games* is only
  **41 GiB** — a cheap block volume.
- **The 1000× multiplier that actually bites is CPU, not disk:** 1,000 × 200 = 200,000 games ×
  68.4 engine evaluations ≈ **13.7 million** Stockfish searches. At depth 14 on 2 threads
  (~0.25 s/position) that is **~1,000 CPU-hours**, or ~40 days of one core. Spread over real
  usage it's fine; delivered as a burst it is not.

### Reclaimable redundancy (measured, ~20% of the DB)

| Item | Saving | Why it's safe |
|---|---|---|
| `positions.fen_after` | **1.37 MiB** | Verified redundant: for **25,176 / 25,176** consecutive-ply pairs, `fen_after(ply N) == fen(ply N+1)`. Fully derivable. |
| `positions.explanation/key_lesson/drill_suggestion` **and** `llm_cache` equivalents | **1.6 MiB duplicated** | The same coaching text is stored twice — once denormalised per position, once in the FEN-keyed cache. Both are read (`puzzles.ts` reads `positions.explanation`), so pick one as the source of truth. |
| `engine_cache.pv` | *not* reclaimable | I checked — 1.64 MiB, but `puzzles.ts:57` uses it to render solution lines. Keep it. |

`VACUUM` won't help beyond this — `freelist_count` is only 8 pages.

---

## 4. Security — the rest

**Done well (verified, not assumed):**
- **SQL injection: none found.** Every query is parameterised. The only interpolated SQL is
  `listJobs`'s `LIMIT ${limit}`, and `limit` is clamped to `[1, 500]` (`queue.ts:444`).
  `ORDER BY` is never user-controlled.
- **No command injection.** `spawn(config.stockfishPath, [], …)` with no `shell: true`
  (`engine.ts:51`). UCI commands are built from engine-derived FENs, not user text.
- **No SSRF.** Both importers `encodeURIComponent` the username into a fixed host
  (`lichess.ts:147,174`; `chesscom.ts:86`). The Chess.com archive URLs come from Chess.com's own
  response.
- **No XSS.** No `dangerouslySetInnerHTML` anywhere; React escapes by default.
- **Token handling is genuinely careful** — the personal Lichess token is request-scoped, and
  `settings/route.ts` deliberately exposes only a boolean. (Undermined by B2, but the design is right.)
- **Prompt injection surface is small** — the LLM prompt is built from engine output and PGN
  headers, not free-form user text, and the fallback is deterministic.
- `.env*` is gitignored, `/data/` is gitignored, no secrets are tracked in git.
- The **cookie is `SameSite=Lax`**, which blunts classic CSRF on the mutating routes.

**Still to address:**
- **No CSRF tokens.** `SameSite=Lax` covers cross-*site* POSTs but not same-site subdomains or
  older browsers. Once you add real auth (B3), add a token or require a non-simple header.
- **Error disclosure is mostly fine, but not uniform.** `okf/progress` and `jobs/[id]` return
  raw `(e as Error).message` to the client; SQLite errors can include file paths.
- **`node:sqlite` is experimental** and prints an `ExperimentalWarning` on every boot. It works
  unflagged on Node ≥ 22.13, but the API can change under you; pin the Node version.

---

## 5. Performance & scaling

**Good:** the engine pool checks out one Stockfish per game for real parallelism
(`engine.ts:172-215`); each engine serialises its own analyses through a promise chain; the
worker uses a `globalThis` singleton so hot-reload can't spawn duplicate pools
(`worker.ts:36`, `db.ts:218`); `claimNextJob` wraps `SELECT`+`UPDATE` in `BEGIN IMMEDIATE`, so
two workers cannot claim the same job (`queue.ts:195`).

**Will bite at scale:**

1. **`node:sqlite` is synchronous, and it's on the request path.** Every query blocks the
   whole event loop — HTTP responses, worker heartbeats, and lease renewals included. A slow
   aggregate stalls everything. `getJobStats` runs two `GROUP BY`s plus an `IN` subquery on
   every `/api/jobs/status` poll, and the UI polls this.

2. **`computeWeaknesses` is recomputed on every job completion, per scope.**
   `worker.ts:112` calls `writeProgressBundle(scope)` for each library the game touches, and
   that does a full `computeWeaknesses("all", [scope])` over that account's whole history —
   plus a file write. So analysing *N* games costs *O(N²)* aggregation. Fine at 379 games;
   painful at 200,000.

3. **No transaction around position writes.** `analysis.ts` calls `upsertPosition` ~134 times
   per game, once per statement — each its own WAL commit. That's why the WAL sits at 4.3 MiB.
   Wrapping the per-game writes in one `BEGIN IMMEDIATE`/`COMMIT` is a large, easy win.

4. **`queryGames` runs four correlated subqueries per row** over `positions`, filtering on
   `color` + `classification` that `idx_positions_game(game_id, ply)` doesn't cover
   (`db.ts:1009-1024`). At `pageSize=200` that's 800 sub-scans of ~67 rows each. Add a
   covering index on `positions(game_id, color, classification, centipawn_loss)`.

5. **`syncLibrary` runs as a write on read paths** (`viewerOf` → `syncLibrary`), doing an
   `INSERT OR IGNORE … SELECT` against `games`. It is throttled to once per 10 s per scope —
   but the throttle is an **unbounded `Map` that never evicts** (`library.ts:21`). A caller
   cycling distinct usernames grows it without limit. Bounded but real leak.

6. **Memory.** Default `ENGINE_POOL_SIZE = WORKER_CONCURRENCY + 1`. On 4 vCPU that's
   concurrency 3, pool 4 → 4 Stockfish × (`Hash` 64 MiB + ~20 MiB) ≈ **336 MiB**, plus Next.js
   (~250 MiB) and SQLite. Engines are spawned lazily but **never reaped**, so once used they
   stay resident. Plan **≥2 GB RAM**; a 512 MiB instance will OOM under load.

7. **`enginePoolSize` doesn't actually follow `WORKER_CONCURRENCY`.** `config.ts:30` computes
   it from `defaultConcurrency`, which comes from **CPU count** (`config.ts:13`), not from the
   `WORKER_CONCURRENCY` you set. Set `WORKER_CONCURRENCY=8` on a 12-core box and you still get a
   pool of 5; the other 3 workers block silently in `EnginePool.acquire()` instead of failing.

8. **No `PRAGMA busy_timeout`.** `getDb()` sets only `journal_mode = WAL` and
   `foreign_keys = ON` (`db.ts:224-225`). Cross-process writers hitting the `BEGIN IMMEDIATE`
   in `claimNextJob`/`insertJobs` get `SQLITE_BUSY` thrown immediately rather than waiting.

9. **`requeueOrphanedJobs()` has no `worker_id` filter** (`queue.ts:278-293`), so it blanket-resets
   *every* `running` row. It's correct for a single process (which is what it was written for),
   but it means **any second replica steals the first replica's in-flight work** on its first
   request — duplicate concurrent analysis of the same game, last-writer-wins on the same
   position rows, and it decrements `attempts` each time. This is the specific bug that makes
   horizontal scaling unsafe, on top of the SQLite/WAL-over-network-FS issues.

10. **The `jobs` table is never pruned.** `clearFinishedJobs()` only runs when a user clicks
    Clear (`queue.ts:340`). Every analysed game leaves a permanent `done` row with a result
    blob, and the UI polls a `GROUP BY type,status` plus `json_extract` scans over it every
    1.5 s. At scale this both bloats the same file as your data and slows the dashboard.

11. **Importers have no fetch timeouts.** `lichess.ts:188` is a bare `fetch` with no
    `AbortSignal`; `fetchWithBackoff` (`http.ts:42,49`) has none either. A hung upstream holds
    the request open to `maxDuration`. (Note `maxDuration` is a Vercel-ism; on a plain Node
    server it does nothing.)

**Client bundle is fine — not a concern.** Total client JS is **369 KB gzipped** across all
chunks; the largest single chunk (396 KB raw, likely Recharts) is loaded only on the Insights
route, which is code-split. No action needed.

---

## 6. Redundancy & durability

- **Single point of failure: the SQLite file. There is no backup mechanism at all** — no
  scheduled dump, no export endpoint, no replication. One corrupted file loses every user's
  entire analysed history, and re-analysing it means re-burning all that CPU.
  **This is the highest-value operational fix after the security blockers.** A nightly
  `VACUUM INTO` copy off-box is ~15 minutes of work and removes the only unrecoverable failure.
- **Jobs survive restarts correctly.** `requeueOrphanedJobs` resets `running` rows on boot
  without spending a retry attempt, and `requeueStaleJobs` catches expired leases
  (`queue.ts:278-316`). Genuinely good.
- **But the worker is inside the web process and starts lazily** — `ensureWorkerStarted()` is
  only called from `/api/jobs`, `/api/jobs/status`, and `/api/import` (`worker.ts:58`). If
  nothing hits those routes, no work is consumed. And **you cannot scale web horizontally**:
  two instances → two worker pools, two engine pools, and two processes writing one SQLite
  file over a shared filesystem. It is **not** safe to run replicas or to put the DB on NFS.
- **Restart cost is real**: an in-flight analysis dies and restarts from ply 0 (there is no
  per-position resume), so deploys during a queue drain waste CPU.
- **The build is hermetic — verified, and worth preserving.** Every API route is
  `dynamic = "force-dynamic"` and every page is a client component (even
  `review/[id]/page.tsx` is a 6-line async wrapper around a client component), so no server
  component touches the DB. `next build` does *import* `node:sqlite` (which is why you see
  `ExperimentalWarning: SQLite` several times in build logs — once per build worker), but it
  never calls `getDb()`, so it creates no `data/` directory and opens no file. One image is
  therefore portable across environments. **Caveat:** if you adopt `output: "standalone"` for a
  smaller image, `okf/` is read at runtime via `config.okfDir` and is **not** a traced import —
  standalone will silently omit it, `readOkfDoc` returns `null`, and the offline coach loses its
  knowledge grounding with no error. `COPY okf/` explicitly.

---

## 7. Architecture — the part that's genuinely good

Worth saying plainly, because it's unusual:

- **Global `games` + a thin `library(scope, game_id, player_color)` link** (`db.ts:22-58`).
  Analysis is stored once per real game, and **two users who played each other share one row
  and one engine run**. The `library_games` view derives the viewer's colour, opponent and
  accuracy per request instead of storing them (`db.ts:179-195`). This is the right model, and
  it's the reason 1,000 users is a disk *and* CPU question rather than a duplication disaster.
- **A durable job queue in SQLite** with priorities, leases, heartbeats, at-least-once
  semantics, and restart recovery — with a deliberately narrow interface "so the storage could
  be swapped for Redis/BullMQ later" (`queue.ts:12`). That seam is real and worth keeping.
- **Engine-first, LLM-second**, with a deterministic OKF-grounded fallback that never fails the
  job (`llm.ts:232-235`). The model can't hallucinate chess facts because it never evaluates.
- **Real, idempotent migrations** that fold a legacy per-profile schema into the account model,
  pick a winner per duplicate game, and rebuild the view and indexes afterwards (`db.ts:357-606`).
- Indexes are chosen deliberately (`db.ts:201-215`) and the code is unusually well commented
  about *why*, not just *what*.

The one architectural decision I'd revisit is the identity one (B3) — everything else is
sound, and the local-first choice that makes it insecure on a public server is exactly what
makes it pleasant locally. Resolve it with a gate in front rather than by rewriting the model.

---

## 8. Prioritised fix list

**Before any public URL (`~1 day)**
1. Fix the path traversal in `readOkfDoc` (B1) — 5 lines.
2. Rotate the leaked Lichess token, then `VACUUM` + `PRAGMA secure_delete=ON` (B2).
3. Put the whole app behind HTTP Basic auth via `middleware.ts` (B3) — the pragmatic choice for friends.
4. Add `viewerOf()` to `POST /api/games/[id]/analyze` and the `gameIds` branch of
   `POST /api/jobs`; scope `listJobs` (B3).
5. Mount a volume and set `CHESSDAD_DB_PATH` explicitly; log the resolved path at boot (B7).
   **Without this a single redeploy destroys every user's data.**
6. Add `/api/health` + a `Dockerfile` that installs a **pinned, checksummed** Stockfish and sets
   `STOCKFISH_PATH`; assert `uciok` at boot and fail loudly if the engine won't spawn (B5).
   Fix the dead download URL and the nested-tarball path check in `setup-engine.mjs`.
7. `src/instrumentation.ts` with `register()` → `ensureWorkerStarted()` (B8).
8. A nightly `VACUUM INTO` backup, copied off-box (§6).
9. A minimal logger on job claim/complete/fail and engine spawn/exit; `/api/health` on an
   uptime monitor (B9).

**Before you tell 50 people (`~1 weekend)**
10. Per-IP token bucket on mutating routes + a global queue-depth cap (B4).
11. Re-key `llm_cache` on `(fen, played_uci, classification, rating_band)` (B6).
12. Wrap per-game position writes in one transaction (§5.3).
13. Add the covering index on `positions(game_id, color, classification, centipawn_loss)` (§5.4).
14. Debounce/skip `writeProgressBundle` — recompute per account on a timer, not per job (§5.2).
15. Bound the `syncLibrary` throttle map (§5.5); add `PRAGMA busy_timeout = 5000` (§5.8).
16. Derive `enginePoolSize` from `WORKER_CONCURRENCY`, and validate config at boot instead of
    silently falling back (`config.ts:7-10,30,43`) (§5.7).
17. Reset `this.proc`/`this.ready` in the engine's `error` handler so a dead engine isn't
    returned to the pool (`engine.ts:55-58`).
18. Add fetch timeouts to both importers (§5.11).
19. Delete the stale `data/*.pre-profiles*`, `chessmentor.db*` files; add retention.

**Before 1,000 users (later)**
20. Prune the `jobs` table on a retention window (§5.10); it currently grows forever.
21. Move the worker into its own process so web can scale independently, and so deploys don't
    kill in-flight analysis. Fix `requeueOrphanedJobs` to filter by `worker_id` first (§5.9).
22. Per-position resume in `analyzeGame` so a restart doesn't redo 68 evaluations.
23. Migrate to Postgres (or Turso/libSQL) when you need replicas — the queue interface and the
    global-games model both port cleanly (though note `getDb()` is called directly throughout,
    so the "swappable storage" comment in `queue.ts:9-12` overstates the existing seam).
24. Drop `positions.fen_after` (~20% of DB) and de-duplicate the explanation text (§3).

**Also worth knowing:** there is **no test suite** — no test files, no test runner, no CI. For an
app whose correctness rests on centipawn arithmetic and a shared global cache, that's the
biggest long-term risk after security. `npm test` doesn't exist despite the instinct to run it.

---

## 9. Hardware call

**Footprint, measured (correcting two common overestimates):**

| Thing | Actual |
|---|---|
| `.next` on disk | 220 MB — but **187 MB is `.next/cache`** (Turbopack) and 20 MB is `.next/dev`. The shipping payload is `.next/server` 15 MB + `.next/static` 1.3 MB ≈ **18 MB**. |
| `node_modules` | 694 MB locally, but that's pnpm hardlinks. Without `output: "standalone"` a container must ship it → ~1 GB transient. |
| Stockfish binary | ~81 MB compressed (current official Linux universal asset). |

Per Stockfish process: `ENGINE_HASH_MB=64` + a few MB. Engines are created lazily, so only as
many as are simultaneously in use.

| Host | concurrency / pool | peak RSS | SF threads |
|---|---|---|---|
| 2 vCPU | 1 / ≤2 | ~350-400 MB | ≤2 |
| 4 vCPU | 3 / ≤4 | ~500 MB | ≤6 |
| 12 vCPU | 4 / ≤5 | ~550-700 MB | ≤8 |

**Recommendation: one 2 vCPU / 2 GB / 40 GB SSD instance.** That covers friends indefinitely
and 1,000 users × 200 games (~8 GiB of data) with room for backups. Do **not** use a
scale-to-zero/serverless platform — the worker lives in the web process and only starts on a
request, so a scaled-to-zero instance processes nothing until someone visits.

```
CHESSDAD_DB_PATH=/data/chessdad.db   # on a mounted volume — non-negotiable
STOCKFISH_PATH=/app/engines/stockfish
WORKER_CONCURRENCY=1                 # 2 vCPU → 1 avoids oversubscription
ENGINE_POOL_SIZE=2                   # set explicitly; the default ignores WORKER_CONCURRENCY
ENGINE_THREADS=2
ENGINE_HASH_MB=32                    # 64 is fine at 4 GB+
ANALYSIS_DEPTH=14                    # 16-18 roughly doubles CPU per game
LLM_PROVIDER=off                     # the offline OKF coach is good enough to launch on
```

Add a hard cap on queued jobs and a per-IP limit on `/api/import`, or the first person who
clicks "Analyze all" on 200 games owns the box until it drains. Build somewhere with ≥2 GB
RAM — Turbopack will not build comfortably on a 512 MB VPS.
