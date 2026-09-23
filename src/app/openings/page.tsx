"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { Chess, type Square } from "chess.js";
import ChessBoard from "@/components/ChessBoard";

interface Opening {
  eco: string;
  name: string;
  uci: string[];
  wikipedia: string;
  ideas?: string;
}

type Deviation = { played: string; expected: string; expectedUci: string; to: string };

function uciParts(uci: string) {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.slice(4, 5) || "q",
  };
}

export default function Openings() {
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [selected, setSelected] = useState<Opening | null>(null);
  const [fen, setFen] = useState(new Chess().fen());
  const [step, setStep] = useState(0);
  const [practicing, setPracticing] = useState(false);
  const [practiceColor, setPracticeColor] = useState<"w" | "b">("w");
  const [playedUci, setPlayedUci] = useState<string[]>([]);
  const [deviation, setDeviation] = useState<Deviation | null>(null);
  const [lineComplete, setLineComplete] = useState(false);
  const [hintStage, setHintStage] = useState<0 | 1 | 2>(0);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const lineChess = useRef(new Chess());

  useEffect(() => {
    void fetch("/api/openings")
      .then((r) => r.json())
      .then((d) => setOpenings((d.openings as Opening[]) || []))
      .catch(() => setNotice("Could not load the opening set."));
  }, []);

  const sanOf = useCallback((opening: Opening, index: number): string => {
    const chess = new Chess();
    for (let i = 0; i <= index && i < opening.uci.length; i++) {
      const { from, to, promotion } = uciParts(opening.uci[i]);
      const move = chess.move({ from, to, promotion });
      if (i === index) return move?.san ?? opening.uci[i];
    }
    return opening.uci[index] ?? "";
  }, []);

  /** Position after `n` plies of the line. */
  const fenAt = useCallback((opening: Opening, n: number): string => {
    const chess = new Chess();
    for (let i = 0; i < n && i < opening.uci.length; i++) {
      const { from, to, promotion } = uciParts(opening.uci[i]);
      chess.move({ from, to, promotion });
    }
    return chess.fen();
  }, []);

  const selectOpening = useCallback(
    (opening: Opening) => {
      setSelected(opening);
      setPracticing(false);
      setDeviation(null);
      setLineComplete(false);
      setHintStage(0);
      setSelectedSquare(null);
      setPlayedUci([]);
      setNotice(null);
      setStep(0);
      setFen(fenAt(opening, 0));
    },
    [fenAt]
  );

  // Deep link from the insights opening table: /openings?eco=C50
  useEffect(() => {
    if (openings.length === 0 || selected) return;
    const eco = new URLSearchParams(window.location.search).get("eco");
    const match = eco ? openings.find((o) => o.eco.toUpperCase() === eco.toUpperCase()) : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the deep link selects once the list arrives
    if (match) selectOpening(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on first load
  }, [openings.length]);

  const firstTrainablePly = practiceColor === "w" ? 0 : 1;
  const canPractise = selected ? selected.uci.length > firstTrainablePly : false;

  const rebuild = useCallback(
    (opening: Opening, keep: number, color: "w" | "b") => {
      const start = color === "b" ? 1 : 0;
      const n = Math.max(start, Math.min(opening.uci.length, keep));
      const chess = new Chess();
      for (let i = 0; i < n; i++) {
        const { from, to, promotion } = uciParts(opening.uci[i]);
        chess.move({ from, to, promotion });
      }
      lineChess.current = chess;
      setPlayedUci(opening.uci.slice(0, n));
      setStep(n);
      setFen(chess.fen());
      setDeviation(null);
      setSelectedSquare(null);
      setHintStage(0);
      setLineComplete(false);
    },
    []
  );

  function resetFor(opening: Opening, color: "w" | "b") {
    const start = color === "b" ? 1 : 0;
    setPracticing(true);
    setPracticeColor(color);
    setNotice(
      opening.uci.length <= start
        ? `This line is only ${opening.uci.length} ply — nothing to answer as ${color === "w" ? "White" : "Black"}.`
        : null
    );
    rebuild(opening, start, color);
  }

  function stepTo(opening: Opening, target: number) {
    const n = Math.max(0, Math.min(opening.uci.length, target));
    lineChess.current = new Chess(fenAt(opening, n));
    setStep(n);
    setFen(fenAt(opening, n));
  }

  const turn = fen.split(" ")[1];
  const yourTurn = turn === practiceColor;
  const interactive = practicing && !deviation && !lineComplete && yourTurn && !notice;

  const expectedUci = selected && practicing ? selected.uci[playedUci.length] ?? null : null;
  const expectedSan = expectedUci && selected ? sanOf(selected, playedUci.length) : null;

  /** Apply a correct player move plus the opponent's replies that follow it. */
  function applyCorrect(opening: Opening, moveLan: string) {
    const chess = lineChess.current;
    const applied = [moveLan];
    while (playedUci.length + applied.length < opening.uci.length) {
      const idx = playedUci.length + applied.length;
      const moverIsPlayer = idx % 2 === (practiceColor === "w" ? 0 : 1);
      if (moverIsPlayer) break;
      const reply = opening.uci[idx];
      const { from, to, promotion } = uciParts(reply);
      chess.move({ from, to, promotion });
      applied.push(reply);
    }
    const next = [...playedUci, ...applied];
    setPlayedUci(next);
    setStep(next.length);
    setFen(chess.fen());
    setHintStage(0);
    setSelectedSquare(null);
    if (next.length >= opening.uci.length) setLineComplete(true);
  }

  function attemptMove(from: string, to: string): boolean {
    if (!selected || !interactive) return false;
    if (from === to) return false;
    const chess = lineChess.current;
    let move;
    try {
      move = chess.move({ from, to, promotion: "q" });
    } catch {
      move = null;
    }
    if (!move) {
      setNotice("That move is not legal in this position.");
      return false;
    }
    const expected = selected.uci[playedUci.length] ?? null;
    if (expected == null) {
      // The line simply ran out — this is not "leaving theory".
      setFen(chess.fen());
      setLineComplete(true);
      return true;
    }
    if (move.lan !== expected) {
      setDeviation({
        played: move.san ?? "",
        expected: expectedSan ?? sanOf(selected, playedUci.length),
        expectedUci: expected,
        to: move.to ?? to,
      });
      setFen(chess.fen());
      return true;
    }
    applyCorrect(selected, move.lan);
    return true;
  }

  function onDrop(source: string, target: string): boolean {
    return attemptMove(source, target);
  }

  function onSquareSelect(square: string) {
    if (!selected || !interactive) return;
    if (selectedSquare && selectedSquare !== square) {
      if (attemptMove(selectedSquare, square)) return;
      if (notice) return;
    }
    const chess = lineChess.current;
    const piece = chess.get(square as Square);
    setSelectedSquare(piece && piece.color === chess.turn() ? square : null);
  }

  function showMe() {
    if (!selected || !expectedUci) return;
    const chess = lineChess.current;
    const { from, to, promotion } = uciParts(expectedUci);
    const move = chess.move({ from, to, promotion });
    if (move) applyCorrect(selected, move.lan);
  }

  function undo() {
    if (!selected) return;
    const parity = practiceColor === "w" ? 0 : 1;
    let keep = Math.max(practiceColor === "b" ? 1 : 0, playedUci.length - 1);
    if (keep % 2 !== parity) keep = Math.max(practiceColor === "b" ? 1 : 0, keep - 1);
    rebuild(selected, keep, practiceColor);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return openings;
    return openings.filter(
      (o) => o.name.toLowerCase().includes(q) || o.eco.toLowerCase().includes(q)
    );
  }, [openings, search]);

  function nextOpening() {
    if (!selected) return;
    const list = filtered;
    const i = list.findIndex((o) => o.eco === selected.eco);
    const next = list[(i + 1) % Math.max(1, list.length)];
    if (next) selectOpening(next);
  }

  const boardOrientation = practicing ? (practiceColor === "w" ? "white" : "black") : "white";

  const squareStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};
    if (deviation) {
      styles[deviation.to] = {
        backgroundColor: "rgba(251, 113, 133, 0.3)",
        boxShadow: "inset 0 0 0 3px #fb7185",
      };
    }
    if (practicing && hintStage >= 1 && expectedUci) {
      styles[expectedUci.slice(0, 2)] = {
        backgroundColor: "rgba(234, 179, 8, 0.35)",
        boxShadow: "inset 0 0 0 3px #eab308",
      };
    }
    if (practicing && hintStage === 2 && expectedUci) {
      styles[expectedUci.slice(2, 4)] = {
        backgroundColor: "rgba(34, 197, 94, 0.3)",
        boxShadow: "inset 0 0 0 3px #22c55e",
      };
    }
    if (selectedSquare) {
      styles[selectedSquare] = {
        backgroundColor: "rgba(99, 102, 241, 0.35)",
        boxShadow: "inset 0 0 0 3px #818cf8",
      };
    }
    return styles;
  }, [deviation, practicing, hintStage, expectedUci, selectedSquare]);

  const marks = useMemo(() => {
    if (!deviation) return {};
    return { [deviation.to]: { text: "✗", color: "#fb7185" } };
  }, [deviation]);

  const arrows = useMemo(() => {
    if (!practicing || hintStage < 2 || !expectedUci) return [];
    return [{ startSquare: expectedUci.slice(0, 2), endSquare: expectedUci.slice(2, 4), color: "#22c55e" }];
  }, [practicing, hintStage, expectedUci]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Opening trainer</h1>
        <p className="text-sm text-zinc-400">
          {openings.length} main lines, one per opening. Step through a line, or practise it as either
          colour and find out where your memory stops.
        </p>
      </div>

      {notice ? (
        <p role="status" className="rounded-xl border border-amber-800 bg-amber-950/40 p-3 text-sm text-amber-200">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {selected ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-lg font-semibold text-zinc-100">{selected.name}</h2>
                <span className="font-mono text-sm text-zinc-400">{selected.eco}</span>
                <span className="text-sm text-zinc-400">
                  {practicing
                    ? `practising as ${practiceColor === "w" ? "White" : "Black"}`
                    : `${selected.uci.length} plies`}
                </span>
                <span aria-live="polite" className="ml-auto font-mono text-sm text-zinc-300">
                  {practicing ? `${Math.min(playedUci.length, selected.uci.length)} / ${selected.uci.length}` : `${step} / ${selected.uci.length}`}
                </span>
              </div>

              <div className="min-w-0" style={{ maxWidth: "min(560px, 60vh)" }}>
                <ChessBoard
                  fen={fen}
                  orientation={boardOrientation}
                  interactive={interactive}
                  onDrop={onDrop}
                  onSquareSelect={onSquareSelect}
                  allowDrawingArrows={false}
                  squareStyles={squareStyles}
                  marks={marks}
                  arrows={arrows}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!practicing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => stepTo(selected, 0)}
                      disabled={step === 0}
                      aria-label="Go to the starting position"
                      className="min-h-11 rounded-lg bg-zinc-800 px-3 text-sm hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-40"
                    >
                      ⏮
                    </button>
                    <button
                      type="button"
                      onClick={() => stepTo(selected, step - 1)}
                      disabled={step === 0}
                      aria-label="Previous move"
                      className="min-h-11 rounded-lg bg-zinc-800 px-3 text-sm hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-40"
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      onClick={() => stepTo(selected, step + 1)}
                      disabled={step >= selected.uci.length}
                      aria-label="Next move"
                      className="min-h-11 rounded-lg bg-zinc-800 px-3 text-sm hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-40"
                    >
                      ▶
                    </button>
                    <button
                      type="button"
                      onClick={() => stepTo(selected, selected.uci.length)}
                      disabled={step >= selected.uci.length}
                      aria-label="Go to the end of the line"
                      className="min-h-11 rounded-lg bg-zinc-800 px-3 text-sm hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-40"
                    >
                      ⏭
                    </button>
                    <span className="mx-1 text-zinc-600" aria-hidden>
                      |
                    </span>
                    <button
                      type="button"
                      onClick={() => resetFor(selected, "w")}
                      disabled={selected.uci.length === 0}
                      className="min-h-11 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-40"
                    >
                      Practise as White
                    </button>
                    <button
                      type="button"
                      onClick={() => resetFor(selected, "b")}
                      disabled={selected.uci.length <= 1}
                      title={selected.uci.length <= 1 ? "This line has no Black move to answer" : undefined}
                      className="min-h-11 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-40"
                    >
                      Practise as Black
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={undo}
                      disabled={playedUci.length <= (practiceColor === "b" ? 1 : 0)}
                      className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-40"
                    >
                      Undo
                    </button>
                    <button
                      type="button"
                      onClick={() => setHintStage((s) => (s === 0 ? 1 : 2))}
                      disabled={!expectedUci || hintStage === 2}
                      className="min-h-11 rounded-lg border border-amber-700/70 px-3 text-sm font-semibold text-amber-200 hover:bg-amber-950/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:opacity-40"
                    >
                      {hintStage === 0 ? "Hint: which piece?" : hintStage === 1 ? "Hint: where to?" : "Hint shown"}
                    </button>
                    <button
                      type="button"
                      onClick={showMe}
                      disabled={!expectedUci}
                      className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-40"
                    >
                      Play it for me
                    </button>
                    <button
                      type="button"
                      onClick={() => resetFor(selected, practiceColor === "w" ? "b" : "w")}
                      disabled={!canPractise}
                      className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-40"
                    >
                      Switch side
                    </button>
                    <button
                      type="button"
                      onClick={() => selectOpening(selected)}
                      className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
                    >
                      Reset
                    </button>
                    <span className="text-xs text-zinc-400">
                      Drag, or click a piece and its square — Tab + Enter works too.
                    </span>
                  </>
                )}
              </div>

              {/* State of play: in theory, a real deviation, or the line simply done. */}
              {practicing && lineComplete ? (
                <div className="rounded-xl border border-indigo-900 bg-indigo-950/30 p-4">
                  <p className="text-sm text-indigo-100">
                    <span className="font-semibold">Line complete</span> — {selected.uci.length}/
                    {selected.uci.length} plies, no deviation.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => resetFor(selected, practiceColor)}
                      className="min-h-11 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
                    >
                      Practise again
                    </button>
                    <button
                      type="button"
                      onClick={nextOpening}
                      className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
                    >
                      Next opening
                    </button>
                  </div>
                </div>
              ) : null}

              {practicing && deviation ? (
                <div role="alert" className="rounded-xl border border-amber-800 bg-amber-950/40 p-4">
                  <p className="text-sm text-amber-100">
                    <span aria-hidden className="mr-1 font-bold">
                      ✗
                    </span>
                    You played <span className="font-semibold">{deviation.played}</span>; the line plays{" "}
                    <span className="font-semibold">{deviation.expected}</span>.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={showMe}
                      className="min-h-11 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
                    >
                      Play {deviation.expected} for me
                    </button>
                    <button
                      type="button"
                      onClick={() => selected && rebuild(selected, playedUci.length, practiceColor)}
                      className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
                    >
                      Try again
                    </button>
                  </div>
                </div>
              ) : null}

              {practicing && !deviation && !lineComplete ? (
                <p className="text-sm text-emerald-400">
                  In theory — {playedUci.length} of {selected.uci.length} plies.
                </p>
              ) : null}

              {/* The line: full when stepping, only what you have played while practising. */}
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  {practicing ? "Played so far" : "Main line"}
                </h3>
                <ol className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-sm">
                  {(practicing ? selected.uci.slice(0, playedUci.length) : selected.uci).map((u, i) => {
                    const isCurrent = !practicing && i === step - 1;
                    const showNumber = i % 2 === 0;
                    return (
                      <li key={u + i} className={isCurrent ? "text-indigo-300" : "text-zinc-300"}>
                        {showNumber ? <span className="text-zinc-400">{Math.floor(i / 2) + 1}.</span> : null}{" "}
                        {sanOf(selected, i)}
                      </li>
                    );
                  })}
                  {practicing && playedUci.length === 0 ? (
                    <li className="text-zinc-400">Nothing played yet.</li>
                  ) : null}
                </ol>
                {selected.ideas ? <p className="mt-2 text-sm text-zinc-300">{selected.ideas}</p> : null}
                <p className="mt-2 text-xs text-zinc-400">
                  <a
                    href={selected.wikipedia}
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-zinc-200"
                  >
                    Wikipedia: strategic ideas for the {selected.name}
                  </a>
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-zinc-300">
              Pick an opening from the list — or open one from your{" "}
              <Link href="/insights" className="underline hover:text-zinc-100">
                insights
              </Link>{" "}
              to train what you actually play.
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="sr-only" htmlFor="opening-search">
            Search openings
          </label>
          <input
            id="opening-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search openings or ECO…"
            className="min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-indigo-500"
          />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Openings ({filtered.length}
            {filtered.length !== openings.length ? ` of ${openings.length}` : ""})
          </h2>
          <div className="max-h-[520px] overflow-auto rounded-xl border border-zinc-800">
            {filtered.map((o) => {
              const active = selected?.eco === o.eco;
              return (
                <button
                  key={o.eco}
                  type="button"
                  onClick={() => selectOpening(o)}
                  aria-current={active ? "true" : undefined}
                  className={`block min-h-11 w-full border-b border-zinc-800 px-3 py-2 text-left last:border-b-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-400 ${
                    active ? "bg-indigo-950/60" : "hover:bg-zinc-900"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-zinc-100">{o.name}</span>
                    <span className="shrink-0 font-mono text-xs text-zinc-400">{o.eco}</span>
                  </div>
                  <div className="text-xs text-zinc-400">{o.uci.length} plies</div>
                </button>
              );
            })}
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-zinc-400">No opening matches “{search}”.</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
