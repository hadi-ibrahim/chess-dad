"use client";

import { winProb } from "@/lib/score";

export default function EvalBar({
  cp,
  height = "100%",
}: {
  cp: number;
  /** Any CSS length. Defaults to 100%, so the bar matches its board's height. */
  height?: number | string;
}) {
  const white = winProb(cp);
  const whitePct = Math.max(4, Math.min(96, white * 100));
  const label = `${cp >= 100 ? "\u2a7e" : ""}${cp >= 0 ? "+" : ""}${(cp / 100).toFixed(1)}`;
  // A numeric height fixes the wrapper; the default leaves the wrapper auto so the
  // flex line can stretch it to the board's height, and the bar fills that.
  const wrapperHeight = typeof height === "number" ? height : undefined;
  const barHeight = typeof height === "number" ? "100%" : height;

  return (
    <div
      className="flex items-stretch gap-2 select-none"
      style={wrapperHeight != null ? { height: wrapperHeight, alignSelf: "stretch" } : { alignSelf: "stretch" }}
    >
      <div
        role="img"
        aria-label={`Evaluation ${label} pawns, from White's side`}
        className="relative w-5 shrink-0 overflow-hidden rounded-sm border border-zinc-700 bg-zinc-800"
        style={{ height: barHeight }}
      >
        <div
          className="absolute inset-x-0 top-0 bg-zinc-100 transition-[height] duration-200"
          style={{ height: `${whitePct}%` }}
        />
        <div aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-zinc-400/40" />
      </div>
      <div className="hidden self-center text-[11px] font-mono leading-tight text-zinc-400 sm:block">
        {label}
      </div>
    </div>
  );
}
