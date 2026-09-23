"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  LabelList,
} from "recharts";

interface Profile {
  totalGames: number;
  analyzedGames: number;
  totalPlayerMoves: number;
  classification: Record<string, number>;
  phase: Record<
    string,
    {
      moves: number;
      blunders: number;
      mistakes: number;
      inaccuracies: number;
      misses: number;
      errorsPer100: number;
      avgCpLoss: number;
      medianCpLoss: number;
    }
  >;
  motifs: { motif: string; count: number }[];
  timeManagement: {
    lowTime: { moves: number; avgCpLoss: number; medianCpLoss: number };
    normalTime: { moves: number; avgCpLoss: number; medianCpLoss: number };
  };
  openings: { eco: string; name: string; games: number; wins: number; draws: number; losses: number; winRate: number; avgAccuracy: number }[];
  color: {
    white: { games: number; wins: number; draws: number; losses: number };
    black: { games: number; wins: number; draws: number; losses: number };
  };
  accuracyTrend: { gameId: number; playedAt: string | null; accuracy: number | null }[];
  summary: { avgAccuracy: number | null; blunderRate: number; mostCommonMotif: string | null; weakestPhase: string | null };
  window?: string;
}

type ProfileWindow = "all" | "30" | "100" | "month";

const WINDOWS: { key: ProfileWindow; label: string }[] = [
  { key: "30", label: "Last 30 games" },
  { key: "100", label: "Last 100" },
  { key: "month", label: "Last 30 days" },
  { key: "all", label: "All time" },
];

type OpeningSort = "games" | "winRate" | "avgAccuracy";

/** Motif tags are detector keys; these are the same words the puzzles screen uses. */
function motifLabel(motif: string): string {
  return motif.replace(/-/g, " ");
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-xs uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="mt-1 text-2xl font-bold text-zinc-100">{value}</div>
      {sub ? <div className="text-xs text-zinc-400">{sub}</div> : null}
    </div>
  );
}

export default function Insights() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [showAllOpenings, setShowAllOpenings] = useState(false);
  const [profileWindow, setProfileWindow] = useState<ProfileWindow>("all");
  const [sortKey, setSortKey] = useState<OpeningSort>("games");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting the error before a refetch
    setError(null);
    fetch(`/api/insights?window=${profileWindow}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Insights request failed (${r.status})`);
        const body = (await r.json()) as Profile;
        if (!body || !Array.isArray(body.accuracyTrend)) throw new Error("Insights response was malformed");
        return body;
      })
      .then((body) => {
        if (!cancelled) setProfile(body);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, profileWindow]);

  const TREND_WINDOW = 40;
  const accuracyData = useMemo(() => {
    const games = (profile?.accuracyTrend ?? []).filter((t) => t.accuracy != null);
    return games.slice(-TREND_WINDOW).map((t, i, arr) => {
      const window = arr.slice(Math.max(0, i - 4), i + 1);
      return {
        name: t.playedAt ? t.playedAt.slice(0, 10) : String(i),
        accuracy: Number(t.accuracy!.toFixed(1)),
        rolling: Number((window.reduce((sum, g) => sum + Number(g.accuracy), 0) / window.length).toFixed(1)),
      };
    });
  }, [profile]);

  /** Recent form: last 10 games against the 10 before them. */
  const recentDelta = useMemo(() => {
    const acc = (profile?.accuracyTrend ?? [])
      .filter((t) => t.accuracy != null)
      .map((t) => Number(t.accuracy));
    if (acc.length < 20) return null;
    const recent = acc.slice(-10);
    const prior = acc.slice(-20, -10);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    return mean(recent) - mean(prior);
  }, [profile]);

  const sortedOpenings = useMemo(() => {
    const list = [...(profile?.openings ?? [])];
    list.sort((a, b) => {
      const delta = a[sortKey] - b[sortKey];
      return sortDir === "asc" ? delta : -delta;
    });
    return list;
  }, [profile, sortKey, sortDir]);

  function toggleSort(key: OpeningSort) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  /** Catch-all detector tag: it means "flagged but not classified", not a motif. */
  const motifData = useMemo(
    () =>
      (profile?.motifs ?? [])
        .filter((m) => m.motif !== "tactical")
        .slice(0, 8)
        .map((m) => ({ name: motifLabel(m.motif), count: m.count, motif: m.motif })),
    [profile]
  );
  const unclassifiedCount = useMemo(
    () => (profile?.motifs ?? []).find((m) => m.motif === "tactical")?.count ?? 0,
    [profile]
  );

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Insights</h1>
        <div role="alert" className="rounded-xl border border-rose-900 bg-rose-950/40 p-6 text-rose-200">
          <p className="font-semibold">Could not load your insights.</p>
          <p className="mt-1 text-sm text-rose-300/90">{error}</p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-3 min-h-11 rounded-lg border border-rose-700 px-3 text-sm font-semibold text-rose-100 hover:bg-rose-950/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Insights</h1>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-zinc-400">
          Loading your insights…
        </div>
      </div>
    );
  }

  if (profile.analyzedGames === 0 && profileWindow !== "all") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Insights</h1>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-zinc-300">
          No analysed games in this window.{" "}
          <button
            type="button"
            onClick={() => setProfileWindow("all")}
            className="underline hover:text-zinc-100"
          >
            Show all time
          </button>
        </div>
      </div>
    );
  }

  if (profile.analyzedGames === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Insights</h1>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-zinc-300">
          Analyse at least one game to unlock your weakness profile, accuracy trends, and opening
          performance.
        </div>
      </div>
    );
  }

  const cls = profile.classification;
  const mistakes = (cls.mistake ?? 0) + (cls.blunder ?? 0) + (cls.miss ?? 0);
  const motifTotal = motifData.reduce((sum, m) => sum + m.count, 0);
  const topMotif = motifData[0] ?? null;
  const accuracies = accuracyData.map((d) => d.accuracy);
  const accMin = accuracies.length ? Math.min(...accuracies) : null;
  const accMax = accuracies.length ? Math.max(...accuracies) : null;
  const lowTimeWorse = profile.timeManagement.lowTime.avgCpLoss > profile.timeManagement.normalTime.avgCpLoss;
  const phases = Object.entries(profile.phase);
  const worstPhase = phases.reduce<[string, Profile["phase"][string]] | null>(
    (acc, entry) => (acc == null || entry[1].avgCpLoss > acc[1].avgCpLoss ? entry : acc),
    null
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Insights</h1>
        <p className="text-sm text-zinc-400">
          Pattern over incident — aggregated across {profile.analyzedGames} analysed game
          {profile.analyzedGames === 1 ? "" : "s"}
          {profileWindow === "all" ? " (all time)" : ""}.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Time window">
          <span className="text-xs uppercase tracking-wider text-zinc-400">Scope</span>
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              onClick={() => setProfileWindow(w.key)}
              aria-pressed={profileWindow === w.key}
              className={`min-h-10 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
                profileWindow === w.key
                  ? "border-indigo-500 bg-indigo-600 text-white"
                  : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/* The dashboard's job is to say what to work on next, so it starts with one. */}
      <section className="rounded-xl border border-indigo-900 bg-indigo-950/30 p-4">
        <h2 className="text-sm font-semibold text-indigo-100">What to work on next</h2>
        <ul className="mt-2 space-y-2 text-sm text-zinc-200">
          {topMotif ? (
            <li>
              Your most trainable leak is <span className="font-semibold">{topMotif.name}</span> —{" "}
              {topMotif.count} flagged moves across {profile.analyzedGames} games.{" "}
              <Link
                href={`/puzzles?theme=${encodeURIComponent(topMotif.motif)}`}
                className="font-semibold text-indigo-300 underline hover:text-indigo-200"
              >
                Drill {topMotif.name}
              </Link>
            </li>
          ) : (
            <li>No named tactical pattern stands out yet — play a few more analysed games.</li>
          )}
          {worstPhase ? (
            <li>
              Your {worstPhase[0]} is where you flag most often:{" "}
              <span className="font-semibold">{worstPhase[1].errorsPer100}</span> flagged moves per 100
              (median loss {worstPhase[1].medianCpLoss.toFixed(0)} cp), worst of {phases.length} phases.
            </li>
          ) : null}
          {profile.timeManagement.lowTime.moves > 0 ? (
            <li>
              {lowTimeWorse
                ? `Under 30 seconds your median loss is ${profile.timeManagement.lowTime.medianCpLoss.toFixed(
                    0
                  )} cp against ${profile.timeManagement.normalTime.medianCpLoss.toFixed(
                    0
                  )} cp normally — slow down or simplify when the clock runs low.`
                : "Your accuracy holds up in time trouble, which is unusual and worth keeping."}
            </li>
          ) : null}
          <li className="text-zinc-300">
            What is working: you matched the engine&apos;s move{" "}
            <span className="font-semibold">
              {(profile.classification.best ?? 0).toLocaleString()}
            </span>{" "}
            times, {profile.classification.brilliant ?? 0} of them brilliancies.
          </li>
        </ul>
      </section>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Avg accuracy"
          value={profile.summary.avgAccuracy != null ? `${profile.summary.avgAccuracy.toFixed(1)}%` : "—"}
        />
        <StatCard label="Blunders / game" value={profile.summary.blunderRate.toFixed(2)} />
        <StatCard
          label="Flagged moves"
          value={String(mistakes)}
          sub={`${cls.mistake ?? 0} mistakes, ${cls.blunder ?? 0} blunders, ${cls.miss ?? 0} missed wins · of ${profile.totalPlayerMoves.toLocaleString()} moves`}
        />
        <StatCard
          label="Engine matches"
          value={(profile.classification.best ?? 0).toLocaleString()}
          sub={`plus ${profile.classification.brilliant ?? 0} brilliancies and ${(profile.classification.great ?? 0).toLocaleString()} great moves`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Accuracy trend (%)
          </h2>
          <p className="mb-3 text-xs text-zinc-400">
            Last {accuracyData.length} games, oldest to newest
            {accMin != null && accMax != null ? ` — from ${accMin}% to ${accMax}%` : ""}
            {recentDelta != null
              ? ` · recent 10 average ${recentDelta >= 0 ? "up" : "down"} ${Math.abs(recentDelta).toFixed(1)} points on the previous 10`
              : ""}
            . The paler line is a 5-game rolling average.
          </p>
          {accuracyData.length > 0 ? (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={accuracyData}
                  margin={{ top: 8, right: 12, bottom: 0, left: -18 }}
                  accessibilityLayer
                  aria-label={`Line chart of accuracy across ${accuracyData.length} games, oldest first, ranging from ${accMin}% to ${accMax}%, averaging ${profile.summary.avgAccuracy != null ? profile.summary.avgAccuracy.toFixed(1) : "unknown"}%.`}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#a1a1aa" }} minTickGap={28} />
                  <YAxis domain={[50, 100]} tick={{ fontSize: 10, fill: "#a1a1aa" }} allowDataOverflow={false} />
                  <Tooltip
                    contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }}
                    formatter={(value) => [`${value}%`, "Accuracy"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="accuracy"
                    stroke="#a78bfa"
                    dot={false}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="rolling"
                    stroke="#c4b5fd"
                    strokeOpacity={0.55}
                    dot={false}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-zinc-400">No accuracy data.</p>
          )}
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Recurring mistakes (motifs)
          </h2>
          <p className="mb-3 text-xs text-zinc-400">
            Flagged patterns across every analysed game
            {topMotif ? ` — ${topMotif.count} of them are ${topMotif.name}` : ""}.
          </p>
          {motifData.length > 0 ? (
            <>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={motifData}
                    layout="vertical"
                    margin={{ top: 4, right: 32, bottom: 0, left: 0 }}
                    accessibilityLayer
                    aria-label={`Bar chart of flagged patterns: ${motifData
                      .map((m) => `${m.name} ${m.count}`)
                      .join(", ")}.`}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "#a1a1aa" }} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={104}
                      tick={{ fontSize: 11, fill: "#a1a1aa" }}
                      interval={0}
                    />
                    <Tooltip
                      contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }}
                      formatter={(value) => [String(value), "Flagged moves"]}
                    />
                    <Bar dataKey="count" fill="#818cf8" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                      <LabelList dataKey="count" position="right" fill="#d4d4d8" fontSize={11} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-zinc-400">
                Counts are labelled on each bar, so nothing here needs a hover. Named patterns only —{" "}
                {unclassifiedCount.toLocaleString()} of{" "}
                {(unclassifiedCount + motifTotal).toLocaleString()} flagged moves (
                {motifTotal + unclassifiedCount > 0
                  ? Math.round((unclassifiedCount / (unclassifiedCount + motifTotal)) * 100)
                  : 0}
                %) were not classified into a motif.
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {motifData.map((m) => (
                  <li key={m.motif}>
                    <Link
                      href={`/puzzles?theme=${encodeURIComponent(m.motif)}`}
                      className="inline-flex min-h-9 items-center rounded-lg border border-zinc-700 px-2.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
                    >
                      Drill {m.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-zinc-400">No tactical motifs detected yet.</p>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Phase performance
        </h2>
        <p className="mb-3 text-xs text-zinc-400">
          Flagged moves per 100, with the median loss per move — a mean would be dominated by a single
          missed mate (mate scores count as 1000 cp here).
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {phases.map(([phase, s]) => {
            const worst = worstPhase != null && worstPhase[0] === phase;
            return (
              <div
                key={phase}
                className={`rounded-lg border p-3 ${
                  worst ? "border-amber-800 bg-amber-950/20" : "border-zinc-800"
                }`}
              >
                <div className="flex items-center gap-2 font-semibold capitalize">
                  {phase}
                  {worst ? (
                    <span className="rounded bg-amber-950 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                      costliest
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-sm text-zinc-300">
                  {s.errorsPer100} flagged / 100 moves
                </div>
                <div className="font-mono text-xs text-zinc-300">
                  median loss {s.medianCpLoss.toFixed(0)} cp · {s.blunders} blunders, {s.mistakes}{" "}
                  mistakes, {s.misses} missed wins
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Opening performance
        </h2>
        <p className="mb-3 text-xs text-zinc-400">
          {showAllOpenings
            ? `All ${profile.openings.length} openings you have played.`
            : `Openings you have played at least 5 times (${profile.openings.filter((o) => o.games >= 5).length} of ${profile.openings.length}). A win rate from one or two games is noise, not a finding.`}
        </p>

        {/* Table on wide screens; stacked rows where seven columns cannot fit. */}
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="px-2 py-2">Opening</th>
                <th className="px-2 py-2" aria-sort={sortKey === "games" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                  <button type="button" onClick={() => toggleSort("games")} className="uppercase underline-offset-2 hover:underline">
                    Games {sortKey === "games" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                  </button>
                </th>
                <th className="px-2 py-2">Wins</th>
                <th className="px-2 py-2">Draws</th>
                <th className="px-2 py-2">Losses</th>
                <th className="px-2 py-2" aria-sort={sortKey === "winRate" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                  <button type="button" onClick={() => toggleSort("winRate")} className="uppercase underline-offset-2 hover:underline">
                    Win % {sortKey === "winRate" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                  </button>
                </th>
                <th className="px-2 py-2" aria-sort={sortKey === "avgAccuracy" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                  <button type="button" onClick={() => toggleSort("avgAccuracy")} className="uppercase underline-offset-2 hover:underline">
                    Avg acc. {sortKey === "avgAccuracy" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {sortedOpenings
                .filter((o) => showAllOpenings || o.games >= 5)
                .map((o) => (
                <tr key={o.eco}>
                  <td className="px-2 py-2">
                    <span className="font-mono text-xs text-zinc-400">{o.eco}</span> {o.name || "—"}
                    {o.games < 5 ? (
                      <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
                        no signal
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 font-mono">{o.games}</td>
                  <td className="px-2 py-2 text-emerald-400">{o.wins}</td>
                  <td className="px-2 py-2">{o.draws}</td>
                  <td className="px-2 py-2 text-rose-400">{o.losses}</td>
                  <td className="px-2 py-2 font-mono">{o.winRate}%</td>
                  <td className="px-2 py-2 font-mono">
                    {o.avgAccuracy ? `${o.avgAccuracy.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="space-y-2 sm:hidden">
          {sortedOpenings
            .filter((o) => showAllOpenings || o.games >= 5)
            .map((o) => (
            <li key={o.eco} className="rounded-lg border border-zinc-800 p-3">
              <div className="text-sm text-zinc-100">
                <span className="font-mono text-xs text-zinc-400">{o.eco}</span> {o.name || "—"}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-300">
                <span className="font-mono">{o.games} games</span>
                <span className="font-mono text-emerald-400">{o.wins}W</span>
                <span className="font-mono">{o.draws}D</span>
                <span className="font-mono text-rose-400">{o.losses}L</span>
                <span className="font-mono">{o.winRate}% win</span>
                <span className="font-mono">
                  {o.avgAccuracy ? `${o.avgAccuracy.toFixed(1)}% acc.` : "— acc."}
                </span>
              </div>
              {o.games < 5 ? (
                <div className="mt-1 text-[11px] text-zinc-400">
                  Only {o.games} game{o.games === 1 ? "" : "s"} — no signal yet.
                </div>
              ) : null}
            </li>
          ))}
        </ul>

        {profile.openings.length === 0 && (
          <p className="px-2 py-4 text-center text-sm text-zinc-400">No opening data.</p>
        )}
        <button
          type="button"
          onClick={() => setShowAllOpenings((v) => !v)}
          className="mt-3 min-h-10 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
        >
          {showAllOpenings ? "Show only openings with 5+ games" : `Show all ${profile.openings.length} openings`}
        </button>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Time management
          </h2>
          <p className="mb-3 text-xs text-zinc-400">
            Average centipawn loss per move with under 30 seconds on the clock, against normal time.
          </p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-300">
                Low time (&lt;30s): {profile.timeManagement.lowTime.moves} moves
              </span>
              <span className="font-mono text-zinc-100">
                {profile.timeManagement.lowTime.avgCpLoss.toFixed(0)} cp
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-300">
                Normal time: {profile.timeManagement.normalTime.moves} moves
              </span>
              <span className="font-mono text-zinc-100">
                {profile.timeManagement.normalTime.avgCpLoss.toFixed(0)} cp
              </span>
            </div>
            {profile.timeManagement.lowTime.moves > 0 &&
              profile.timeManagement.normalTime.moves > 0 && (
                <p className="text-xs text-zinc-400">
                  {lowTimeWorse
                    ? "You make more costly mistakes when low on time."
                    : "Your accuracy holds up well even in time trouble."}
                </p>
              )}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Colour performance
          </h2>
          <p className="mb-3 text-xs text-zinc-400">Results and win rate by the colour you played.</p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {(["white", "black"] as const).map((c) => {
              const s = profile.color[c];
              const winRate = s.games ? ((s.wins / s.games) * 100).toFixed(0) : "—";
              return (
                <div key={c} className="rounded-lg border border-zinc-800 p-3">
                  <div className="font-semibold capitalize">{c}</div>
                  <div className="mt-1 text-zinc-300">
                    {s.games} games · {s.wins}W {s.draws}D {s.losses}L
                  </div>
                  <div className="font-mono text-zinc-100">{winRate}% win rate</div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
