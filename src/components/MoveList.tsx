"use client";

import { classColor, CLASS_LABELS } from "./colors";

export interface MoveListItem {
  ply: number;
  san: string | null;
  color: "w" | "b";
  classification: string | null;
  isCritical: boolean;
}

export default function MoveList({
  moves,
  currentPly,
  onSelect,
}: {
  moves: MoveListItem[];
  currentPly: number; // -1 = start position
  onSelect: (ply: number) => void;
}) {
  // Pair white/black moves into rows.
  const rows: { number: number; white: MoveListItem | null; black: MoveListItem | null }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push({
      number: Math.floor(i / 2) + 1,
      white: moves[i] ?? null,
      black: moves[i + 1] ?? null,
    });
  }

  return (
    <div className="max-h-[420px] overflow-auto pr-1 text-sm">
      <button
        onClick={() => onSelect(-1)}
        className={`mb-1 mr-1 rounded px-2 py-0.5 text-xs font-medium ${
          currentPly === -1 ? "bg-indigo-600 text-white" : "text-zinc-400 hover:bg-zinc-800"
        }`}
      >
        Start
      </button>
      {rows.map((row) => (
        <div key={row.number} className="flex items-center">
          <span className="w-8 shrink-0 text-right pr-2 text-xs text-zinc-500">{row.number}.</span>
          {[row.white, row.black].map((m, idx) =>
            m ? (
              <button
                key={m.ply}
                onClick={() => onSelect(m.ply)}
                className={`w-1/2 rounded px-2 py-0.5 text-left font-semibold transition-colors ${
                  currentPly === m.ply ? "bg-indigo-600/90 text-white" : "hover:bg-zinc-800 text-zinc-100"
                }`}
                style={currentPly !== m.ply ? { color: classColor(m.classification) } : undefined}
                title={m.classification ? CLASS_LABELS[m.classification] : undefined}
              >
                {m.san}
              </button>
            ) : (
              <span key={`${row.number}-${idx}`} className="w-1/2" />
            )
          )}
        </div>
      ))}
    </div>
  );
}
