"use client";

import { useCallback, useEffect, useState } from "react";
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

export default function Home() {
  const [games, setGames] = useState<Game[]>([]);
  const [queuedIds, setQueuedIds] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    const res = await fetch("/api/games");
    const data = await res.json();
    const list = (data.games as Game[]) || [];
    setGames(list);
    // Drop "queued" markers for games that have since been analysed.
    setQueuedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<number>();
      for (const id of prev) {
        const g = list.find((x) => x.id === id);
        if (g && !g.analyzed) next.add(id);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch via a reusable loader
    void load();
  }, [load]);

  /** Publish analysis jobs to the queue — returns immediately. */
  async function enqueue(gameIds: number[]) {
    if (gameIds.length === 0) return;
    setQueuedIds((prev) => new Set([...prev, ...gameIds]));
    await fetch("/api/analysis/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameIds }),
    });
  }

  async function remove(id: number) {
    await fetch(`/api/games/${id}`, { method: "DELETE" });
    await load();
  }

  const analyzed = games.filter((g) => g.analyzed).length;
  const analyzable = games.filter((g) => !g.analyzed && g.total_plies > 0);
  const emptyCount = games.filter((g) => g.total_plies === 0).length;

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

      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-400">
          {games.length} games · {analyzed} analyzed
          {emptyCount > 0 && (
            <span className="text-amber-400"> · {emptyCount} without move data (re-import to repair)</span>
          )}
        </p>
        {analyzable.length > 0 && (
          <button
            onClick={() => enqueue(analyzable.map((g) => g.id))}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Analyze all ({analyzable.length})
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
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
                  No games yet — import a profile above.
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
                        <span className="rounded bg-indigo-950 px-2.5 py-1 text-xs text-indigo-300">
                          queued
                        </span>
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
    </div>
  );
}
