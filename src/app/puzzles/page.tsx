"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
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
  explanation: string | null;
  key_lesson: string | null;
}

interface SrsResult {
  ease: number;
  intervalDays: number;
  repetitions: number;
  dueAt: string;
}

const CATEGORIES: { key: string | null; label: string }[] = [
  { key: null, label: "All" },
  { key: "tactical", label: "Tactical" },
  { key: "hung-piece", label: "Hung piece" },
  { key: "missed-capture", label: "Missed capture" },
  { key: "missed-mate", label: "Missed mate" },
];

const LIST_PAGE = 60;

function themeKey(p: Puzzle): string {
  return p.theme ?? "positional";
}

function isDue(p: Puzzle): boolean {
  return !p.due_at || new Date(p.due_at).getTime() <= Date.now();
}

export default function Puzzles() {
  const [puzzles, setPuzzles] = useState<Puzzle[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string | null>(null);
  const [dueOnly, setDueOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE);
  const [index, setIndex] = useState(0);

  // Attempt state for the puzzle on the board.
  const [attempt, setAttempt] = useState<{ from: string; to: string; san: string } | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [illegal, setIllegal] = useState<string | null>(null);
  const [hintStage, setHintStage] = useState<0 | 1 | 2>(0);
  const [outcome, setOutcome] = useState<"solved" | "assisted" | "shown" | null>(null);
  const [boardKey, setBoardKey] = useState(0);

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

  const counts = useMemo(() => {
    const byCategory: Record<string, number> = {};
    let due = 0;
    for (const p of puzzles) {
      const key = themeKey(p);
      byCategory[key] = (byCategory[key] ?? 0) + 1;
      if (isDue(p)) due += 1;
    }
    return { byCategory, due };
  }, [puzzles]);

  const filtered = useMemo(() => {
    let list = puzzles;
    if (category) list = list.filter((p) => themeKey(p) === category);
    if (dueOnly) list = list.filter(isDue);
    return list;
  }, [puzzles, category, dueOnly]);

  // A filter change is a new drill set: start it from the top, clean.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting the drill when the set changes
    setIndex(0);
    setVisibleCount(LIST_PAGE);
  }, [category, dueOnly]);

  const puzzle: Puzzle | null = filtered[index] ?? null;

  function resetAttemptState() {
    setAttempt(null);
    setIllegal(null);
    setHintStage(0);
    setAttempts(0);
    setOutcome(null);
    setBoardKey((k) => k + 1);
  }

  function goTo(nextIndex: number) {
    setIndex(nextIndex);
    resetAttemptState();
  }

  const solutionFrom = puzzle ? puzzle.solution_uci.slice(0, 2) : "";
  const solutionTo = puzzle ? puzzle.solution_uci.slice(2, 4) : "";
  const orientation = puzzle && puzzle.fen.split(" ")[1] === "w" ? "white" : "black";

  const arrows = useMemo(() => {
    if (!puzzle) return [];
    if (hintStage === 2 || outcome === "shown") {
      return [{ startSquare: solutionFrom, endSquare: solutionTo, color: "#22c55e" }];
    }
    return [];
  }, [puzzle, hintStage, outcome, solutionFrom, solutionTo]);

  const squareStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};
    if (!puzzle) return styles;
    if (hintStage >= 1) {
      styles[solutionFrom] = {
        backgroundColor: "rgba(234, 179, 8, 0.35)",
        boxShadow: "inset 0 0 0 3px #eab308",
      };
    }
    if (hintStage === 2) {
      styles[solutionTo] = {
        backgroundColor: "rgba(34, 197, 94, 0.3)",
        boxShadow: "inset 0 0 0 3px #22c55e",
      };
    }
    // A wrong attempt is drawn over the hints so it is unmistakable.
    if (attempt) {
      const wrong = {
        backgroundColor: "rgba(251, 113, 133, 0.3)",
        boxShadow: "inset 0 0 0 3px #fb7185",
      };
      if (attempt.from) styles[attempt.from] = wrong;
      if (attempt.to) styles[attempt.to] = wrong;
    }
    return styles;
  }, [puzzle, hintStage, attempt, solutionFrom, solutionTo]);

  const marks = useMemo(() => {
    if (!puzzle) return {};
    if (attempt?.to) return { [attempt.to]: { text: "✗", color: "#fb7185" } };
    if (outcome && (hintStage === 2 || outcome === "shown")) {
      return { [solutionTo]: { text: "✓", color: "#22c55e" } };
    }
    return {};
  }, [puzzle, attempt, outcome, hintStage, solutionTo]);

  function recordSrs(correct: boolean) {
    if (!puzzle) return;
    const id = puzzle.id;
    void fetch("/api/puzzles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, correct }),
    })
      .then((r) => r.json())
      .then((srs: SrsResult) => {
        setPuzzles((prev) =>
          prev.map((p) =>
            p.id === id
              ? {
                  ...p,
                  solved_count: p.solved_count + (correct ? 1 : 0),
                  fail_count: p.fail_count + (correct ? 0 : 1),
                  ease: srs.ease ?? p.ease,
                  interval_days: srs.intervalDays ?? p.interval_days,
                  repetitions: srs.repetitions ?? p.repetitions,
                  due_at: srs.dueAt ?? p.due_at,
                }
              : p
          )
        );
      })
      .catch(() => {
        /* the drill still moves on; the counter just stays stale */
      });
  }

  function finish(kind: "solved" | "assisted" | "shown") {
    if (!puzzle || outcome) return;
    setOutcome(kind);
    setAttempt(null);
    setIllegal(null);
    // A hinted or revealed solve is not a clean recall, so the spaced-repetition
    // schedule treats it as a miss and brings the position back sooner.
    recordSrs(kind === "solved");
  }

  function onDrop(source: string, target: string): boolean {
    if (!puzzle || outcome || attempt) return false;
    const chess = new Chess(puzzle.fen);
    let move;
    try {
      move = chess.move({ from: source, to: target, promotion: "q" });
    } catch {
      move = null;
    }
    if (!move) {
      setIllegal(`${source}–${target} is not a legal move in this position.`);
      return false;
    }
    if (move.lan === puzzle.solution_uci) {
      finish(hintStage > 0 ? "assisted" : "solved");
      return true;
    }
    setAttempts((n) => n + 1);
    setAttempt({ from: source, to: target, san: move.san ?? "" });
    setIllegal(null);
    return true;
  }

  function advanceHint() {
    if (hintStage === 0) setHintStage(1);
    else if (hintStage === 1) setHintStage(2);
  }

  // Keyboard: n = next drill, h = hint, r = try again.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "n" || e.key === "N") {
        if (filtered.length > 0) goTo((index + 1) % filtered.length);
      } else if (e.key === "h" || e.key === "H") {
        advanceHint();
      } else if (e.key === "r" || e.key === "R") {
        resetAttemptState();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers close over the current drill only
  }, [filtered.length, index, hintStage, outcome, attempt]);

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Puzzles</h1>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-zinc-400">
          Loading your drills…
        </div>
      </div>
    );
  }

  if (puzzles.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Puzzles</h1>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-zinc-300">
          No personal puzzles yet. Analyse some games and your own mistakes become drills here.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Puzzles</h1>
        <p className="text-sm text-zinc-400">
          Positions you actually got wrong, on a spaced-repetition schedule. {puzzles.length} drills ·{" "}
          {counts.due} due now.
        </p>
      </div>

      {/* Categories: pick what to drill, not just the next item in a list. */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Puzzle categories">
        {CATEGORIES.map((c) => {
          const count = c.key ? counts.byCategory[c.key] ?? 0 : puzzles.length;
          const active = category === c.key;
          return (
            <button
              key={c.label}
              type="button"
              onClick={() => setCategory(c.key)}
              aria-pressed={active}
              disabled={count === 0}
              className={`min-h-9 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-40 ${
                active
                  ? "border-indigo-500 bg-indigo-600 text-white"
                  : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {c.label}
              <span className={active ? "text-white/80" : "text-zinc-400"}> {count}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setDueOnly((d) => !d)}
          aria-pressed={dueOnly}
          className={`min-h-9 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
            dueOnly ? "border-emerald-600 bg-emerald-950/40 text-emerald-200" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          }`}
        >
          Due now
          <span className={dueOnly ? "text-emerald-200/80" : "text-zinc-400"}> {counts.due}</span>
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-zinc-300">
          Nothing due in this category. Turn off “Due now” to drill ahead of schedule.
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm">
                You play <span className="font-semibold text-zinc-100">{orientation === "white" ? "White" : "Black"}</span>
              </span>
              <span className="text-sm text-zinc-300">Find the best move.</span>
              {puzzle.theme ? (
                <span className="rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-xs text-indigo-300">
                  {puzzle.theme.replace(/-/g, " ")}
                </span>
              ) : null}
              <span className="ml-auto font-mono text-xs text-zinc-400">
                {index + 1} / {filtered.length}
              </span>
            </div>

            <div className="min-w-0" style={{ maxWidth: "min(640px, 62vh)" }}>
              <ChessBoard
                key={boardKey}
                fen={puzzle.fen}
                orientation={orientation}
                interactive={!outcome && !attempt}
                onDrop={onDrop}
                arrows={arrows}
                squareStyles={squareStyles}
                marks={marks}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={advanceHint}
                disabled={hintStage === 2 || outcome !== null}
                className="min-h-10 rounded-lg border border-amber-700/70 px-3 text-sm font-semibold text-amber-200 hover:bg-amber-950/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:opacity-40"
              >
                {hintStage === 0
                  ? "Hint: which piece?"
                  : hintStage === 1
                    ? "Hint: where to?"
                    : "Hint shown"}
              </button>
              <button
                type="button"
                onClick={() => finish("shown")}
                disabled={outcome !== null}
                className="min-h-10 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-40"
              >
                Show solution
              </button>
              <button
                type="button"
                onClick={resetAttemptState}
                disabled={attempts === 0 && hintStage === 0 && !outcome}
                className="min-h-10 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-40"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => goTo((index + 1) % filtered.length)}
                className="ml-auto min-h-10 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
              >
                Next puzzle
              </button>
              <p className="hidden text-xs text-zinc-400 lg:block">
                <kbd className="rounded bg-zinc-800 px-1">H</kbd> hint ·{" "}
                <kbd className="rounded bg-zinc-800 px-1">R</kbd> try again ·{" "}
                <kbd className="rounded bg-zinc-800 px-1">N</kbd> next
              </p>
            </div>

            {illegal ? (
              <p role="alert" className="rounded-xl border border-amber-800 bg-amber-950/40 p-3 text-sm text-amber-200">
                {illegal}
              </p>
            ) : null}

            {attempt && !outcome ? (
              <div className="rounded-xl border border-rose-800 bg-rose-950/40 p-4">
                <p className="text-sm text-rose-200">
                  <span aria-hidden className="mr-1 font-bold">
                    ✗
                  </span>
                  <span className="font-semibold">{attempt.san}</span> isn&apos;t the move.
                  {attempts > 1 ? " Still not it — take the hint or step through the position." : " Look for a forcing reply."}
                </p>
                <p className="mt-1 text-xs text-rose-300/80">
                  The attempt is marked on the board. Try again, or take a hint.
                </p>
              </div>
            ) : null}

            {outcome ? (
              <div
                className={`rounded-xl border p-4 ${
                  outcome === "shown"
                    ? "border-zinc-700 bg-zinc-900/60"
                    : "border-emerald-800 bg-emerald-950/40"
                }`}
              >
                <p className={`text-sm ${outcome === "shown" ? "text-zinc-200" : "text-emerald-200"}`}>
                  {outcome === "solved" ? (
                    <>
                      <span aria-hidden className="mr-1 font-bold">
                        ✓
                      </span>
                      <span className="font-semibold">{puzzle.solution_san}</span> — that&apos;s the move.
                    </>
                  ) : outcome === "assisted" ? (
                    <>
                      <span aria-hidden className="mr-1 font-bold">
                        ✓
                      </span>
                      <span className="font-semibold">{puzzle.solution_san}</span> — with a hint. This
                      drill comes back sooner, which is the point.
                    </>
                  ) : (
                    <>
                      The move was <span className="font-semibold">{puzzle.solution_san}</span>. Now play
                      it on the board.
                    </>
                  )}
                </p>
                {puzzle.explanation ? (
                  <p className="mt-2 text-sm text-zinc-200">{puzzle.explanation}</p>
                ) : null}
                {puzzle.key_lesson ? (
                  <p className="mt-1 text-sm text-emerald-300">
                    <span className="font-semibold">Lesson:</span> {puzzle.key_lesson}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                  <span>
                    {puzzle.white} vs {puzzle.black} · {puzzle.opening || "unknown opening"}
                  </span>
                  <Link href={`/review/${puzzle.game_id}`} className="underline hover:text-zinc-200">
                    Open the game review
                  </Link>
                  <span className="ml-auto font-mono">
                    reps {puzzle.repetitions} · {puzzle.interval_days}d · ease {puzzle.ease.toFixed(1)}
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              {category ? CATEGORIES.find((c) => c.key === category)?.label : "All drills"}
              {dueOnly ? " · due now" : ""} ({filtered.length})
            </h2>
            <div className="max-h-[560px] overflow-auto rounded-xl border border-zinc-800">
              {filtered.slice(0, visibleCount).map((p, i) => {
                const active = i === index;
                const due = isDue(p);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => goTo(i)}
                    aria-current={active ? "true" : undefined}
                    className={`block w-full border-b border-zinc-800 px-3 py-2 text-left text-sm last:border-b-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-400 ${
                      active ? "bg-indigo-950/60" : "hover:bg-zinc-900"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-zinc-400">#{p.id}</span>
                      <span className="truncate text-zinc-200">
                        {p.white} vs {p.black}
                      </span>
                      {due ? (
                        <span className="ml-auto shrink-0 rounded bg-emerald-950 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
                          due
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-400">
                      <span>{p.theme?.replace(/-/g, " ") ?? "positional"}</span>
                      <span className="ml-auto font-mono">
                        {p.solved_count}✓ {p.fail_count}✗
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            {filtered.length > visibleCount ? (
              <button
                type="button"
                onClick={() => setVisibleCount((n) => n + LIST_PAGE)}
                className="w-full rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
              >
                Show {Math.min(LIST_PAGE, filtered.length - visibleCount)} more (
                {filtered.length - visibleCount} left)
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
