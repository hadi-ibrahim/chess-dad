"use client";

import { winProb } from "@/lib/score";

export default function EvalBar({
  cp,
  height = 480,
}: {
  cp: number;
  height?: number;
}) {
  const white = winProb(cp);
  const whitePct = Math.max(4, Math.min(96, white * 100));

  return (
    <div className="flex items-center gap-2 select-none">
      <div
        className="relative w-5 shrink-0 overflow-hidden rounded-sm border border-zinc-700 bg-zinc-800"
        style={{ height }}
        aria-label={`Evaluation ${cp > 0 ? "+" : ""}${(cp / 100).toFixed(2)}`}
      >
        <div
          className="absolute inset-x-0 top-0 bg-zinc-100 transition-[height] duration-200"
          style={{ height: `${whitePct}%` }}
        />
        <div className="absolute inset-x-0 top-1/2 h-px bg-zinc-400/40" />
      </div>
      <div className="text-[11px] font-mono text-zinc-400 leading-tight">
        {cp >= 100 ? "⩾" : ""}
        {cp >= 0 ? "+" : ""}
        {(cp / 100).toFixed(1)}
      </div>
    </div>
  );
}
