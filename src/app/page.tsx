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
  flagged?: number;
  blunders?: number;
  decisive_ply?: number | null;
  decisive_cpl?: number | null;
  decisive_san?: string | null;
  decisive_motif?: string | null;
}

const SPEEDS = ["bullet", "blitz", "rapid", "classical"];
const PAGE_SIZES = [25, 50, 100, 200];

function resultOf(g: Game): { label: string; tone: string } {
  const won =
    (g.player_color === "w" && g.result.startsWith("1-0")) ||
    (g.player_color === "b" && g.result.startsWith("0-1"));
  const lost =
    (g.player_color === "w" && g.result.startsWith("0-1")) ||
    (g.player_color === "b" && g.result.startsWith("1-0"));
  if (won) return { label: "Won", tone: "text-emerald-400" };
  if (lost) return { label: "Lost", tone: "text-rose-400" };
  if (/1\/2|½/.test(g.result)) return { label: "Drew", tone: "text-zinc-300" };
  return { label: g.result, tone: "text-zinc-300" };
}

const field =
  "min-h-11 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

export default function Home() {
  const [games, setGames] = useState<Game[]>([]);
  const [total, setTotal] = useState(0);
  const [analyzedInView, setAnalyzedInView] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [pending, setPending] = useState(0);
  const [queuedIds, setQueuedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [activeProfile, setActiveProfile] = useState<{ id: number; display_name: string; lichess_username: string; chesscom_username: string } | null>(null);

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

  // The library is the loop's front door, so its view lives in the URL: a
  // filtered set survives a trip into a review and can be shared or reloaded.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    /* eslint-disable react-hooks/set-state-in-effect -- hydrating from the URL on mount */
    if (sp.get("q")) {
      setQ(sp.get("q") ?? "");
      setDebouncedQ(sp.get("q") ?? "");
    }
    if (sp.get("source")) setSource(sp.get("source") ?? "");
    if (sp.get("speed")) setSpeed(sp.get("speed") ?? "");
    if (sp.get("result")) setResult(sp.get("result") ?? "");
    if (sp.get("color")) setColor(sp.get("color") ?? "");
    if (sp.get("analyzed")) setAnalyzedFilter(sp.get("analyzed") ?? "");
    if (sp.get("from")) setFrom(sp.get("from") ?? "");
    if (sp.get("to")) setTo(sp.get("to") ?? "");
    if (sp.get("page")) setPage(Math.max(1, Number(sp.get("page")) || 1));
    if (sp.get("pageSize")) setPageSize(Number(sp.get("pageSize")) || 50);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    const sp = new URLSearchParams();
    if (debouncedQ.trim()) sp.set("q", debouncedQ.trim());
    if (source) sp.set("source", source);
    if (speed) sp.set("speed", speed);
    if (result) sp.set("result", result);
    if (color) sp.set("color", color);
    if (analyzedFilter) sp.set("analyzed", analyzedFilter);
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    if (page > 1) sp.set("page", String(page));
    if (pageSize !== 50) sp.set("pageSize", String(pageSize));
    const qs = sp.toString();
    window.history.replaceState(null, "", qs ? `/?${qs}` : "/");
  }, [debouncedQ, source, speed, result, color, analyzedFilter, from, to, page, pageSize]);

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

    setActiveProfile((data.profile as typeof activeProfile) ?? null);
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
    if (!window.confirm("Delete this game and its analysis? Puzzles built from it go too.")) return;
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

  // Every game belongs to a profile, so without one there is no library to show
  // and nothing to import for.
  if (!loading && activeProfile === null) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Your games</h1>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
          <p className="text-zinc-200">No profile is active.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-zinc-400">
            Games belong to a profile, so add one first. After that this tab imports and
            analyses for whoever is active.
          </p>
          <Link
            href="/profiles"
            className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
          >
            Go to Profiles
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Your games</h1>
        <p className="text-sm text-zinc-400">
          Imported for the active profile and queued for Stockfish analysis — the app stays
          usable while games are processed in the background.
        </p>
      </div>

      <ImportForm onImported={load} />

      <AnalysisQueue onProgress={load} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p aria-live="polite" className="text-sm text-zinc-400">
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
        {pageCount > 1 ? (
          /* The pager used to exist only below 50 rows (y≈10,729 on a phone), so
             page 2 was unreachable from the count line. */
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={pager.first}
              disabled={page <= 1}
              aria-label="First page"
              className="min-h-11 rounded bg-zinc-800 px-3 disabled:opacity-40"
            >
              «
            </button>
            <button
              onClick={pager.prev}
              disabled={page <= 1}
              aria-label="Previous page"
              className="min-h-11 rounded bg-zinc-800 px-3 disabled:opacity-40"
            >
              Prev
            </button>
            <span className="text-zinc-300">
              Page {page} / {pageCount}
            </span>
            <button
              onClick={pager.next}
              disabled={page >= pageCount}
              aria-label="Next page"
              className="min-h-11 rounded bg-zinc-800 px-3 disabled:opacity-40"
            >
              Next
            </button>
            <button
              onClick={pager.last}
              disabled={page >= pageCount}
              aria-label="Last page"
              className="min-h-11 rounded bg-zinc-800 px-3 disabled:opacity-40"
            >
              »
            </button>
          </div>
        ) : null}
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
        <select aria-label="Site" value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }} className={field}>
          <option value="">Any site</option>
          <option value="lichess">Lichess</option>
          <option value="chesscom">Chess.com</option>
        </select>
        <select aria-label="Speed" value={speed} onChange={(e) => { setSpeed(e.target.value); setPage(1); }} className={field}>
          <option value="">Any speed</option>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select aria-label="Result" value={result} onChange={(e) => { setResult(e.target.value); setPage(1); }} className={field}>
          <option value="">Any result</option>
          <option value="win">Wins</option>
          <option value="loss">Losses</option>
          <option value="draw">Draws</option>
        </select>
        <select aria-label="Colour played" value={color} onChange={(e) => { setColor(e.target.value); setPage(1); }} className={field}>
          <option value="">Either colour</option>
          <option value="w">As White</option>
          <option value="b">As Black</option>
        </select>
        <select
          value={analyzedFilter}
          onChange={(e) => { setAnalyzedFilter(e.target.value); setPage(1); }}
          aria-label="Analysis status"
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
          aria-label="Played from date"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => { setTo(e.target.value); setPage(1); }}
          className={field}
          aria-label="Played to date"
        />
        {filtersActive && (
          <button onClick={clearFilters} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700">
            Clear
          </button>
        )}
      </div>

      <div className={`hidden overflow-x-auto rounded-xl border border-zinc-800 sm:block ${loading ? "opacity-60" : ""}`}>
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="px-3 py-2">Players</th>
              <th className="px-3 py-2">Result</th>
              <th className="px-3 py-2">Speed</th>
              <th className="px-3 py-2">Opening</th>
              <th className="px-3 py-2">Accuracy</th>
              <th className="px-3 py-2">Flagged</th>
              <th className="px-3 py-2">Turning point</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {games.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-zinc-400">
                  {filtersActive ? "No games match these filters." : "No games yet — import a profile above."}
                </td>
              </tr>
            )}
            {games.map((g) => (
              <tr key={g.id} className="hover:bg-zinc-900/50">
                <td className="px-3 py-2">
                  <div className="font-medium">
                    {g.white} <span className="text-zinc-400">vs</span> {g.black}
                  </div>
                  <div className="text-xs text-zinc-400">
                    you played {g.player_color === "w" ? "White" : "Black"} · {g.player_rating ?? "?"}
                    {g.played_at && ` · ${g.played_at.slice(0, 10)}`}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {(() => {
                    const r = resultOf(g);
                    return (
                      <span className={`font-medium ${r.tone}`}>
                        {r.label} <span className="font-mono text-xs text-zinc-400">{g.result}</span>
                      </span>
                    );
                  })()}
                </td>
                <td className="px-3 py-2 capitalize">{g.speed || "—"}</td>
                <td className="px-3 py-2">
                  {g.eco ? (
                    <Link
                      href={`/openings?eco=${encodeURIComponent(g.eco)}`}
                      className="font-mono text-xs text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
                    >
                      {g.eco}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs text-zinc-400">—</span>
                  )}
                  <div className="max-w-[220px] truncate" title={g.opening_name || undefined}>
                    {g.opening_name || "—"}
                  </div>
                </td>
                <td className="px-3 py-2 font-mono">
                  {g.analyzed && g.accuracy != null ? `${g.accuracy.toFixed(1)}%` : "—"}
                </td>
                <td className="px-3 py-2">
                  {g.analyzed && g.flagged != null ? (
                    <span className="font-mono">
                      {g.flagged}
                      {g.blunders ? (
                        <span className="text-rose-400"> ({g.blunders} blunders)</span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {g.analyzed && g.decisive_ply != null ? (
                    <Link
                      href={`/review/${g.id}?ply=${g.decisive_ply}`}
                      className="underline-offset-2 hover:underline"
                      title="Open the review at this move"
                    >
                      <span className="font-mono text-xs text-zinc-400">
                        {Math.floor(g.decisive_ply / 2) + 1}
                        {g.decisive_ply % 2 === 0 ? "." : "…"}
                      </span>{" "}
                      <span className="text-zinc-200">{g.decisive_san}</span>
                      {g.decisive_cpl != null ? (
                        <span className="ml-1 font-mono text-xs text-rose-300">
                          −{(g.decisive_cpl / 100).toFixed(1)}
                        </span>
                      ) : null}
                      {g.decisive_motif ? (
                        <span className="ml-1 text-xs text-zinc-400">
                          {g.decisive_motif.replace(/-/g, " ")}
                        </span>
                      ) : null}
                    </Link>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 capitalize">{g.source}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-2">
                    {!g.analyzed ? (
                      g.total_plies === 0 ? (
                        <span
                          className="rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300"
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

      {/* Nine columns cannot fit on a phone and Actions was the first thing cut, so
          below sm each game is a card whose primary action is Review. */}
      <ul className={`space-y-2 sm:hidden ${loading ? "opacity-60" : ""}`}>
        {games.length === 0 ? (
          <li className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 text-center text-sm text-zinc-400">
            {filtersActive ? "No games match these filters." : "No games yet — import a profile above."}
          </li>
        ) : null}
        {games.map((g) => {
          const r = resultOf(g);
          return (
            <li key={g.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium text-zinc-100">
                  {g.white} <span className="text-zinc-400">vs</span> {g.black}
                </span>
                <span className={`shrink-0 text-sm font-medium ${r.tone}`}>
                  {r.label} <span className="font-mono text-xs text-zinc-400">{g.result}</span>
                </span>
              </div>
              <div className="mt-1 text-xs text-zinc-400">
                you played {g.player_color === "w" ? "White" : "Black"} · {g.player_rating ?? "?"}
                {g.played_at ? ` · ${g.played_at.slice(0, 10)}` : ""} · {g.speed || "—"}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {g.eco ? (
                  <Link
                    href={`/openings?eco=${encodeURIComponent(g.eco)}`}
                    className="font-mono text-zinc-400 underline-offset-2 hover:underline"
                  >
                    {g.eco}
                  </Link>
                ) : null}
                <span className="truncate text-zinc-300">{g.opening_name || "—"}</span>
                <span className="font-mono text-zinc-300">
                  {g.analyzed && g.accuracy != null ? `${g.accuracy.toFixed(1)}%` : "not analysed"}
                </span>
                {g.analyzed && g.flagged != null ? (
                  <span className="font-mono text-zinc-300">
                    {g.flagged} flagged{g.blunders ? ` (${g.blunders} blunders)` : ""}
                  </span>
                ) : null}
              </div>
              {g.analyzed && g.decisive_ply != null ? (
                <Link
                  href={`/review/${g.id}?ply=${g.decisive_ply}`}
                  className="mt-1 block text-xs text-zinc-200 underline-offset-2 hover:underline"
                >
                  turning point {Math.floor(g.decisive_ply / 2) + 1}
                  {g.decisive_ply % 2 === 0 ? "." : "…"} {g.decisive_san}
                  {g.decisive_cpl != null ? ` · −${(g.decisive_cpl / 100).toFixed(1)}` : ""}
                </Link>
              ) : null}
              <div className="mt-2 flex items-center gap-2">
                {g.analyzed ? (
                  <Link
                    href={`/review/${g.id}`}
                    className="flex min-h-11 flex-1 items-center justify-center rounded-lg bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-500"
                  >
                    Review
                  </Link>
                ) : g.total_plies === 0 ? (
                  <span className="flex min-h-11 flex-1 items-center justify-center rounded-lg bg-zinc-800 text-xs text-zinc-300">
                    no moves — re-import to repair
                  </span>
                ) : queuedIds.has(g.id) ? (
                  <span className="flex min-h-11 flex-1 items-center justify-center rounded-lg bg-indigo-950 text-xs text-indigo-300">
                    queued
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => enqueue([g.id])}
                    className="min-h-11 flex-1 rounded-lg bg-zinc-700 text-sm font-medium hover:bg-zinc-600"
                  >
                    Analyze
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(g.id)}
                  className="min-h-11 rounded-lg bg-zinc-800 px-3 text-sm text-zinc-300 hover:bg-rose-900/40 hover:text-rose-300"
                >
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>

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
          <button
            onClick={pager.first}
            disabled={page <= 1}
            aria-label="First page"
            className="min-h-11 rounded bg-zinc-800 px-3 disabled:opacity-40"
          >
            «
          </button>
          <button
            onClick={pager.prev}
            disabled={page <= 1}
            aria-label="Previous page"
            className="min-h-11 rounded bg-zinc-800 px-3 disabled:opacity-40"
          >
            Prev
          </button>
          <span className="px-1 text-zinc-300">
            Page {page} / {pageCount}
          </span>
          <button
            onClick={pager.next}
            disabled={page >= pageCount}
            aria-label="Next page"
            className="min-h-11 rounded bg-zinc-800 px-3 disabled:opacity-40"
          >
            Next
          </button>
          <button
            onClick={pager.last}
            disabled={page >= pageCount}
            aria-label="Last page"
            className="min-h-11 rounded bg-zinc-800 px-3 disabled:opacity-40"
          >
            »
          </button>
        </div>
      </div>
    </div>
  );
}
