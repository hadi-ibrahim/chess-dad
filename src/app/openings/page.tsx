"use client";

import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import ChessBoard from "@/components/ChessBoard";

interface Opening {
  eco: string;
  name: string;
  uci: string[];
  wikipedia: string;
}

export default function Openings() {
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [selected, setSelected] = useState<Opening | null>(null);
  const [fen, setFen] = useState(new Chess().fen());
  const [step, setStep] = useState(0);
  const [practicing, setPracticing] = useState(false);
  const [practiceColor, setPracticeColor] = useState<"w" | "b">("w");
  const [playedUci, setPlayedUci] = useState<string[]>([]);
  const [deviation, setDeviation] = useState<{ played: string; expected: string | null } | null>(null);

  const chessRef = useRef(new Chess());

  useEffect(() => {
    void fetch("/api/openings")
      .then((r) => r.json())
      .then((d) => setOpenings((d.openings as Opening[]) || []));
  }, []);

  function resetFor(opening: Opening, color: "w" | "b") {
    const chess = new Chess();
    chessRef.current = chess;
    setPracticing(true);
    setPracticeColor(color);
    setPlayedUci([]);
    setDeviation(null);
    setStep(0);
    if (color === "b" && opening.uci.length > 0) {
      chess.move({ from: opening.uci[0].slice(0, 2), to: opening.uci[0].slice(2, 4), promotion: opening.uci[0].slice(4, 5) || undefined } as never);
      setPlayedUci([opening.uci[0]]);
    }
    setFen(chess.fen());
  }

  function stepTo(opening: Opening, target: number) {
    const chess = new Chess();
    const n = Math.max(0, Math.min(opening.uci.length, target));
    for (let i = 0; i < n; i++) {
      chess.move({ from: opening.uci[i].slice(0, 2), to: opening.uci[i].slice(2, 4), promotion: opening.uci[i].slice(4, 5) || undefined } as never);
    }
    chessRef.current = chess;
    setStep(n);
    setFen(chess.fen());
  }

  function selectOpening(opening: Opening) {
    setSelected(opening);
    setPracticing(false);
    setDeviation(null);
    setPlayedUci([]);
    stepTo(opening, 0);
  }

  function onDrop(source: string, target: string): boolean {
    if (!selected || !practicing) return false;
    const chess = chessRef.current;
    const turn = chess.turn();
    if (turn !== practiceColor) return false; // not your turn

    let move;
    try {
      move = chess.move({ from: source, to: target, promotion: "q" });
    } catch {
      return false;
    }
    if (!move) return false;

    const expected = selected.uci[playedUci.length] ?? null;
    if (move.lan !== expected) {
      // Deviation — still apply the move, but stop auto-replying.
      setDeviation({ played: move.san, expected: expected ? uciToSan(expected, selected) : null });
      setPlayedUci((p) => [...p, move.lan]);
      setFen(chess.fen());
      return true;
    }

    // Correct move — apply the opponent's reply from the line.
    const next: string[] = [move.lan];
    while (next.length + playedUci.length < selected.uci.length) {
      const idx = playedUci.length + next.length;
      const moverIsPlayer = idx % 2 === (practiceColor === "w" ? 0 : 1);
      if (moverIsPlayer) break;
      const reply = selected.uci[idx];
      chess.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply.slice(4, 5) || undefined } as never);
      next.push(reply);
    }
    setPlayedUci((p) => [...p, ...next]);
    setFen(chess.fen());
    return true;
  }

  function uciToSan(uci: string, opening: Opening): string {
    // Replay the line up to this move to obtain the SAN.
    const chess = new Chess();
    const idx = opening.uci.indexOf(uci);
    for (let i = 0; i < idx; i++) {
      chess.move({ from: opening.uci[i].slice(0, 2), to: opening.uci[i].slice(2, 4), promotion: opening.uci[i].slice(4, 5) || undefined } as never);
    }
    const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined } as never);
    return m?.san ?? uci;
  }

  const boardOrientation = practicing ? (practiceColor === "w" ? "white" : "black") : "white";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Opening trainer</h1>
        <p className="text-sm text-zinc-400">
          Step through main lines or practice them — the app flags the moment you leave theory.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          {selected ? (
            <div className="flex items-start gap-4">
              <div style={{ maxWidth: 480 }} className="min-w-0 flex-1">
                <ChessBoard fen={fen} orientation={boardOrientation} interactive={practicing} onDrop={onDrop} />
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  {!practicing ? (
                    <>
                      <button onClick={() => stepTo(selected, step - 1)} className="rounded bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700">◀</button>
                      <span className="text-zinc-400">{step}/{selected.uci.length} moves</span>
                      <button onClick={() => stepTo(selected, step + 1)} className="rounded bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700">▶</button>
                      <span className="mx-2 text-zinc-600">|</span>
                      <button onClick={() => resetFor(selected, "w")} className="rounded bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-500">Practice as White</button>
                      <button onClick={() => resetFor(selected, "b")} className="rounded bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-500">Practice as Black</button>
                    </>
                  ) : (
                    <>
                      <span className="text-zinc-400">Practice as {practiceColor === "w" ? "White" : "Black"}</span>
                      {deviation ? (
                        <span className="rounded bg-amber-900/40 px-2 py-1 text-amber-300">
                          You left theory: played {deviation.played}{deviation.expected ? `, expected ${deviation.expected}` : ""}
                        </span>
                      ) : (
                        <span className="text-emerald-400">In theory</span>
                      )}
                      <button onClick={() => selectOpening(selected)} className="rounded bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700">Reset</button>
                    </>
                  )}
                </div>
              </div>
              <div className="hidden min-w-[180px] md:block">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Main line</h3>
                <ol className="space-y-1 font-mono text-sm text-zinc-300">
                  {selected.uci.map((u, i) => (
                    <li key={i} className={i === step - 1 && !practicing ? "text-indigo-300" : ""}>
                      {i % 2 === 0 ? `${Math.floor(i / 2) + 1}.` : ""} {uciToSan(u, selected)}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-zinc-400">
              Select an opening to get started.
            </div>
          )}
        </div>

        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Openings ({openings.length})</h2>
          <div className="max-h-[520px] overflow-auto rounded-xl border border-zinc-800">
            {openings.map((o) => (
              <button
                key={o.eco}
                onClick={() => selectOpening(o)}
                className={`block w-full border-b border-zinc-800 px-3 py-2 text-left hover:bg-zinc-900 ${
                  selected?.eco === o.eco ? "bg-zinc-900" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-zinc-100">{o.name}</span>
                  <span className="font-mono text-xs text-zinc-500">{o.eco}</span>
                </div>
                {selected?.eco === o.eco && (
                  <a href={o.wikipedia} target="_blank" rel="noreferrer" className="text-xs text-indigo-400 hover:underline">
                    Wikipedia → strategic ideas
                  </a>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
