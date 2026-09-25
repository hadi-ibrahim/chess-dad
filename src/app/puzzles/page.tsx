"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Chess, type Square } from "chess.js";
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
  source_classification: string | null;
  source_centipawn_loss: number | null;
  source_ply: number | null;
  source_san: string | null;
  prev_san: string | null;
  /** Cached engine line for this position (UCI): the solution plus the best replies. */
  pv: string[];
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
/** Plies played out after the solution: engine reply, your reply, engine, yours. */
const MAX_LINE_PLIES = 4;
const MINUS = "\u2212";

function themeKey(p: Puzzle): string {
  return p.theme ?? "positional";
}

function isDue(p: Puzzle): boolean {
  return !p.due_at || new Date(p.due_at).getTime() <= Date.now();
}

/** Never-reviewed positions sort first, then the most overdue. */
function dueTime(p: Puzzle): number {
  return p.due_at ? new Date(p.due_at).getTime() : 0;
}

function moveLabel(ply: number | null): string | null {
  if (ply == null) return null;
  return `Move ${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? ". White" : "… Black"}`;
}

export default function Puzzles() {
  const [puzzles, setPuzzles] = useState<Puzzle[]>([]);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string | null>(null);
  const [dueOnly, setDueOnly] = useState(true);
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE);
  const [index, setIndex] = useState(0);
  const [queue, setQueue] = useState<Puzzle[]>([]);

  // Drill state for the puzzle on the board.
  const [attempt, setAttempt] = useState<{ from: string; to: string; san: string } | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [illegal, setIllegal] = useState<string | null>(null);
  const [hintStage, setHintStage] = useState<0 | 1 | 2>(0);
  const [outcome, setOutcome] = useState<"solved" | "assisted" | "shown" | null>(null);
  const [line, setLine] = useState<string[]>([]);
  const [lineIndex, setLineIndex] = useState(0); // plies of `line` already on the board
  const [lineFen, setLineFen] = useState<string | null>(null);
  const [lineError, setLineError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [boardKey, setBoardKey] = useState(0);
  const [session, setSession] = useState({ solved: 0, assisted: 0, wrong: 0 });

  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/puzzles");
    const data = await res.json();
    setPuzzles((data.puzzles as Puzzle[]) || []);
    setNeedsProfile(Boolean(data.needsProfile));
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch via a reusable loader
    void load();
  }, [load]);

  function resetDrill() {
    setAttempt(null);
    setIllegal(null);
    setHintStage(0);
    setAttempts(0);
    setOutcome(null);
    setLine([]);
    setLineIndex(0);
    setLineFen(null);
    setLineError(null);
    setSelected(null);
    setBoardKey((k) => k + 1);
  }

  // Build the drill queue when the filter or the library itself changes. Answering
  // a puzzle moves its due date, which must not shuffle the queue mid-session or
  // hide the explanation the player just earned.
  useEffect(() => {
    const base = puzzles.filter(
      (p) => (!category || themeKey(p) === category) && (!dueOnly || isDue(p))
    );
    const ordered = [...base].sort((a, b) => {
      const da = dueTime(a);
      const db = dueTime(b);
      if (da !== db) return da - db;
      if (a.ease !== b.ease) return a.ease - b.ease;
      return b.id - a.id;
    });
    /* eslint-disable react-hooks/set-state-in-effect -- the queue is derived from the loaded library */
    setQueue(ordered);
    setIndex(0);
    resetDrill();
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the library's identity, not its SRS counters
  }, [category, dueOnly, puzzles.length, loading]);

  // Deep link from an insight ("drill these"): ?theme=hung-piece preselects a
  // category. Read from the URL after mount so static prerendering is untouched.
  useEffect(() => {
    if (puzzles.length === 0) return;
    const theme = new URLSearchParams(window.location.search).get("theme");
    if (!theme || !puzzles.some((p) => themeKey(p) === theme)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the deep link preselects a category once the library loads
    setCategory(theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the library first loads
  }, [puzzles.length]);

  const counts = useMemo(() => {
    const byCategory: Record<string, number> = {};
    let due = 0;
    for (const p of puzzles) {
      if (dueOnly && !isDue(p)) continue;
      const key = themeKey(p);
      byCategory[key] = (byCategory[key] ?? 0) + 1;
      if (isDue(p)) due += 1;
    }
    return { byCategory, due, total: puzzles.length };
  }, [puzzles, dueOnly]);

  const puzzle: Puzzle | null = queue[index] ?? null;

  // Keep the active row visible inside the rail only — never scroll the page.
  const shownCount = Math.max(visibleCount, index + 1);
  useEffect(() => {
    const container = listRef.current;
    const row = rowRefs.current[index];
    if (!container || !row) return;
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top < containerRect.top) container.scrollTop += rowRect.top - containerRect.top;
    else if (rowRect.bottom > containerRect.bottom) {
      container.scrollTop += rowRect.bottom - containerRect.bottom;
    }
  }, [index, shownCount]);

  function goTo(nextIndex: number) {
    setIndex(nextIndex);
    resetDrill();
  }

  function recordSrs(id: number, correct: boolean) {
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
        /* the drill moves on; only the counters stay stale */
      });
  }

  /** The position after applying the first `moves.length` moves of a UCI line. */
  function fenAfter(moves: string[]): string | null {
    if (!puzzle) return null;
    try {
      const chess = new Chess(puzzle.fen);
      for (const uci of moves) {
        chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? "q" });
      }
      return chess.fen();
    } catch {
      return null;
    }
  }

  /** SAN for the move at `index` of the line, computed from the position before it. */
  function sanAt(index: number): string {
    if (!puzzle) return "";
    try {
      const chess = new Chess(puzzle.fen);
      for (let i = 0; i < index; i++) {
        chess.move({ from: line[i].slice(0, 2), to: line[i].slice(2, 4), promotion: line[i][4] ?? "q" });
      }
      const uci = line[index];
      const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? "q" });
      return move?.san ?? uci;
    } catch {
      return line[index] ?? "";
    }
  }

  /** Put the first `index` plies of the line on the board. */
  function applyLine(index: number) {
    const moves = line.slice(0, index);
    setLineFen(fenAfter(moves));
    setLineIndex(index);
  }

  function finish(kind: "solved" | "assisted" | "shown") {
    if (!puzzle || outcome) return;
    setOutcome(kind);
    setAttempt(null);
    setIllegal(null);
    setSelected(null);
    // Play the drill out: the solution plus the engine's cached replies, so the
    // player learns to convert the position rather than just recognise move one.
    const plies = puzzle.pv.length > 0 ? puzzle.pv.slice(0, 1 + MAX_LINE_PLIES) : [puzzle.solution_uci];
    setLine(plies);
    setLineIndex(1);
    setLineFen(fenAfter(plies.slice(0, 1)));
    setLineError(null);
    setSession((s) => ({
      solved: s.solved + (kind === "solved" ? 1 : 0),
      assisted: s.assisted + (kind === "assisted" ? 1 : 0),
      wrong: s.wrong,
    }));
    // A hinted or revealed solve is not clean recall, so the schedule treats it
    // as a miss and brings the position back sooner.
    recordSrs(puzzle.id, kind === "solved");
  }

  const lineActive = outcome != null && line.length > 1 && lineIndex < line.length;
  const playerTurnInLine = lineActive && lineIndex % 2 === 0;
  const lineComplete = outcome != null && line.length > 1 && lineIndex >= line.length;

  // The engine's replies come from the stored line and play themselves.
  useEffect(() => {
    if (!lineActive || lineIndex % 2 === 0) return;
    const timer = setTimeout(() => applyLine(lineIndex + 1), 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyLine reads the current line
  }, [lineActive, lineIndex, line]);

  function playOutLine() {
    setLineError(null);
    applyLine(line.length);
  }

  /** @returns "played" when a move was accepted (right or wrong), otherwise why not. */
  function tryMove(from: string, to: string): "played" | "illegal" | "blocked" {
    if (!puzzle) return "blocked";

    // Continuation: only the player's plies of the stored line are accepted, and
    // a miss costs nothing (the drill is already scored) — it just gets marked.
    if (outcome) {
      if (!playerTurnInLine) return "blocked";
      const chess = new Chess(lineFen ?? puzzle.fen);
      let move = null;
      try {
        move = chess.move({ from, to, promotion: "q" });
      } catch {
        move = null;
      }
      if (!move) {
        setIllegal(`${from}–${to} is not a legal move here.`);
        return "illegal";
      }
      setSelected(null);
      if (move.lan === line[lineIndex]) {
        setLineError(null);
        applyLine(lineIndex + 1);
        return "played";
      }
      setLineError(`${move.san} is not the line — the engine plays ${sanAt(lineIndex)}.`);
      return "played";
    }

    if (attempt) return "blocked";
    if (from === to) return "blocked"; // a same-square drop is a tap, not an attempt
    const chess = new Chess(puzzle.fen);
    const promotion = puzzle.solution_uci.length === 5 ? puzzle.solution_uci[4] : "q";
    let move = null;
    try {
      move = chess.move({ from, to, promotion });
    } catch {
      move = null;
    }
    if (!move) {
      setIllegal(`${from}–${to} is not a legal move in this position.`);
      setSelected(null);
      return "illegal";
    }
    setSelected(null);
    if (move.lan === puzzle.solution_uci) {
      finish(hintStage > 0 ? "assisted" : "solved");
      return "played";
    }
    setAttempts((n) => n + 1);
    setAttempt({ from, to, san: move.san ?? "" });
    setIllegal(null);
    setSession((s) => ({ ...s, wrong: s.wrong + 1 }));
    return "played";
  }

  function onDrop(source: string, target: string): boolean {
    return tryMove(source, target) === "played";
  }

  function onSquareSelect(square: string) {
    if (!puzzle) return;
    // Locked by a wrong first attempt, or waiting on the engine mid-line.
    if (!outcome && attempt) return;
    if (outcome && !playerTurnInLine) return;
    const baseFen = lineFen ?? puzzle.fen;
    const chess = new Chess(baseFen);
    const piece = chess.get(square as Square);
    const toMove = baseFen.split(" ")[1];
    const ownPiece = !!(piece && piece.color === toMove);
    // Clicking another of your own pieces re-selects; only a non-own square is
    // treated as a destination. (Attempting the move first turned a re-select
    // into a bogus "not a legal move" message.)
    if (selected && selected !== square && !ownPiece) {
      const result = tryMove(selected, square);
      if (result === "played" || result === "illegal") return;
    }
    setSelected(ownPiece ? square : null);
  }

  function advanceHint() {
    if (hintStage === 0) setHintStage(1);
    else if (hintStage === 1) setHintStage(2);
  }

  // Keyboard: n = next drill, p = previous, h = hint, r = try again.
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
      if (e.key === "n") {
        if (queue.length > 0) goTo((index + 1) % queue.length);
      } else if (e.key === "p") {
        if (queue.length > 0) goTo((index - 1 + queue.length) % queue.length);
      } else if (e.key === "h") {
        advanceHint();
      } else if (e.key === "r") {
        resetDrill();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the shortcuts read current state on each press
  }, [queue.length, index, hintStage, outcome, attempt]);

  const solutionFrom = puzzle ? puzzle.solution_uci.slice(0, 2) : "";
  const solutionTo = puzzle ? puzzle.solution_uci.slice(2, 4) : "";
  const orientation = puzzle && puzzle.fen.split(" ")[1] === "w" ? "white" : "black";

  const revealed = outcome === "shown";
  const arrows = useMemo(() => {
    if (!puzzle) return [];
    if (hintStage === 2 || outcome) {
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
    if (attempt) {
      const wrong = {
        backgroundColor: "rgba(251, 113, 133, 0.3)",
        boxShadow: "inset 0 0 0 3px #fb7185",
      };
      styles[attempt.from] = wrong;
      styles[attempt.to] = wrong;
    }
    if (outcome) {
      styles[solutionFrom] = { backgroundColor: "rgba(34, 197, 94, 0.22)" };
      styles[solutionTo] = {
        backgroundColor: "rgba(34, 197, 94, 0.3)",
        boxShadow: "inset 0 0 0 3px #22c55e",
      };
    }
    if (selected) {
      styles[selected] = {
        backgroundColor: "rgba(99, 102, 241, 0.35)",
        boxShadow: "inset 0 0 0 3px #818cf8",
      };
    }
    return styles;
  }, [puzzle, hintStage, attempt, outcome, selected, solutionFrom, solutionTo]);

  const marks = useMemo(() => {
    if (!puzzle) return {};
    if (attempt?.to) return { [attempt.to]: { text: "✗", color: "#fb7185" } };
    if (outcome) return { [solutionTo]: { text: "✓", color: "#22c55e" } };
    return {};
  }, [puzzle, attempt, outcome, solutionTo]);

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
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
          {needsProfile ? (
            <>
              <p className="text-zinc-200">No profile is active.</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-zinc-400">
                Drills are built from your own mistakes, so add a profile first. Drills already
                derived for that account appear straight away.
              </p>
              <Link
                href="/profiles"
                className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
              >
                Go to Profiles
              </Link>
            </>
          ) : (
            <p className="text-zinc-300">
              No personal puzzles yet. Analyse some games and your own mistakes become drills here.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Puzzles</h1>
        <p className="text-sm text-zinc-400">
          Positions from your own games, drilled on a spaced-repetition schedule. {counts.total} in the
          library · {counts.due} ready now
          {session.solved + session.assisted > 0
            ? ` · this session: ${session.solved} clean, ${session.assisted} with a hint`
            : "."}
        </p>
      </div>

      {/* Categories: pick what to drill, not just the next item in a list. */}
      <div
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0"
        role="group"
        aria-label="Puzzle categories"
      >
        {CATEGORIES.map((c) => {
          const count = c.key ? counts.byCategory[c.key] ?? 0 : dueOnly ? counts.due : counts.total;
          const active = category === c.key;
          return (
            <button
              key={c.label}
              type="button"
              onClick={() => setCategory(c.key)}
              aria-pressed={active}
              disabled={count === 0}
              className={`min-h-11 shrink-0 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-40 ${
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
          className={`min-h-11 shrink-0 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
            dueOnly
              ? "border-emerald-600 bg-emerald-950/40 text-emerald-200"
              : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          }`}
        >
          Due now
          <span className={dueOnly ? "text-emerald-200/80" : "text-zinc-400"}> {counts.due}</span>
        </button>
      </div>

      {queue.length === 0 || !puzzle ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-zinc-300">
          Nothing due in this category. Turn off “Due now” to drill ahead of schedule.
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm">
                You play{" "}
                <span className="font-semibold text-zinc-100">
                  {orientation === "white" ? "White" : "Black"}
                </span>
              </span>
              <span className="text-sm text-zinc-300">
                {puzzle.prev_san ? (
                  <>
                    They just played{" "}
                    <span className="font-semibold text-zinc-100">{puzzle.prev_san}</span>. Find your
                    move.
                  </>
                ) : (
                  "Find the best move."
                )}
              </span>
              {puzzle.theme ? (
                <span className="rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-xs text-indigo-300">
                  {puzzle.theme.replace(/-/g, " ")}
                </span>
              ) : null}
              <span className="ml-auto font-mono text-xs text-zinc-400">
                {index + 1} / {queue.length}
              </span>
            </div>

            <div className="min-w-0" style={{ maxWidth: "min(640px, 62vh)" }}>
              <ChessBoard
                key={boardKey}
                fen={lineFen ?? puzzle.fen}
                orientation={orientation}
                interactive={playerTurnInLine || (!outcome && !attempt)}
                onDrop={onDrop}
                onSquareSelect={onSquareSelect}
                allowDrawingArrows={false}
                arrows={arrows}
                squareStyles={squareStyles}
                marks={marks}
              />
            </div>

            <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/90 p-2 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0">
              <button
                type="button"
                onClick={advanceHint}
                disabled={hintStage === 2 || outcome !== null}
                className="min-h-11 rounded-lg border border-amber-700/70 px-3 text-sm font-semibold text-amber-200 hover:bg-amber-950/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:opacity-40"
              >
                {hintStage === 0 ? "Hint: which piece?" : hintStage === 1 ? "Hint: where to?" : "Hint shown"}
              </button>
              <button
                type="button"
                onClick={() => finish("shown")}
                disabled={outcome !== null}
                className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-40"
              >
                Show solution
              </button>
              <button
                type="button"
                onClick={resetDrill}
                disabled={attempts === 0 && hintStage === 0 && !outcome}
                className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-40"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => goTo((index - 1 + queue.length) % queue.length)}
                className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => goTo((index + 1) % queue.length)}
                className="ml-auto min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
              >
                Next puzzle
              </button>
              <p className="hidden w-full text-xs text-zinc-400 lg:block">
                Drag a piece, or click it and click where it goes —{" "}
                <kbd className="rounded bg-zinc-800 px-1">Tab</kbd> to a square and press{" "}
                <kbd className="rounded bg-zinc-800 px-1">Enter</kbd> works too.{" "}
                <kbd className="rounded bg-zinc-800 px-1">H</kbd> hint ·{" "}
                <kbd className="rounded bg-zinc-800 px-1">R</kbd> try again ·{" "}
                <kbd className="rounded bg-zinc-800 px-1">N</kbd>/
                <kbd className="rounded bg-zinc-800 px-1">P</kbd> next/previous
              </p>
            </div>

            {illegal ? (
              <p
                role="alert"
                className="rounded-xl border border-amber-800 bg-amber-950/40 p-3 text-sm text-amber-200"
              >
                {illegal}
              </p>
            ) : null}

            {attempt && !outcome ? (
              <div role="alert" className="rounded-xl border border-rose-800 bg-rose-950/40 p-4">
                <p className="text-sm text-rose-200">
                  <span aria-hidden className="mr-1 font-bold">
                    ✗
                  </span>
                  <span className="font-semibold">{attempt.san}</span> isn&apos;t the move.
                  {attempts > 1
                    ? " Still not it — take the hint or step through the position."
                    : " Look for a forcing reply."}
                </p>
                <p className="mt-1 text-xs text-rose-300/80">
                  Your attempt is marked on the board. Try again, or take a hint.
                </p>
              </div>
            ) : null}

            {outcome && line.length > 1 ? (
              <div className="rounded-xl border border-indigo-900 bg-indigo-950/30 p-4">
                <p className="text-sm text-indigo-100">
                  {lineComplete
                    ? "Line complete — you played it out beyond the solution. That is how the position converts."
                    : lineError
                      ? lineError
                      : playerTurnInLine
                        ? `The engine played ${sanAt(lineIndex - 1)}. Your move.`
                        : `The engine plays ${sanAt(lineIndex)}…`}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={playOutLine}
                    disabled={lineComplete}
                    className="min-h-11 rounded-lg border border-indigo-700/70 px-3 text-sm font-semibold text-indigo-200 hover:bg-indigo-950/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-40"
                  >
                    {lineComplete ? "Line played" : "Show me the rest"}
                  </button>
                  <span className="text-xs text-indigo-200/80">
                    Playing it out is unscored — the drill is already counted.
                  </span>
                </div>
              </div>
            ) : null}

            {outcome ? (
              <div
                className={`rounded-xl border p-4 ${
                  revealed ? "border-zinc-700 bg-zinc-900/60" : "border-emerald-800 bg-emerald-950/40"
                }`}
              >
                <p className={`text-sm ${revealed ? "text-zinc-200" : "text-emerald-200"}`}>
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
                      The move was <span className="font-semibold">{puzzle.solution_san}</span>, played
                      out on the board.
                    </>
                  )}
                </p>
                {puzzle.source_san || puzzle.source_classification ? (
                  <p className="mt-1 text-sm text-zinc-300">
                    {moveLabel(puzzle.source_ply) ? `${moveLabel(puzzle.source_ply)}: ` : ""}
                    in the game you played{" "}
                    <span className="font-semibold text-zinc-100">{puzzle.source_san ?? "—"}</span>
                    {puzzle.source_classification ? ` (${puzzle.source_classification}` : ""}
                    {puzzle.source_centipawn_loss != null
                      ? `${puzzle.source_classification ? ", " : " ("}${MINUS}${(
                          puzzle.source_centipawn_loss / 100
                        ).toFixed(1)} pawns`
                      : ""}
                    {puzzle.source_classification ? ")" : ""}.
                  </p>
                ) : null}
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
              {dueOnly ? " · due now" : ""} ({queue.length})
            </h2>
            <div ref={listRef} className="max-h-[560px] overflow-auto rounded-xl border border-zinc-800">
              {queue.slice(0, shownCount).map((p, i) => {
                const active = i === index;
                const due = isDue(p);
                return (
                  <button
                    key={p.id}
                    type="button"
                    ref={(el) => {
                      rowRefs.current[i] = el;
                    }}
                    onClick={() => goTo(i)}
                    aria-current={active ? "true" : undefined}
                    className={`block min-h-11 w-full border-b border-zinc-800 px-3 py-2 text-left text-sm last:border-b-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-400 ${
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
            {queue.length > shownCount ? (
              <button
                type="button"
                onClick={() => setVisibleCount((n) => n + LIST_PAGE)}
                className="min-h-11 w-full rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
              >
                Show {Math.min(LIST_PAGE, queue.length - shownCount)} more ({queue.length - shownCount} left)
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
