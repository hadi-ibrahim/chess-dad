"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ChessBoard from "@/components/ChessBoard";
import EvalBar from "@/components/EvalBar";
import EvalGraph, { type EvalPoint } from "@/components/EvalGraph";
import MoveList, { type MoveListItem } from "@/components/MoveList";
import { classColor, CLASS_LABELS } from "@/components/colors";

interface Game {
  id: number;
  source: string;
  white: string;
  black: string;
  white_rating: number | null;
  black_rating: number | null;
  result: string;
  speed: string;
  eco: string;
  opening_name: string;
  player_color: "w" | "b";
  player_rating: number | null;
  opponent: string;
  analyzed: number;
  accuracy: number | null;
}

interface Position {
  id: number;
  ply: number;
  color: "w" | "b";
  fen: string;
  san: string | null;
  uci: string | null;
  fen_after: string;
  best_move: string | null;
  best_move_san: string | null;
  eval_before: number | null;
  mate_before: number | null;
  eval_after: number | null;
  mate_after: number | null;
  centipawn_loss: number | null;
  classification: string | null;
  motif: string | null;
  phase: string | null;
  clock_seconds: number | null;
  is_critical: number;
  explanation: string | null;
  key_lesson: string | null;
  drill_suggestion: string | null;
}

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export default function GameReview({ id }: { id: string }) {
  const [game, setGame] = useState<Game | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [currentPly, setCurrentPly] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [depth, setDepth] = useState(14);
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/games/${id}`);
    if (!res.ok) {
      setError("Game not found.");
      return;
    }
    const data = await res.json();
    setGame(data.game);
    setPositions((data.positions as Position[]) || []);
    setCurrentPly(-1);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch via a reusable loader
    void load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage must be read post-hydration
    setNotes(localStorage.getItem(`chessmentor-note-${id}`) ?? "");
  }, [id]);

  function saveNotes(value: string) {
    setNotes(value);
    localStorage.setItem(`chessmentor-note-${id}`, value);
  }

  async function analyze() {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${id}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depth }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Analysis failed");
      else await load();
    } catch {
      setError("Analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  }

  const orientation = game?.player_color === "b" ? "black" : "white";

  const currentFen = useMemo(() => {
    if (positions.length === 0) return START_FEN;
    return currentPly === -1 ? positions[0].fen : positions[currentPly].fen_after;
  }, [positions, currentPly]);

  // Evaluation of the displayed position, from White's perspective.
  const whiteEval = useMemo(() => {
    if (positions.length === 0) return null;
    if (currentPly === -1) {
      const p = positions[0];
      if (p.eval_before == null) return null;
      return p.color === "w" ? p.eval_before : -p.eval_before;
    }
    const p = positions[currentPly];
    if (p.eval_after == null) return null;
    const sideAfter = p.color === "w" ? "b" : "w";
    return sideAfter === "w" ? p.eval_after : -p.eval_after;
  }, [positions, currentPly]);

  const currentBestArrow = useMemo(() => {
    if (currentPly === -1 || currentPly >= positions.length) return [];
    const best = positions[currentPly].best_move;
    if (!best || best.length < 4) return [];
    return [
      {
        startSquare: best.slice(0, 2),
        endSquare: best.slice(2, 4),
        color: "#22c55e",
      },
    ];
  }, [positions, currentPly]);

  const moveListItems: MoveListItem[] = useMemo(
    () =>
      positions.map((p) => ({
        ply: p.ply,
        san: p.san,
        color: p.color,
        classification: p.classification,
        isCritical: p.is_critical === 1,
      })),
    [positions]
  );

  const graphPoints: EvalPoint[] = useMemo(() => {
    if (!game) return [];
    return positions
      .filter((p) => p.eval_before != null)
      .map((p) => ({
        ply: p.ply,
        moveNumber: Math.floor(p.ply / 2) + 1,
        cp: p.color === game.player_color ? p.eval_before! : -p.eval_before!,
        san: p.san,
        classification: p.classification,
      }));
  }, [positions, game]);

  const critical = useMemo(
    () => positions.filter((p) => p.is_critical === 1 && p.color === game?.player_color),
    [positions, game]
  );

  const current = currentPly >= 0 && currentPly < positions.length ? positions[currentPly] : null;
  const currentClass = current?.classification ?? null;

  if (error && !game) {
    return (
      <div className="rounded-xl border border-rose-900 bg-rose-950/40 p-6 text-rose-300">
        {error} <Link href="/" className="underline">Back to games</Link>
      </div>
    );
  }

  if (!game) {
    return <div className="py-16 text-center text-zinc-500">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold">
              {game.white} <span className="text-zinc-500">vs</span> {game.black}
            </h1>
            <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-sm">{game.result}</span>
          </div>
          <p className="text-sm text-zinc-400">
            {game.opening_name ? `${game.opening_name} (${game.eco})` : "Opening unknown"} ·{" "}
            <span className="capitalize">{game.speed}</span> · {game.source} · you played{" "}
            {game.player_color === "w" ? "White" : "Black"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {game.analyzed && game.accuracy != null && (
            <span className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm">
              Accuracy <span className="font-bold text-indigo-300">{game.accuracy.toFixed(1)}%</span>
            </span>
          )}
          {!game.analyzed ? (
            <div className="flex items-center gap-2">
              <select
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
              >
                <option value={10}>Quick (10)</option>
                <option value={14}>Standard (14)</option>
                <option value={18}>Deep (18)</option>
              </select>
              <button
                onClick={analyze}
                disabled={analyzing}
                className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {analyzing ? "Analyzing…" : "Analyze"}
              </button>
            </div>
          ) : (
            <button
              onClick={analyze}
              disabled={analyzing}
              className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700 disabled:opacity-50"
            >
              {analyzing ? "Re-analyzing…" : "Re-analyze"}
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="flex gap-3">
            {whiteEval != null && <EvalBar cp={whiteEval} height={480} />}
            <div className="min-w-0 flex-1">
              <ChessBoard fen={currentFen} orientation={orientation} arrows={currentBestArrow} />
              <div className="mt-3 flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <button onClick={() => setCurrentPly(-1)} className="rounded bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700">⏮</button>
                  <button onClick={() => setCurrentPly((p) => Math.max(-1, p - 1))} className="rounded bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700">◀</button>
                  <button onClick={() => setCurrentPly((p) => Math.min(positions.length - 1, p + 1))} className="rounded bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700">▶</button>
                  <button onClick={() => setCurrentPly(positions.length - 1)} className="rounded bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700">⏭</button>
                </div>
                {current && (
                  <div className="text-right">
                    <span className="font-semibold">{current.san}</span>
                    {currentClass && (
                      <span className="ml-2 rounded px-2 py-0.5 text-xs font-bold" style={{ background: `${classColor(currentClass)}22`, color: classColor(currentClass) }}>
                        {CLASS_LABELS[currentClass] ?? currentClass}
                      </span>
                    )}
                    {current.best_move_san && current.best_move_san !== current.san && (
                      <div className="text-xs text-zinc-500">Best: {current.best_move_san}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="mt-4">
            <EvalGraph points={graphPoints} />
          </div>
        </div>

        <div className="space-y-4">
          <MoveList moves={moveListItems} currentPly={currentPly} onSelect={setCurrentPly} />

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Your notes</h3>
            <textarea
              value={notes}
              onChange={(e) => saveNotes(e.target.value)}
              placeholder="Annotate your own thoughts before (or after) seeing the engine…"
              rows={5}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </div>
        </div>
      </div>

      {critical.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Critical moments</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {critical.map((p) => (
              <div key={p.ply} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="mb-1 flex items-center gap-2 text-sm">
                  <button
                    onClick={() => setCurrentPly(p.ply)}
                    className="font-mono font-semibold text-indigo-300 hover:underline"
                  >
                    Move {Math.floor(p.ply / 2) + 1}
                    {p.color === "w" ? ". White" : "… Black"}
                  </button>
                  {p.classification && (
                    <span className="rounded px-2 py-0.5 text-xs font-bold" style={{ background: `${classColor(p.classification)}22`, color: classColor(p.classification) }}>
                      {CLASS_LABELS[p.classification] ?? p.classification}
                    </span>
                  )}
                  {p.motif && <span className="text-xs text-zinc-500">{p.motif.replace(/-/g, " ")}</span>}
                </div>
                <p className="text-sm text-zinc-200">{p.explanation ?? "No explanation yet."}</p>
                {p.key_lesson && (
                  <p className="mt-2 text-sm text-emerald-300">
                    <span className="font-semibold">Lesson:</span> {p.key_lesson}
                  </p>
                )}
                {p.drill_suggestion && (
                  <p className="mt-1 text-sm text-zinc-400">
                    <span className="font-semibold">Drill:</span> {p.drill_suggestion}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
