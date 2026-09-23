"use client";

import { useEffect, useRef } from "react";
import { CLASS_BLURBS, CLASS_GLYPHS, CLASS_LABELS, CLASS_ORDER, classColor, classGlyph, classLabel, isError } from "./colors";

export interface MoveListItem {
  ply: number;
  san: string | null;
  color: "w" | "b";
  classification: string | null;
  isCritical: boolean;
  centipawnLoss?: number | null;
}

/** Higher wins when a row holds two moves and only one dot fits. */
const SEVERITY: Record<string, number> = {
  blunder: 5,
  miss: 4,
  mistake: 3,
  inaccuracy: 2,
  brilliant: 1,
};

function worstClass(a: string | null, b: string | null): string | null {
  const sa = SEVERITY[a ?? ""] ?? 0;
  const sb = SEVERITY[b ?? ""] ?? 0;
  if (sa === 0 && sb === 0) return null;
  return sa >= sb ? a : b;
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
  const itemRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  // Stepping with the keyboard or the transport buttons should keep the move
  // you are on visible, not leave the list parked where it was.
  useEffect(() => {
    itemRefs.current[currentPly]?.scrollIntoView({ block: "nearest" });
  }, [currentPly]);

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
        type="button"
        onClick={() => onSelect(-1)}
        aria-current={currentPly === -1 ? "true" : undefined}
        className={`mb-1 mr-1 min-h-9 rounded px-2 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
          currentPly === -1 ? "bg-indigo-600 text-white" : "text-zinc-300 hover:bg-zinc-800"
        }`}
      >
        Start
      </button>

      {rows.map((row) => {
        const worst = worstClass(row.white?.classification ?? null, row.black?.classification ?? null);
        return (
          <div key={row.number} className="flex items-center gap-0.5">
            <span className="flex w-4 shrink-0 justify-center" aria-hidden>
              {worst ? (
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: classColor(worst) }}
                />
              ) : null}
            </span>
            <span className="w-6 shrink-0 pr-1 text-right text-xs tabular-nums text-zinc-400">
              {row.number}.
            </span>
            {[row.white, row.black].map((m, idx) =>
              m ? (
                <button
                  key={m.ply}
                  type="button"
                  ref={(el) => {
                    itemRefs.current[m.ply] = el;
                  }}
                  onClick={() => onSelect(m.ply)}
                  aria-current={currentPly === m.ply ? "true" : undefined}
                  aria-label={`Move ${row.number}, ${m.color === "w" ? "White" : "Black"} ${m.san ?? "…"}${
                    m.classification ? `, ${classLabel(m.classification)}` : ""
                  }${m.centipawnLoss != null && isError(m.classification) ? `, lost ${(m.centipawnLoss / 100).toFixed(1)} pawns` : ""}`}
                  className={`flex min-h-9 flex-1 items-center gap-0.5 rounded px-1.5 py-1 text-left text-[13px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400 ${
                    currentPly === m.ply ? "bg-indigo-600/90 text-white" : "text-zinc-100 hover:bg-zinc-800"
                  }`}
                  style={currentPly !== m.ply ? { color: classColor(m.classification) } : undefined}
                >
                  <span>{m.san}</span>
                  {classGlyph(m.classification) ? (
                    <span
                      className="text-[10px] font-bold"
                      style={{ color: currentPly === m.ply ? "#fff" : classColor(m.classification) }}
                    >
                      {classGlyph(m.classification)}
                    </span>
                  ) : null}
                  {m.centipawnLoss != null && isError(m.classification) ? (
                    <span
                      className={`ml-auto font-mono text-[10px] font-normal ${
                        currentPly === m.ply ? "text-white/80" : "text-zinc-400"
                      }`}
                    >
                      −{Math.round(m.centipawnLoss / 100 * 10) / 10}
                    </span>
                  ) : null}
                </button>
              ) : (
                <span key={`${row.number}-${idx}`} className="min-h-9 flex-1" />
              )
            )}
          </div>
        );
      })}

      <details className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-zinc-300">
          What the colours and marks mean
        </summary>
        <ul className="mt-2 space-y-1">
          {CLASS_ORDER.map((key) => (
            <li key={key} className="flex items-baseline gap-2 text-xs">
              <span className="w-5 shrink-0 text-right font-bold" style={{ color: classColor(key) }}>
                {CLASS_GLYPHS[key] ?? "•"}
              </span>
              <span className="shrink-0 font-semibold" style={{ color: classColor(key) }}>
                {CLASS_LABELS[key]}
              </span>
              <span className="text-zinc-400">{CLASS_BLURBS[key]}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
