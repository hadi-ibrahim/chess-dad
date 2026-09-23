"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { classColor, classGlyph, classLabel, isError } from "./colors";

export interface EvalPoint {
  ply: number;
  moveNumber: number;
  cp: number; // player's perspective, centipawns
  san?: string | null;
  classification?: string | null;
}

interface EvalDatum {
  ply: number;
  cpPawns: number;
  san?: string | null;
  classification?: string | null;
}

function EvalTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: EvalDatum }[];
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const pawns = point.cpPawns;
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs shadow-lg">
      <div className="font-medium text-zinc-200">
        Move {Math.floor(point.ply / 2) + 1}
        {point.ply % 2 === 0 ? ". White" : "… Black"}
        {point.san ? ` · ${point.san}` : ""}
      </div>
      <div className="font-mono text-zinc-300">
        {pawns >= 0 ? "+" : ""}
        {pawns.toFixed(1)} for you
        {point.classification ? (
          <span style={{ color: classColor(point.classification) }}>
            {" "}
            · {classLabel(point.classification)}
            {classGlyph(point.classification) ? ` ${classGlyph(point.classification)}` : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default function EvalGraph({
  points,
  currentPly = -1,
  onSelect,
}: {
  points: EvalPoint[];
  currentPly?: number;
  onSelect?: (ply: number) => void;
}) {
  if (points.length === 0) {
    return <div className="text-sm text-zinc-400">No evaluation data yet.</div>;
  }

  const data: EvalDatum[] = points.map((p) => ({
    ply: p.ply,
    cpPawns: Math.max(-10, Math.min(10, p.cp / 100)),
    san: p.san,
    classification: p.classification,
  }));
  const lastPly = data[data.length - 1].ply;
  const marked = data.filter((d) => isError(d.classification) || d.classification === "brilliant");
  const current = currentPly >= 0 ? data.find((d) => d.ply === currentPly) : undefined;

  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 6, right: 12, bottom: 0, left: 0 }}
          onClick={(state) => {
            const label = Number((state as { activeLabel?: string | number } | null)?.activeLabel);
            if (onSelect && Number.isInteger(label)) onSelect(label);
          }}
          role="img"
          aria-label={`Evaluation graph, ${data.length} plies. Use the move list or arrow keys to step through the game; each critical move is marked on the line.`}
        >
          <CartesianGrid stroke="#3f3f46" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="ply"
            type="number"
            domain={[0, lastPly]}
            tickFormatter={(ply: number) => String(Math.floor(ply / 2) + 1)}
            tick={{ fontSize: 10, fill: "#a1a1aa" }}
            axisLine={{ stroke: "#3f3f46" }}
            tickLine={false}
          />
          <YAxis
            domain={[-10, 10]}
            ticks={[-8, -4, 0, 4, 8]}
            width={34}
            tickFormatter={(v: number) => (v > 0 ? `+${v}` : String(v))}
            tick={{ fontSize: 10, fill: "#a1a1aa" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<EvalTooltip />} />
          <ReferenceLine y={0} stroke="#52525b" />
          {current ? <ReferenceLine x={current.ply} stroke="#e4e4e7" strokeWidth={1.5} /> : null}
          {marked.map((d) => (
            <ReferenceDot
              key={d.ply}
              x={d.ply}
              y={d.cpPawns}
              r={3.5}
              fill={classColor(d.classification)}
              stroke="#09090b"
              strokeWidth={1}
            />
          ))}
          <Line
            type="stepAfter"
            dataKey="cpPawns"
            stroke="#a78bfa"
            dot={false}
            strokeWidth={2}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
