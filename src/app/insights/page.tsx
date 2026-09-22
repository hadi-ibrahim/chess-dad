"use client";

import { useEffect, useState } from "react";
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
  Cell,
} from "recharts";

interface Profile {
  totalGames: number;
  analyzedGames: number;
  totalPlayerMoves: number;
  classification: Record<string, number>;
  phase: Record<string, { moves: number; blunders: number; mistakes: number; inaccuracies: number; avgCpLoss: number }>;
  motifs: { motif: string; count: number }[];
  timeManagement: { lowTime: { moves: number; avgCpLoss: number }; normalTime: { moves: number; avgCpLoss: number } };
  openings: { eco: string; name: string; games: number; wins: number; draws: number; losses: number; winRate: number; avgAccuracy: number }[];
  color: {
    white: { games: number; wins: number; draws: number; losses: number };
    black: { games: number; wins: number; draws: number; losses: number };
  };
  accuracyTrend: { gameId: number; playedAt: string | null; accuracy: number | null }[];
  summary: { avgAccuracy: number | null; blunderRate: number; mostCommonMotif: string | null; weakestPhase: string | null };
}

const MOTIF_COLORS = ["#a78bfa", "#22d3ee", "#f472b6", "#34d399", "#fbbf24", "#60a5fa", "#fb7185", "#94a3b8"];

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-zinc-100">{value}</div>
      {sub && <div className="text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

export default function Insights() {
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    void fetch("/api/insights")
      .then((r) => r.json())
      .then(setProfile);
  }, []);

  if (!profile) return <div className="py-16 text-center text-zinc-500">Loading insights…</div>;

  if (profile.analyzedGames === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Insights</h1>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-zinc-400">
          Analyze at least one game to unlock your weakness profile, accuracy trends, and opening performance.
        </div>
      </div>
    );
  }

  const accuracyData = profile.accuracyTrend
    .filter((t) => t.accuracy != null)
    .map((t, i) => ({ name: t.playedAt ? t.playedAt.slice(0, 10) : String(i), accuracy: Number(t.accuracy!.toFixed(1)) }));

  const motifData = profile.motifs.slice(0, 8).map((m) => ({ name: m.motif.replace(/-/g, " "), count: m.count }));

  const cls = profile.classification;
  const mistakes = (cls.mistake ?? 0) + (cls.blunder ?? 0) + (cls.miss ?? 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Insights</h1>
        <p className="text-sm text-zinc-400">
          Pattern over incident — aggregated across {profile.analyzedGames} analyzed game{profile.analyzedGames === 1 ? "" : "s"}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Avg accuracy" value={profile.summary.avgAccuracy != null ? `${profile.summary.avgAccuracy.toFixed(1)}%` : "—"} />
        <StatCard label="Blunders / game" value={profile.summary.blunderRate.toFixed(2)} />
        <StatCard label="Mistakes + blunders" value={String(mistakes)} sub={`across ${profile.totalPlayerMoves} of your moves`} />
        <StatCard label="Weakest phase" value={profile.summary.weakestPhase ? profile.summary.weakestPhase : "—"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">Accuracy trend</h2>
          {accuracyData.length > 0 ? (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={accuracyData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#71717a" }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#71717a" }} />
                  <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }} />
                  <Line type="monotone" dataKey="accuracy" stroke="#a78bfa" dot={false} strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No accuracy data.</p>
          )}
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">Recurring mistakes (motifs)</h2>
          {motifData.length > 0 ? (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={motifData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#71717a" }} interval={0} angle={-20} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 10, fill: "#71717a" }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {motifData.map((_, i) => (
                      <Cell key={i} fill={MOTIF_COLORS[i % MOTIF_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No tactical motifs detected yet.</p>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">Phase performance</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Object.entries(profile.phase).map(([phase, s]) => (
            <div key={phase} className="rounded-lg border border-zinc-800 p-3">
              <div className="font-semibold capitalize">{phase}</div>
              <div className="mt-1 text-sm text-zinc-400">
                {s.moves} moves · {s.blunders + s.mistakes} mistakes
              </div>
              <div className="text-sm text-zinc-400">avg loss {s.avgCpLoss.toFixed(0)} cp</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">Opening performance</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-2 py-2">Opening</th>
                <th className="px-2 py-2">Games</th>
                <th className="px-2 py-2">Wins</th>
                <th className="px-2 py-2">Draws</th>
                <th className="px-2 py-2">Losses</th>
                <th className="px-2 py-2">Win %</th>
                <th className="px-2 py-2">Avg acc.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {profile.openings.map((o) => (
                <tr key={o.eco}>
                  <td className="px-2 py-2">
                    <span className="font-mono text-xs text-zinc-500">{o.eco}</span> {o.name || "—"}
                  </td>
                  <td className="px-2 py-2">{o.games}</td>
                  <td className="px-2 py-2 text-emerald-400">{o.wins}</td>
                  <td className="px-2 py-2">{o.draws}</td>
                  <td className="px-2 py-2 text-rose-400">{o.losses}</td>
                  <td className="px-2 py-2 font-mono">{o.winRate}%</td>
                  <td className="px-2 py-2 font-mono">{o.avgAccuracy ? `${o.avgAccuracy.toFixed(1)}%` : "—"}</td>
                </tr>
              ))}
              {profile.openings.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-4 text-center text-zinc-500">No opening data.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">Time management</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-400">Low time (&lt;30s): {profile.timeManagement.lowTime.moves} moves</span>
              <span className="font-mono">{profile.timeManagement.lowTime.avgCpLoss.toFixed(0)} cp</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Normal time: {profile.timeManagement.normalTime.moves} moves</span>
              <span className="font-mono">{profile.timeManagement.normalTime.avgCpLoss.toFixed(0)} cp</span>
            </div>
            {profile.timeManagement.lowTime.moves > 0 && profile.timeManagement.normalTime.moves > 0 && (
              <p className="text-xs text-zinc-500">
                {profile.timeManagement.lowTime.avgCpLoss > profile.timeManagement.normalTime.avgCpLoss
                  ? "You make more costly mistakes when low on time."
                  : "Your accuracy holds up well even in time trouble."}
              </p>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">Color performance</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {(["white", "black"] as const).map((c) => {
              const s = profile.color[c];
              const winRate = s.games ? ((s.wins / s.games) * 100).toFixed(0) : "—";
              return (
                <div key={c} className="rounded-lg border border-zinc-800 p-3">
                  <div className="font-semibold capitalize">{c}</div>
                  <div className="mt-1 text-zinc-400">
                    {s.games} games · {s.wins}W {s.draws}D {s.losses}L
                  </div>
                  <div className="font-mono text-zinc-300">{winRate}% win rate</div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
