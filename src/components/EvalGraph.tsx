"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

export interface EvalPoint {
  ply: number;
  moveNumber: number;
  cp: number; // player's perspective
  san?: string | null;
  classification?: string | null;
}

export default function EvalGraph({ points }: { points: EvalPoint[] }) {
  if (points.length === 0) {
    return <div className="text-sm text-zinc-500">No evaluation data yet.</div>;
  }

  const data = points.map((p) => ({
    name: String(p.moveNumber),
    cp: Math.max(-1000, Math.min(1000, p.cp)),
    san: p.san,
    classification: p.classification,
  }));

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#71717a" }} />
          <YAxis
            tick={{ fontSize: 10, fill: "#71717a" }}
            domain={[-1000, 1000]}
            ticks={[-1000, -500, 0, 500, 1000]}
          />
          <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }} />
          <ReferenceLine y={0} stroke="#52525b" />
          <Line type="stepAfter" dataKey="cp" stroke="#a78bfa" dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
