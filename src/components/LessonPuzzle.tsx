"use client";

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Chess, type Square } from "chess.js";
import ChessBoard from "@/components/ChessBoard";
import type { LessonPuzzle } from "@/lib/lessons";

/**
 * One tiny puzzle: either a move to find on the board, or a short question.
 *
 * Deliberately gentler than the Puzzles tab. There is no scoring and no spaced
 * repetition — a wrong try is not a failure, it just gets marked so you can see
 * what you played and try something else. The point is the idea, not the streak.
 */
export default function LessonPuzzleView({
  lessonId,
  puzzle,
  onDone,
}: {
  /** Identity of the lesson this puzzle belongs to — see the `key` note below. */
  lessonId: string;
  puzzle: LessonPuzzle;
  /** Called once the puzzle has been solved or the answer seen — drives progress. */
  onDone?: () => void;
}) {
  // The `key` is load-bearing, not decoration. React reuses a component instance
  // when the same type renders in the same position, so without it every piece of
  // internal state — solved, revealed, the wrong attempt, and the board's own
  // position — would follow the reader into the *next* lesson: that lesson would
  // open already solved, showing its answer drawn on the previous lesson's board,
  // with the board locked. Keying on the lesson id gives each puzzle its own
  // instance, which is the only reason a lesson reliably starts from its own
  // position. It only shows up between two puzzles of the same kind, because a
  // change of kind swaps the component type and remounts anyway.
  return puzzle.kind === "quiz" ? (
    <QuizView key={lessonId} puzzle={puzzle} onDone={onDone} />
  ) : (
    <MoveView key={lessonId} puzzle={puzzle} onDone={onDone} />
  );
}

// ---------------------------------------------------------------------------
// Multiple choice
// ---------------------------------------------------------------------------

function QuizView({
  puzzle,
  onDone,
}: {
  puzzle: Extract<LessonPuzzle, { kind: "quiz" }>;
  onDone?: () => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;
  const correct = picked === puzzle.answer;
  const orientation = puzzle.fen?.split(" ")[1] === "b" ? "black" : "white";

  function choose(i: number) {
    setPicked(i);
    // Answering at all means the explanation is now on screen, so the lesson counts.
    onDone?.();
  }

  return (
    <div className="space-y-3">
      {puzzle.fen ? (
        <div className="min-w-0" style={{ maxWidth: "min(420px, 52vh)" }}>
          <ChessBoard fen={puzzle.fen} orientation={orientation} interactive={false} />
        </div>
      ) : null}

      <p className="text-sm text-zinc-200">{puzzle.question}</p>

      <div className="grid gap-2" role="group" aria-label="Answer choices">
        {puzzle.options.map((option, i) => {
          const isAnswer = i === puzzle.answer;
          const isPicked = picked === i;
          // After answering, show which was right; keep the rest neutral.
          const tone = !answered
            ? "border-zinc-700 text-zinc-200 hover:bg-zinc-800"
            : isAnswer
              ? "border-emerald-700 bg-emerald-950/40 text-emerald-100"
              : isPicked
                ? "border-rose-800 bg-rose-950/30 text-rose-200"
                : "border-zinc-800 text-zinc-500";
          return (
            <button
              key={option}
              type="button"
              onClick={() => choose(i)}
              disabled={answered}
              aria-pressed={isPicked}
              className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:cursor-default ${tone}`}
            >
              {answered && isAnswer ? (
                <span aria-hidden className="mr-1.5 font-bold">
                  ✓
                </span>
              ) : null}
              {answered && isPicked && !isAnswer ? (
                <span aria-hidden className="mr-1.5 font-bold">
                  ✗
                </span>
              ) : null}
              {option}
            </button>
          );
        })}
      </div>

      {answered ? (
        <div
          role="status"
          className={`rounded-xl border p-4 ${
            correct ? "border-emerald-800 bg-emerald-950/40" : "border-zinc-700 bg-zinc-900/60"
          }`}
        >
          <p className={`text-sm font-semibold ${correct ? "text-emerald-200" : "text-zinc-100"}`}>
            {correct ? "That's it." : "Not quite — here's the idea."}
          </p>
          <p className="mt-1 text-sm text-zinc-200">{puzzle.explain}</p>
          <button
            type="button"
            onClick={() => setPicked(null)}
            className="mt-3 min-h-11 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
          >
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Find the move
// ---------------------------------------------------------------------------

function MoveView({
  puzzle,
  onDone,
}: {
  puzzle: Extract<LessonPuzzle, { kind: "move" }>;
  onDone?: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [wrong, setWrong] = useState<{ from: string; to: string; san: string } | null>(null);
  const [hintShown, setHintShown] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [solved, setSolved] = useState(false);
  const [boardKey, setBoardKey] = useState(0);
  // The board is driven by this rather than `puzzle.fen` so the solution is
  // actually shown on the board once found or revealed — a wrong try leaves it
  // untouched, because the move was never played.
  const [boardFen, setBoardFen] = useState(puzzle.fen);

  const done = solved || revealed;
  const from = puzzle.solutionUci.slice(0, 2);
  const to = puzzle.solutionUci.slice(2, 4);
  const orientation = puzzle.fen.split(" ")[1] === "b" ? "black" : "white";

  /** The position after the solution is played, or null if it somehow isn't legal. */
  function solutionFen(): string | null {
    const chess = new Chess(puzzle.fen);
    const promotion = puzzle.solutionUci.length === 5 ? puzzle.solutionUci[4] : "q";
    try {
      chess.move({ from, to, promotion });
      return chess.fen();
    } catch {
      return null;
    }
  }

  function reset() {
    setSelected(null);
    setWrong(null);
    setHintShown(false);
    setRevealed(false);
    setSolved(false);
    setBoardFen(puzzle.fen);
    setBoardKey((k) => k + 1);
  }

  /** Play the user's attempt against the position; only the solution counts. */
  function tryMove(source: string, target: string): boolean {
    if (done || source === target) return false;
    const chess = new Chess(puzzle.fen);
    const promotion = puzzle.solutionUci.length === 5 ? puzzle.solutionUci[4] : "q";
    let move = null;
    try {
      move = chess.move({ from: source, to: target, promotion });
    } catch {
      move = null;
    }
    if (!move) return false; // not a legal move — the board already snapped back
    setSelected(null);
    if (move.lan === puzzle.solutionUci) {
      setSolved(true);
      setWrong(null);
      setBoardFen(chess.fen());
      onDone?.();
      return true;
    }
    // Legal but not the answer: mark it and let them try again.
    setWrong({ from: source, to: target, san: move.san ?? "" });
    setHintShown(true);
    return false;
  }

  function onSquareSelect(square: string) {
    if (done) return;
    const chess = new Chess(puzzle.fen);
    const piece = chess.get(square as Square);
    const toMove = puzzle.fen.split(" ")[1];
    const ownPiece = !!(piece && piece.color === toMove);
    if (selected && selected !== square && !ownPiece) {
      tryMove(selected, square);
      return;
    }
    setSelected(ownPiece ? square : null);
  }

  // The green arrow appears once the move is found or given away.
  const arrows = useMemo(
    () => (done ? [{ startSquare: from, endSquare: to, color: "#22c55e" }] : []),
    [done, from, to]
  );

  const squareStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};
    if (hintShown && !done) {
      styles[from] = {
        backgroundColor: "rgba(234, 179, 8, 0.35)",
        boxShadow: "inset 0 0 0 3px #eab308",
      };
    }
    if (done) {
      styles[from] = { backgroundColor: "rgba(34, 197, 94, 0.22)" };
      styles[to] = {
        backgroundColor: "rgba(34, 197, 94, 0.3)",
        boxShadow: "inset 0 0 0 3px #22c55e",
      };
    }
    if (wrong && !done) {
      const bad = {
        backgroundColor: "rgba(251, 113, 133, 0.3)",
        boxShadow: "inset 0 0 0 3px #fb7185",
      };
      styles[wrong.from] = bad;
      styles[wrong.to] = bad;
    }
    if (selected) {
      styles[selected] = {
        backgroundColor: "rgba(99, 102, 241, 0.35)",
        boxShadow: "inset 0 0 0 3px #818cf8",
      };
    }
    return styles;
  }, [hintShown, done, wrong, selected, from, to]);

  const marks = useMemo(() => {
    if (wrong && !done) return { [wrong.to]: { text: "✗", color: "#fb7185" } };
    if (done) return { [to]: { text: "✓", color: "#22c55e" } };
    return {};
  }, [wrong, done, to]);

  return (
    <div className="space-y-3">
      <div className="min-w-0" style={{ maxWidth: "min(460px, 56vh)" }}>
        <ChessBoard
          key={boardKey}
          fen={boardFen}
          orientation={orientation}
          interactive={!done}
          onDrop={tryMove}
          onSquareSelect={onSquareSelect}
          allowDrawingArrows={false}
          arrows={arrows}
          squareStyles={squareStyles}
          marks={marks}
        />
      </div>

      <p className="text-sm text-zinc-300">{puzzle.prompt}</p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setHintShown(true)}
          disabled={hintShown || done}
          className="min-h-11 rounded-lg border border-amber-700/70 px-3 text-sm font-semibold text-amber-200 hover:bg-amber-950/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:opacity-40"
        >
          {hintShown ? "Hint shown" : "Hint"}
        </button>
        <button
          type="button"
          onClick={() => {
            setRevealed(true);
            setBoardFen(solutionFen() ?? puzzle.fen);
            onDone?.();
          }}
          disabled={done}
          className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-40"
        >
          Show answer
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={!wrong && !hintShown && !done}
          className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-40"
        >
          Try again
        </button>
        <span className="text-xs text-zinc-500">
          Drag a piece, or tap it and tap where it goes.
        </span>
      </div>

      {hintShown && !done ? (
        <p className="rounded-xl border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-100">
          <span className="font-semibold">Hint.</span> {puzzle.hint}
        </p>
      ) : null}

      {wrong && !done ? (
        <p
          role="status"
          className="rounded-xl border border-rose-900 bg-rose-950/30 p-3 text-sm text-rose-200"
        >
          <span aria-hidden className="mr-1 font-bold">
            ✗
          </span>
          <span className="font-semibold">{wrong.san}</span> is legal, but it is not the idea here.
          Take the hint, or try another move.
        </p>
      ) : null}

      {done ? (
        <div
          role="status"
          className={`rounded-xl border p-4 ${
            solved ? "border-emerald-800 bg-emerald-950/40" : "border-zinc-700 bg-zinc-900/60"
          }`}
        >
          <p className={`text-sm font-semibold ${solved ? "text-emerald-200" : "text-zinc-100"}`}>
            {solved ? (
              <>
                <span aria-hidden className="mr-1 font-bold">
                  ✓
                </span>
                {puzzle.solutionSan} — that&apos;s the move.
              </>
            ) : (
              <>
                The move is <span className="font-semibold">{puzzle.solutionSan}</span>, shown on the
                board.
              </>
            )}
          </p>
          <p className="mt-1 text-sm text-zinc-200">{puzzle.explain}</p>
        </div>
      ) : null}
    </div>
  );
}
