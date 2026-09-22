"use client";

import { useCallback, useEffect, useState } from "react";
import { Chess } from "chess.js";
import ChessBoard from "@/components/ChessBoard";

interface Puzzle {
  id: number;
  game_id: number;
  fen: string;
  solution_uci: string;
  solution_san: string;
  theme: string | null;
  ease: number;
  interval_days: number;
  repetitions: number;
  due_at: string | null;
  solved_count: number;
  fail_count: number;
  white: string;
  black: string;
  opponent: string;
  result: string;
  opening: string;
}

export default function Puzzles() {
  const [puzzles, setPuzzles] = useState<Puzzle[]>([]);
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<"correct" | "incorrect" | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch("/api/puzzles");
    const data = await res.json();
    setPuzzles((data.puzzles as Puzzle[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch via a reusable loader
    void load();
  }, [load]);

  const puzzle = puzzles[index] ?? null;

  function onDrop(source: string, target: string): boolean {
    if (!puzzle || result) return false;
    const chess = new Chess(puzzle.fen);
    let move;
    try {
      move = chess.move({ from: source, to: target, promotion: "q" });
    } catch {
      return false;
    }
    if (!move) return false; // illegal — revert

    const correct = move.lan === puzzle.solution_uci;
    setResult(correct ? "correct" : "incorrect");
    void fetch("/api/puzzles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: puzzle.id, correct }),
    }).then(() => load());
    return true;
  }

  if (loading) return <div className="py-16 text-center text-zinc-500">Loading puzzles…</div>;

  if (puzzles.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Puzzles</h1>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-zinc-400">
          No personal puzzles yet. Analyze some games and your mistakes become drills here.
        </div>
      </div>
    );
  }

  const orientation = puzzle.fen.split(" ")[1] === "w" ? "white" : "black";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Puzzles</h1>
        <p className="text-sm text-zinc-400">
          Positions you actually got wrong — with spaced repetition. {puzzles.length} total.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1" style={{ maxWidth: 480 }}>
              <ChessBoard fen={puzzle.fen} orientation={orientation} interactive={!result} onDrop={onDrop} />
            </div>
            <div className="min-w-[220px] flex-1 space-y-3">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="text-xs uppercase tracking-wider text-zinc-500">You play {orientation === "white" ? "White" : "Black"}</div>
                <div className="mt-1 text-sm text-zinc-300">Find the best move.</div>
                {puzzle.theme && (
                  <div className="mt-2 inline-block rounded bg-zinc-800 px-2 py-0.5 text-xs text-indigo-300">
                    {puzzle.theme.replace(/-/g, " ")}
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-xs text-zinc-400">
                <div>From: {puzzle.white} vs {puzzle.black}</div>
                <div>{puzzle.opening || "Unknown opening"} · {puzzle.result}</div>
                <div className="mt-2">
                  SRS: {puzzle.repetitions} reps · {puzzle.interval_days}d interval · ease {puzzle.ease.toFixed(1)}
                </div>
              </div>

              {result === "correct" && (
                <div className="rounded-xl border border-emerald-800 bg-emerald-950/40 p-4 text-sm text-emerald-300">
                  Correct! {puzzle.solution_san} was the move.
                </div>
              )}
              {result === "incorrect" && (
                <div className="rounded-xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-300">
                  Not quite — the best move was <span className="font-bold">{puzzle.solution_san}</span>.
                </div>
              )}

              {result && (
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setResult(null);
                      setIndex((i) => (i + 1) % puzzles.length);
                    }}
                    className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                  >
                    Next puzzle
                  </button>
                  <button
                    onClick={() => {
                      setResult(null);
                      setIndex((i) => Math.max(0, i - 1));
                    }}
                    className="rounded-lg bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700"
                  >
                    Back
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">All puzzles</h2>
          <div className="max-h-[420px] overflow-auto rounded-xl border border-zinc-800">
            {puzzles.map((p, i) => (
              <button
                key={p.id}
                onClick={() => {
                  setIndex(i);
                  setResult(null);
                }}
                className={`block w-full border-b border-zinc-800 px-3 py-2 text-left text-sm hover:bg-zinc-900 ${
                  i === index ? "bg-zinc-900" : ""
                }`}
              >
                <span className="font-mono text-zinc-500">#{p.id}</span>{" "}
                <span className="text-zinc-200">{p.white} vs {p.black}</span>
                <div className="text-xs text-zinc-500">
                  {p.theme?.replace(/-/g, " ") ?? "positional"} · {p.solved_count}✓ {p.fail_count}✗
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
