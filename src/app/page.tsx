"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ImportForm from "@/components/ImportForm";
import AnalysisQueue from "@/components/AnalysisQueue";

interface Game {
  id: number;
  source: string;
  white: string;
  black: string;
  white_rating: number | null;
  black_rating: number | null;
  result: string;
  speed: string;
  eco: string;
  opening_name: string;
  played_at: string | null;
  player_color: "w" | "b";
  player_rating: number | null;
  opponent: string;
  opponent_rating: number | null;
  analyzed: number;
  accuracy: number | null;
  total_plies: number;
}

const SPEEDS = ["bullet", "blitz", "rapid", "classical"];
const PAGE_SIZES = [25, 50, 100, 200];

const field =
  "rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500";

export default function Home() {
  const [games, setGames] = useState<Game[]>([]);
  const [total, setTotal] = useState(0);
  const [analyzedInView, setAnalyzedInView] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [pending, setPending] = useState(0);
  const [queuedIds, setQueuedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  // Filters
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [source, setSource] = useState("");
  const [speed, setSpeed] = useState("");
  const [result, setResult] = useState("");
  const [color, setColor] = useState("");
  const [analyzedFilter, setAnalyzedFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(timer);
  }, [q]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
    if (source) params.set("source", source);
    if (speed) params.set("speed", speed);
    if (result) params.set("result", result);
    if (color) params.set("color", color);
    if (analyzedFilter) params.set("analyzed", analyzedFilter);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));

    const [gamesRes, statusRes] = await Promise.all([
      fetch(`/api/games?${params.toString()}`),
      fetch("/api/jobs/status"),
    ]);
    const data = await gamesRes.json();
    const status = await statusRes.json();

    setGames((data.games as Game[]) || []);
    setTotal(Number(data.total ?? 0));
    setAnalyzedInView(Number(data.analyzed ?? 0));
    setPageCount(Number(data.pageCount ?? 1));
    setPending(Number(status?.games?.pending ?? 0));
    setQueuedIds(new Set<number>((status?.queuedGameIds as number[]) ?? []));
    setLoading(false);
  }, [debouncedQ, source, speed, result, color, analyzedFilter, from, to, page, pageSize]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch keyed by the active filters
    void load();
  }, [load]);

  /** Publish analysis jobs to the queue — returns immediately. */
  async function enqueue(gameIds: number[]) {
    if (gameIds.length === 0) return;
    setQueuedIds((prev) => new Set([...prev, ...gameIds]));
    await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameIds }),
    });
    await load();
  }

  async function enqueueAll() {
    await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    await load();
  }

  async function remove(id: number) {
    await fetch(`/api/games/${id}`, { method: "DELETE" });
    await load();
  }

  const filtersActive = Boolean(q || source || speed || result || color || analyzedFilter || from || to);

  function clearFilters() {
    setQ("");
    setDebouncedQ("");
    setSource("");
    setSpeed("");
    setResult("");
    setColor("");
    setAnalyzedFilter("");
    setFrom("");
    setTo("");
    setPage(1);
  }

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  const pager = useMemo(
    () => ({
      first: () => setPage(1),
      prev: () => setPage((p) => Math.max(1, p - 1)),
      next: () => setPage((p) => Math.min(pageCount, p + 1)),
      last: () => setPage(pageCount),
    }),
    [pageCount]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Your games</h1>
        <p className="text-sm text-zinc-400">
          Import from Lichess &amp; Chess.com, then queue them for Stockfish analysis — the app stays
          usable while games are processed in the background.
        </p>
      </div>

      <ImportForm onImported={load} />

      <AnalysisQueue onProgress={load} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-400">
          {filtersActive ? (
            <>
              {total} matching · {analyzedInView} analyzed
            </>
          ) : (
            <>
              {total} games · {analyzedInView} analyzed
            </>
          )}
        </p>
        {pending > 0 && (
          <button
            onClick={enqueueAll}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Analyze all pending ({pending})
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Search players, openings, ECO…"
          className={`${field} min-w-[220px] flex-1`}
        />
        <select value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }} className={field}>
          <option value="">Any site</option>
          <option value="lichess">Lichess</option>
          <option value="chesscom">Chess.com</option>
        </select>
        <select value={speed} onChange={(e) => { setSpeed(e.target.value); setPage(1); }} className={field}>
          <option value="">Any speed</option>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={result} onChange={(e) => { setResult(e.target.value); setPage(1); }} className={field}>
          <option value="">Any result</option>
          <option value="win">Wins</option>
          <option value="loss">Losses</option>
          <option value="draw">Draws</option>
        </select>
        <select value={color} onChange={(e) => { setColor(e.target.value); setPage(1); }} className={field}>
          <option value="">Either colour</option>
          <option value="w">As White</option>
          <option value="b">As Black</option>
        </select>
        <select
          value={analyzedFilter}
          onChange={(e) => { setAnalyzedFilter(e.target.value); setPage(1); }}
          className={field}
        >
          <option value="">All games</option>
          <option value="0">Not analysed</option>
          <option value="1">Analysed</option>
        </select>
        <input
          type="date"
          value={from}
          onChange={(e) => { setFrom(e.target.value); setPage(1); }}
          className={field}
          title="From date"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => { setTo(e.target.value); setPage(1); }}
          className={field}
          title="To date"
        />
        {filtersActive && (
          <button onClick={clearFilters} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700">
            Clear
          </button>
        )}
      </div>

      <div className={`overflow-x-auto rounded-xl border border-zinc-800 ${loading ? "opacity-60" : ""}`}>
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="px-3 py-2">Players</th>
              <th className="px-3 py-2">Result</th>
              <th className="px-3 py-2">Speed</th>
              <th className="px-3 py-2">Opening</th>
              <th className="px-3 py-2">Accuracy</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {games.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-zinc-500">
                  {filtersActive ? "No games match these filters." : "No games yet — import a profile above."}
                </td>
              </tr>
            )}
            {games.map((g) => (
              <tr key={g.id} className="hover:bg-zinc-900/50">
                <td className="px-3 py-2">
                  <div className="font-medium">
                    {g.white} <span className="text-zinc-500">vs</span> {g.black}
                  </div>
                  <div className="text-xs text-zinc-500">
                    you played {g.player_color === "w" ? "White" : "Black"} · {g.player_rating ?? "?"}
                    {g.played_at && ` · ${g.played_at.slice(0, 10)}`}
                  </div>
                </td>
                <td className="px-3 py-2 font-mono">{g.result}</td>
                <td className="px-3 py-2 capitalize">{g.speed || "—"}</td>
                <td className="px-3 py-2">
                  <div className="font-mono text-xs text-zinc-400">{g.eco || "—"}</div>
                  <div className="max-w-[220px] truncate">{g.opening_name || "—"}</div>
                </td>
                <td className="px-3 py-2 font-mono">
                  {g.analyzed && g.accuracy != null ? `${g.accuracy.toFixed(1)}%` : "—"}
                </td>
                <td className="px-3 py-2 capitalize">{g.source}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-2">
                    {!g.analyzed ? (
                      g.total_plies === 0 ? (
                        <span
                          className="rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-500"
                          title="No move data — re-import this account to repair it"
                        >
                          no moves
                        </span>
                      ) : queuedIds.has(g.id) ? (
                        <span className="rounded bg-indigo-950 px-2.5 py-1 text-xs text-indigo-300">queued</span>
                      ) : (
                        <button
                          onClick={() => enqueue([g.id])}
                          className="rounded bg-zinc-700 px-2.5 py-1 text-xs font-medium hover:bg-zinc-600"
                        >
                          Analyze
                        </button>
                      )
                    ) : (
                      <Link
                        href={`/review/${g.id}`}
                        className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-semibold hover:bg-indigo-500"
                      >
                        Review
                      </Link>
                    )}
                    <button
                      onClick={() => remove(g.id)}
                      className="rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-400 hover:bg-rose-900/40 hover:text-rose-300"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-400">
        <span>
          {total === 0 ? "Nothing to show" : `Showing ${rangeStart}–${rangeEnd} of ${total}`}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className={field}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
          <button onClick={pager.first} disabled={page <= 1} className="rounded bg-zinc-800 px-2.5 py-1.5 disabled:opacity-40">
            «
          </button>
          <button onClick={pager.prev} disabled={page <= 1} className="rounded bg-zinc-800 px-3 py-1.5 disabled:opacity-40">
            Prev
          </button>
          <span className="px-1 text-zinc-300">
            Page {page} / {pageCount}
          </span>
          <button
            onClick={pager.next}
            disabled={page >= pageCount}
            className="rounded bg-zinc-800 px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
          <button
            onClick={pager.last}
            disabled={page >= pageCount}
            className="rounded bg-zinc-800 px-2.5 py-1.5 disabled:opacity-40"
          >
            »
          </button>
        </div>
      </div>
    </div>
  );
}
