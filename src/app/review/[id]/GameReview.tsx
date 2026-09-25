"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import ChessBoard, { type BoardArrow, type BoardMark } from "@/components/ChessBoard";
import EvalBar from "@/components/EvalBar";
import EvalGraph, { type EvalPoint } from "@/components/EvalGraph";
import MoveList, { type MoveListItem } from "@/components/MoveList";
import { classColor, classGlyph, classLabel, isError } from "@/components/colors";
import { activeDefaultLlmId, activeLlmConnections } from "@/lib/client-profiles";
import { connectionLabel, providerMeta, type LlmConnection } from "@/lib/llm-providers";

/** One AI-written reading of this position, by one provider and model. */
interface AiReading {
  provider: string;
  model: string;
  explanation: string;
  key_lesson: string;
  drill_suggestion: string;
  created_at: string;
}

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
  played_at?: string | null;
  player_color: "w" | "b";
  player_rating: number | null;
  opponent: string;
  analyzed: number;
  accuracy: number | null;
  total_plies?: number;
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
  /** AI readings of this exact position (newest first). Absent when there are none. */
  ai?: AiReading[];
}

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const MINUS = "\u2212";

/* ── formatting ─────────────────────────────────────────────────────────── */

function pawns(cp: number | null | undefined): string {
  if (cp == null) return "—";
  const v = cp / 100;
  return `${v > 0 ? "+" : v < 0 ? MINUS : ""}${Math.abs(v).toFixed(1)}`;
}

function clockLabel(seconds: number | null | undefined): string | null {
  if (seconds == null) return null;
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function moveLabel(ply: number): string {
  return `Move ${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? ". White" : "… Black"}`;
}

/** SQLite stores `datetime('now')` as UTC without a zone; make it unambiguous. */
function storedAt(value: string): string {
  if (!value) return "";
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function resultSentence(game: Game): { text: string; tone: "win" | "loss" | "draw" } {
  const asColor = game.player_color === "w" ? "White" : "Black";
  if (/draw|1\/2|½/i.test(game.result)) return { text: `Draw as ${asColor}`, tone: "draw" };
  const whiteWon = game.result.startsWith("1-0");
  const blackWon = game.result.startsWith("0-1");
  const won = (whiteWon && game.player_color === "w") || (blackWon && game.player_color === "b");
  return { text: `You ${won ? "won" : "lost"} as ${asColor}`, tone: won ? "win" : "loss" };
}

const TONE_CHIP: Record<string, string> = {
  win: "border-emerald-800 bg-emerald-950/40 text-emerald-300",
  loss: "border-rose-900 bg-rose-950/40 text-rose-300",
  draw: "border-zinc-700 bg-zinc-900 text-zinc-300",
};

/* ── icons (authored, one stroke weight) ────────────────────────────────── */

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const IconFirst = () => (
  <Icon>
    <path d="M6 5v14" />
    <path d="M19 5.5 9 12l10 6.5z" />
  </Icon>
);
const IconPrev = () => (
  <Icon>
    <path d="M15 5.5 5 12l10 6.5z" />
  </Icon>
);
const IconNext = () => (
  <Icon>
    <path d="M9 5.5 19 12 9 18.5z" />
  </Icon>
);
const IconLast = () => (
  <Icon>
    <path d="M18 5v14" />
    <path d="M5 5.5 15 12 5 18.5z" />
  </Icon>
);
const IconFlip = () => (
  <Icon>
    <path d="M4 8h13l-3-3" />
    <path d="M20 16H7l3 3" />
  </Icon>
);

/* ── atoms ──────────────────────────────────────────────────────────────── */

function Chip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`rounded border px-2 py-0.5 text-xs font-medium ${className}`}>{children}</span>
  );
}

function ClassBadge({ classification, showGlyph = true }: { classification: string | null; showGlyph?: boolean }) {
  const colour = classColor(classification);
  const glyph = classGlyph(classification);
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-bold"
      style={{ background: `${colour}22`, color: colour }}
    >
      {classLabel(classification)}
      {showGlyph && glyph ? <span aria-hidden>{glyph}</span> : null}
    </span>
  );
}

/* ── critical-moment navigator ──────────────────────────────────────────── */

function CriticalMoments({
  positions,
  all,
  playerColor,
  currentPly,
  onSelect,
  emptyHint,
}: {
  positions: Position[];
  all: Position[];
  playerColor: "w" | "b";
  currentPly: number;
  onSelect: (ply: number) => void;
  emptyHint: string;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<number, HTMLLIElement | null>>({});

  // Reveal the selected row inside this panel only: scrollIntoView would also
  // scroll the page, which is what made picking a mistake jump the screen.
  useEffect(() => {
    const container = listRef.current;
    const item = rowRefs.current[currentPly];
    if (!container || !item) return;
    const containerRect = container.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    if (itemRect.top < containerRect.top) container.scrollTop += itemRect.top - containerRect.top;
    else if (itemRect.bottom > containerRect.bottom) {
      container.scrollTop += itemRect.bottom - containerRect.bottom;
    }
  }, [currentPly]);

  if (positions.length === 0) {
    return <p className="px-1 py-2 text-xs text-zinc-400">{emptyHint}</p>;
  }
  return (
    <div ref={listRef} className="mt-2 max-h-[380px] overflow-auto pr-1">
      <ul className="space-y-1">
        {positions.map((p) => {
        const colour = classColor(p.classification);
        const reply = all[p.ply + 1];
        const isMine = p.color === playerColor;
        return (
          <li
            key={p.ply}
            ref={(el) => {
              rowRefs.current[p.ply] = el;
            }}
          >
            <button
              type="button"
              onClick={() => onSelect(p.ply)}
              aria-current={currentPly === p.ply ? "true" : undefined}
              className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400 ${
                currentPly === p.ply
                  ? "border-indigo-500 bg-indigo-950/60"
                  : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-900"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-zinc-400">
                  {Math.floor(p.ply / 2) + 1}
                  {p.color === "w" ? "." : "…"}
                </span>
                <span className="font-semibold" style={{ color: colour }}>
                  {p.san}
                  {classGlyph(p.classification)}
                </span>
                <span className="ml-auto font-mono text-xs text-zinc-300">
                  {p.centipawn_loss != null ? `${MINUS}${(p.centipawn_loss / 100).toFixed(1)}` : ""}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-400">
                <span>{classLabel(p.classification)}</span>
                {p.motif ? <span>{p.motif.replace(/-/g, " ")}</span> : null}
                {p.phase ? <span>{p.phase}</span> : null}
                {!isMine && reply ? (
                  <span className="text-zinc-400">
                    · you replied{" "}
                    <span style={{ color: classColor(reply.classification) }}>{reply.san}</span>
                  </span>
                ) : null}
              </div>
            </button>
          </li>
        );
      })}
      </ul>
    </div>
  );
}

/* ── screen ─────────────────────────────────────────────────────────────── */

export default function GameReview({ id }: { id: string }) {
  const [game, setGame] = useState<Game | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [currentPly, setCurrentPly] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [depth, setDepth] = useState(14);
  const [notes, setNotes] = useState("");
  const [flipped, setFlipped] = useState(false);
  const [confirmAnalyze, setConfirmAnalyze] = useState(false);
  const [tab, setTab] = useState<"yours" | "theirs">("yours");

  // AI coaching is a separate, user-initiated action against a provider the
  // profile owns. The connections (keys included) are read from localStorage.
  const [connections, setConnections] = useState<LlmConnection[]>([]);
  const [selectedConnection, setSelectedConnection] = useState("");
  const [aiBusy, setAiBusy] = useState<null | "move" | "game">(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [aiView, setAiView] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/games/${id}`);
    if (!res.ok) {
      setError("Game not found.");
      return;
    }
    const data = await res.json();
    const next = (data.positions as Position[]) || [];
    setGame(data.game);
    setPositions(next);
    // Keep the user's place across a refresh: asking the AI for an explanation
    // must not bounce the board back to the start of the game.
    setCurrentPly((p) => (p >= 0 && p < next.length ? p : -1));
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch via a reusable loader
    void load();
  }, [load]);

  useEffect(() => {
    // `chessmentor-note-` is the pre-rename key; reading it too keeps notes
    // written before the rename from silently disappearing.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage must be read post-hydration
    setNotes(
      localStorage.getItem(`chessdad-note-${id}`) ??
        localStorage.getItem(`chessmentor-note-${id}`) ??
        "",
    );
  }, [id]);

  // The acting profile's AI connections. Nothing about them is fetched from the
  // server: they are this browser's, saved on the Profiles screen.
  useEffect(() => {
    const list = activeLlmConnections();
    const preferred = activeDefaultLlmId();
    /* eslint-disable react-hooks/set-state-in-effect -- reading this browser's own storage on mount */
    setConnections(list);
    setSelectedConnection(list.find((c) => c.id === preferred)?.id ?? list[0]?.id ?? "");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Deep link from the library's "turning point" column: /review/7?ply=35
  useEffect(() => {
    if (positions.length === 0) return;
    const raw = new URLSearchParams(window.location.search).get("ply");
    if (raw == null) return;
    const ply = Number(raw);
    if (!Number.isInteger(ply) || ply < 0 || ply >= positions.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the deep link selects a ply once the game loads
    setCurrentPly(ply);
  }, [positions.length]);

  function saveNotes(value: string) {
    setNotes(value);
    localStorage.setItem(`chessdad-note-${id}`, value);
  }

  async function analyze() {
    setConfirmAnalyze(false);
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

  /**
   * Ask the chosen provider to explain the current move, or every flagged move.
   *
   * The connection travels in the body — key included — and is used only for this
   * request's outbound calls, exactly like the Lichess token on an import. A
   * cached answer (same provider and model) comes back free, which is what makes
   * re-running the same provider cheap and comparing two models a matter of one
   * call each.
   */
  async function askAi(scope: "move" | "game", ply: number | null = null) {
    const connection =
      connections.find((c) => c.id === selectedConnection) ?? connections[0] ?? null;
    if (!connection) {
      setAiError("Add an AI provider on the Profiles tab first.");
      return;
    }
    if (scope === "move" && ply == null) return;

    setAiBusy(scope);
    setAiError(null);
    setAiNotice(null);
    try {
      const res = await fetch(`/api/games/${id}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connection,
          ...(scope === "move" && ply != null ? { ply } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiError(data.error || "The AI request failed.");
        return;
      }
      // Reload so the new reading arrives with the same grouping the server uses.
      await load();
      const total = Number(data.analyzed ?? data.results?.length ?? 0);
      const fresh = (data.results as { cached?: boolean }[] | undefined)?.filter(
        (r) => !r.cached
      ).length;
      const cached = fresh == null ? 0 : total - fresh;
      setAiNotice(
        `${total} position${total === 1 ? "" : "s"} explained with ${connectionLabel(connection)}` +
          (cached > 0 ? ` — ${cached} already cached, free.` : ".")
      );
      // A freshly generated reading is the newest; show it rather than an old pick.
      if (scope === "move") setAiView(null);
    } catch {
      setAiError("The AI request failed.");
    } finally {
      setAiBusy(null);
    }
  }

  const playerColor: "w" | "b" = game?.player_color ?? "w";
  const orientation: "white" | "black" =
    (flipped ? (playerColor === "b" ? "w" : "b") : playerColor) === "b" ? "black" : "white";

  const current = currentPly >= 0 && currentPly < positions.length ? positions[currentPly] : null;

  // Every AI reading stored for the selected position, newest first. The chosen
  // one falls back to the newest when nothing (or a stale provider) is selected —
  // this is how "Claude last time, GPT this time" stays viewable side by side.
  const aiReadings = current?.ai ?? [];
  const activeReading =
    aiReadings.find((r) => `${r.provider}|${r.model}` === aiView) ?? aiReadings[0] ?? null;

  // Show the position BEFORE the selected move: the engine's suggested move and
  // the move actually played both start from here. Showing fen_after put the
  // green arrow on a square the piece had already left.
  const boardFen = current ? current.fen : positions[0]?.fen ?? START_FEN;

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

  const { arrows, marks, squareStyles } = useMemo(() => {
    const nextArrows: BoardArrow[] = [];
    const nextMarks: Record<string, BoardMark> = {};
    const nextStyles: Record<string, CSSProperties> = {};
    if (!current) return { arrows: nextArrows, marks: nextMarks, squareStyles: nextStyles };

    const colour = classColor(current.classification);
    const played = current.uci && current.uci.length >= 4 ? current.uci : null;
    if (played) {
      const from = played.slice(0, 2);
      const to = played.slice(2, 4);
      nextArrows.push({ startSquare: from, endSquare: to, color: colour });
      nextStyles[from] = { backgroundColor: `${colour}33` };
      nextStyles[to] = { backgroundColor: `${colour}59`, boxShadow: `inset 0 0 0 3px ${colour}` };
      const glyph = classGlyph(current.classification);
      if (glyph) nextMarks[to] = { text: glyph, color: colour };
    }

    const best = current.best_move && current.best_move.length >= 4 ? current.best_move : null;
    if (best && best !== played && isError(current.classification)) {
      nextArrows.push({ startSquare: best.slice(0, 2), endSquare: best.slice(2, 4), color: "#22c55e" });
    }
    return { arrows: nextArrows, marks: nextMarks, squareStyles: nextStyles };
  }, [current]);

  const playerCritical = useMemo(
    () => positions.filter((p) => p.is_critical === 1 && p.color === playerColor),
    [positions, playerColor]
  );
  const theirCritical = useMemo(
    () => positions.filter((p) => p.is_critical === 1 && p.color !== playerColor),
    [positions, playerColor]
  );

  // The rail reads worst-first (the copy promises it); navigation stays in move
  // order so shift+arrow walks the game rather than jumping around the list.
  const navList = tab === "yours" ? playerCritical : theirCritical;
  const activeList = useMemo(
    () => [...navList].sort((a, b) => (b.centipawn_loss ?? -1) - (a.centipawn_loss ?? -1)),
    [navList]
  );
  const nextCritical = useMemo(() => navList.find((p) => p.ply > currentPly) ?? null, [navList, currentPly]);
  const prevCritical = useMemo(() => {
    const before = navList.filter((p) => p.ply < currentPly);
    return before.length > 0 ? before[before.length - 1] : null;
  }, [navList, currentPly]);

  const summary = useMemo(() => {
    const counts = { blunder: 0, mistake: 0, miss: 0, inaccuracy: 0 };
    const hits = { best: 0, brilliant: 0, great: 0, good: 0 };
    const phaseCounts: Record<string, number> = {};
    const motifCounts: Record<string, number> = {};
    for (const p of positions) {
      if (p.color === playerColor && p.classification && p.classification in hits) {
        hits[p.classification as keyof typeof hits] += 1;
      }
    }
    for (const p of playerCritical) {
      if (p.classification && p.classification in counts) {
        counts[p.classification as keyof typeof counts] += 1;
      }
      if (p.phase) phaseCounts[p.phase] = (phaseCounts[p.phase] ?? 0) + 1;
      if (p.motif) motifCounts[p.motif] = (motifCounts[p.motif] ?? 0) + 1;
    }
    const motifTop = Object.entries(motifCounts).sort((a, b) => b[1] - a[1])[0] ?? null;
    const worst = playerCritical.reduce<Position | null>(
      (acc, p) => (acc == null || (p.centipawn_loss ?? 0) > (acc.centipawn_loss ?? 0) ? p : acc),
      null
    );
    return { counts, hits, phaseCounts, motifTop, worst, first: playerCritical[0] ?? null };
  }, [playerCritical, positions, playerColor]);

  const moveListItems: MoveListItem[] = useMemo(
    () =>
      positions.map((p) => ({
        ply: p.ply,
        san: p.san,
        color: p.color,
        classification: p.classification,
        isCritical: p.is_critical === 1,
        centipawnLoss: p.centipawn_loss,
      })),
    [positions]
  );

  const graphPoints: EvalPoint[] = useMemo(
    () =>
      positions
        .filter((p) => p.eval_before != null)
        .map((p) => ({
          ply: p.ply,
          moveNumber: Math.floor(p.ply / 2) + 1,
          cp: p.color === playerColor ? p.eval_before! : -p.eval_before!,
          san: p.san,
          classification: p.classification,
        })),
    [positions, playerColor]
  );

  // Keyboard transport: ←/→ step, shift+←/→ jump mistakes, Home/End, F flips.
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
      const last = positions.length - 1;
      if (last < 0) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (e.shiftKey && nextCritical) setCurrentPly(nextCritical.ply);
        else setCurrentPly((p) => Math.min(last, p + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (e.shiftKey && prevCritical) setCurrentPly(prevCritical.ply);
        else setCurrentPly((p) => Math.max(-1, p - 1));
      } else if (e.key === "Home") {
        e.preventDefault();
        setCurrentPly(-1);
      } else if (e.key === "End") {
        e.preventDefault();
        setCurrentPly(last);
      } else if (e.key === "f" || e.key === "F") {
        setFlipped((f) => !f);
      } else if (e.key === "Escape") {
        setCurrentPly(-1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [positions.length, nextCritical, prevCritical]);

  if (error && !game) {
    return (
      <div className="rounded-xl border border-rose-900 bg-rose-950/40 p-6 text-rose-300">
        {error} <Link href="/" className="underline">Back to games</Link>
      </div>
    );
  }

  if (!game) {
    return <div className="py-16 text-center text-zinc-400">Loading…</div>;
  }

  const result = resultSentence(game);
  const playedIsMine = current ? current.color === playerColor : false;
  const evalBefore = current
    ? current.eval_before == null
      ? null
      : current.color === playerColor
        ? current.eval_before
        : -current.eval_before
    : null;
  const evalAfter = current
    ? current.eval_after == null
      ? null
      : current.color === playerColor
        ? -current.eval_after
        : current.eval_after
    : null;
  const moverClock = current ? clockLabel(current.clock_seconds) : null;
  const underPressure = current != null && current.clock_seconds != null && current.clock_seconds < 30;

  // Reassurance at the high-stakes moment: a flagged move is not the whole story,
  // and the opponent usually failed to punish it.
  const reply = current ? positions[current.ply + 1] ?? null : null;
  const reassurance: string[] = [];
  if (current && playedIsMine && isError(current.classification)) {
    if (reply && isError(reply.classification)) {
      reassurance.push(
        `They didn't punish it — their reply ${reply.san} was also flagged (${classLabel(
          reply.classification
        ).toLowerCase()}, ${MINUS}${((reply.centipawn_loss ?? 0) / 100).toFixed(1)}).`
      );
    }
    if (current.classification === "miss") {
      reassurance.push("That was a winning chance — worth replaying until you can see it yourself.");
    }
    if (result.tone === "win") reassurance.push("You still won this game.");
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">
              {game.white} <span className="text-zinc-400">vs</span> {game.black}
            </h1>
            <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-sm">{game.result}</span>
            <Chip className={TONE_CHIP[result.tone]}>{result.text}</Chip>
          </div>
          <p className="text-sm text-zinc-400">
            {game.opening_name ? `${game.opening_name} (${game.eco})` : "Opening unknown"} ·{" "}
            <span className="capitalize">{game.speed}</span> · {game.source}
            {game.analyzed && game.accuracy != null ? (
              <>
                {" · "}
                <span className="font-semibold text-indigo-300">{game.accuracy.toFixed(1)}% accuracy</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="depth">
            Engine depth
          </label>
          <select
            id="depth"
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
          >
            <option value={10}>Quick (10)</option>
            <option value={14}>Standard (14)</option>
            <option value={18}>Deep (18)</option>
          </select>
          {confirmAnalyze ? (
            <>
              <button
                type="button"
                onClick={analyze}
                className="rounded-lg border border-amber-700 bg-amber-950/40 px-3 py-1.5 text-sm font-semibold text-amber-200 hover:bg-amber-950/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
              >
                Replace stored analysis
              </button>
              <button
                type="button"
                onClick={() => setConfirmAnalyze(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => (game.analyzed ? setConfirmAnalyze(true) : analyze())}
              disabled={analyzing}
              aria-busy={analyzing}
              className="rounded-lg border border-zinc-700 px-4 py-1.5 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-50"
            >
              {analyzing ? "Analyzing…" : game.analyzed ? "Re-run engine" : "Analyze"}
            </button>
          )}
        </div>
      </header>

      {error && (
        <p role="alert" className="text-sm text-rose-400">
          {error}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="order-1 flex items-stretch gap-3">
            {whiteEval != null && <EvalBar cp={whiteEval} />}
            <div className="min-w-0 flex-1" style={{ maxWidth: "min(520px, 66vh)" }}>
              <ChessBoard
                fen={boardFen}
                orientation={orientation}
                arrows={arrows}
                squareStyles={squareStyles}
                marks={marks}
              />
            </div>
          </div>

          <div className="order-3 flex flex-wrap items-center gap-2 lg:order-2">
            <div className="flex items-center gap-1" role="group" aria-label="Move navigation">
              <button
                type="button"
                onClick={() => setCurrentPly(-1)}
                aria-label="Go to the starting position"
                className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
              >
                <IconFirst />
              </button>
              <button
                type="button"
                onClick={() => setCurrentPly((p) => Math.max(-1, p - 1))}
                aria-label="Previous move"
                className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
              >
                <IconPrev />
              </button>
              <button
                type="button"
                onClick={() => setCurrentPly((p) => Math.min(positions.length - 1, p + 1))}
                aria-label="Next move"
                className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
              >
                <IconNext />
              </button>
              <button
                type="button"
                onClick={() => setCurrentPly(positions.length - 1)}
                aria-label="Go to the final position"
                className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
              >
                <IconLast />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setFlipped((f) => !f)}
              aria-pressed={flipped}
              className="flex h-11 items-center gap-2 rounded-lg bg-zinc-800 px-3 text-sm hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
            >
              <IconFlip /> Flip
            </button>
            <p className="hidden text-xs text-zinc-400 lg:block">
              <kbd className="rounded bg-zinc-800 px-1">←</kbd>{" "}
              <kbd className="rounded bg-zinc-800 px-1">→</kbd> moves ·{" "}
              <kbd className="rounded bg-zinc-800 px-1">shift</kbd> + arrows jumps mistakes ·{" "}
              <kbd className="rounded bg-zinc-800 px-1">F</kbd> flips
            </p>
          </div>

          {/* The verdict: what you played vs what the engine wanted. */}
          {current ? (
            <div className="order-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 lg:order-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-zinc-100">{moveLabel(current.ply)}</span>
                <span className="text-zinc-400">{playedIsMine ? "your move" : "their move"}</span>
                <ClassBadge classification={current.classification} showGlyph={false} />
                {current.centipawn_loss != null && isError(current.classification) ? (
                  <Chip className="border-zinc-700 bg-zinc-950 font-mono text-zinc-200">
                    {MINUS}
                    {(current.centipawn_loss / 100).toFixed(1)} pawns
                  </Chip>
                ) : null}
                {current.phase ? <Chip className="border-zinc-700 bg-zinc-950 text-zinc-300">{current.phase}</Chip> : null}
                {moverClock ? (
                  <Chip className="border-zinc-700 bg-zinc-950 font-mono text-zinc-300">
                    clock {moverClock}
                  </Chip>
                ) : null}
                {underPressure && isError(current.classification) ? (
                  <Chip className="border-amber-800 bg-amber-950/40 text-amber-300">
                    played under 30s — time pressure
                  </Chip>
                ) : null}
              </div>

              <p className="mt-2 text-sm">
                <span className="text-zinc-400">{playedIsMine ? "You played " : "They played "}</span>
                <span className="font-semibold" style={{ color: classColor(current.classification) }}>
                  {current.san ?? "—"}
                  {classGlyph(current.classification)}
                </span>
                {current.best_move_san && current.best_move_san !== current.san ? (
                  <>
                    <span className="text-zinc-400"> · engine wanted </span>
                    <span className="font-semibold text-emerald-400">{current.best_move_san}</span>
                  </>
                ) : (
                  <span className="text-zinc-400">
                    {" "}
                    · {isError(current.classification) ? "engine agrees" : "engine's choice"}
                  </span>
                )}
                {evalBefore != null && evalAfter != null ? (
                  <span className="text-zinc-400">
                    {" "}
                    · eval {pawns(evalBefore)} → {pawns(evalAfter)}
                  </span>
                ) : null}
              </p>

              {current.explanation ? (
                <p className="mt-3 text-sm leading-relaxed text-zinc-200">{current.explanation}</p>
              ) : (
                <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                  {isError(current.classification)
                    ? `No written note for this move. The engine preferred ${
                        current.best_move_san ?? "another move"
                      }, which is why it is flagged as a ${classLabel(current.classification).toLowerCase()}.`
                    : "No engine note for this move — it held up."}
                </p>
              )}

              {reassurance.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {reassurance.map((line) => (
                    <li key={line} className="text-sm text-zinc-300">
                      {line}
                    </li>
                  ))}
                </ul>
              ) : null}

              {current.key_lesson ? (
                <p className="mt-2 text-sm text-emerald-300">
                  <span className="font-semibold">Lesson:</span> {current.key_lesson}
                </p>
              ) : null}

              {current.drill_suggestion ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                  <span className="text-xs uppercase tracking-wider text-zinc-400">Drill</span>
                  <span className="text-sm text-zinc-200">{current.drill_suggestion}</span>
                  <Link
                    href="/puzzles"
                    className="ml-auto rounded border border-indigo-500/60 px-2.5 py-1 text-xs font-semibold text-indigo-300 hover:bg-indigo-950/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
                  >
                    Train this
                  </Link>
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3 text-sm">
                <button
                  type="button"
                  onClick={() => prevCritical && setCurrentPly(prevCritical.ply)}
                  disabled={!prevCritical}
                  className="flex items-center gap-1 rounded bg-zinc-800 px-2.5 py-1.5 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-40"
                >
                  <IconPrev /> {prevCritical ? `${moveLabel(prevCritical.ply)}` : "Previous mistake"}
                </button>
                <button
                  type="button"
                  onClick={() => nextCritical && setCurrentPly(nextCritical.ply)}
                  disabled={!nextCritical}
                  className="flex items-center gap-1 rounded bg-zinc-800 px-2.5 py-1.5 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-40"
                >
                  {nextCritical ? `${moveLabel(nextCritical.ply)}` : "Next mistake"} <IconNext />
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentPly(-1)}
                  className="ml-auto text-xs text-zinc-400 underline hover:text-zinc-200"
                >
                  Back to game summary
                </button>
              </div>
            </div>
          ) : (
            <div className="order-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 lg:order-3">
              <h2 className="text-sm font-semibold text-zinc-100">
                {game.analyzed ? "Where to start" : "Not analysed yet"}
              </h2>
              {!game.analyzed ? (
                <p className="mt-1 text-sm text-zinc-400">
                  Run the engine above and this panel turns into a coach: what you played, what the
                  engine wanted, why it mattered, and what to drill.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-sm text-zinc-300">
                    {result.text} · accuracy{" "}
                    <span className="font-semibold text-indigo-300">
                      {game.accuracy != null ? `${game.accuracy.toFixed(1)}%` : "—"}
                    </span>
                    {" · you matched the engine's move "}
                    {summary.hits.best + summary.hits.brilliant} time
                    {summary.hits.best + summary.hits.brilliant === 1 ? "" : "s"}
                    {summary.hits.brilliant > 0
                      ? `, ${summary.hits.brilliant} of them brillian${
                          summary.hits.brilliant === 1 ? "cy" : "cies"
                        }`
                      : ""}
                    .
                  </p>
                  <p className="mt-1 text-sm text-zinc-400">
                    Worth a look: {summary.counts.mistake} mistake{summary.counts.mistake === 1 ? "" : "s"},{" "}
                    {summary.counts.blunder} blunder{summary.counts.blunder === 1 ? "" : "s"}
                    {summary.counts.miss > 0
                      ? `, and ${summary.counts.miss} winning chance${
                          summary.counts.miss === 1 ? "" : "s"
                        } left on the table`
                      : ""}
                    {theirCritical.length > 0
                      ? ` · they gave you ${theirCritical.length} chance${
                          theirCritical.length === 1 ? "" : "s"
                        } to punish`
                      : ""}
                    .
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(summary.phaseCounts).map(([phase, n]) => (
                      <Chip key={phase} className="border-zinc-700 bg-zinc-950 text-zinc-300">
                        {phase}: {n}
                      </Chip>
                    ))}
                    {summary.motifTop ? (
                      <Chip className="border-zinc-700 bg-zinc-950 text-zinc-300">
                        most common: {summary.motifTop[0].replace(/-/g, " ")} ×{summary.motifTop[1]}
                      </Chip>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {summary.worst ? (
                      <button
                        type="button"
                        onClick={() => setCurrentPly(summary.worst!.ply)}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
                      >
                        Review the costliest moment ({moveLabel(summary.worst.ply)})
                      </button>
                    ) : null}
                    {summary.first && summary.first !== summary.worst ? (
                      <button
                        type="button"
                        onClick={() => setCurrentPly(summary.first!.ply)}
                        className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
                      >
                        First mistake ({moveLabel(summary.first.ply)})
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Deeper analysis: opt-in, provider-chosen, and never a replacement.
              The Stockfish coaching above stays exactly as it is; what the model
              says is stored beside it and offered as a second opinion. */}
          <section className="order-4 rounded-xl border border-indigo-900/60 bg-indigo-950/20 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-100">Deeper analysis (AI)</h2>
              <span className="text-xs text-zinc-400">
                The engine read above is always the baseline; this is an extra look, on request.
              </span>
            </div>

            {connections.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-300">
                No AI provider is set up for this profile.{" "}
                <Link href="/profiles" className="text-indigo-300 underline">
                  Add one on the Profiles tab
                </Link>{" "}
                — Stockfish analysis keeps working without it.
              </p>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="ai-provider">
                  AI provider
                </label>
                <select
                  id="ai-provider"
                  value={selectedConnection}
                  onChange={(e) => setSelectedConnection(e.target.value)}
                  className="min-h-11 max-w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
                >
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {connectionLabel(c)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void askAi("move", current?.ply ?? null)}
                  disabled={!current || aiBusy !== null}
                  aria-busy={aiBusy === "move"}
                  className="min-h-11 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
                >
                  {aiBusy === "move" ? "Asking…" : "Explain this move"}
                </button>
                <button
                  type="button"
                  onClick={() => void askAi("game")}
                  disabled={aiBusy !== null}
                  aria-busy={aiBusy === "game"}
                  className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
                >
                  {aiBusy === "game"
                    ? "Asking…"
                    : `Explain all flagged moves (${
                        playerCritical.length + theirCritical.length
                      })`}
                </button>
                <Link
                  href="/profiles"
                  className="text-xs text-zinc-400 underline hover:text-zinc-200"
                >
                  Manage providers
                </Link>
              </div>
            )}

            {aiError ? (
              <p role="alert" className="mt-2 text-sm text-rose-300">
                {aiError}
              </p>
            ) : null}
            {aiNotice ? (
              <p role="status" className="mt-2 text-sm text-emerald-300">
                {aiNotice}
              </p>
            ) : null}

            {activeReading ? (
              <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {aiReadings.map((r) => {
                    const key = `${r.provider}|${r.model}`;
                    const chosen = activeReading === r;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setAiView(key)}
                        aria-pressed={chosen}
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
                          chosen
                            ? "border-indigo-500 bg-indigo-950/60 text-indigo-200"
                            : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                        }`}
                      >
                        {providerMeta(r.provider)?.short ?? r.provider} · {r.model || "default"}
                      </button>
                    );
                  })}
                  <span className="ml-auto text-[11px] text-zinc-500">
                    {storedAt(activeReading.created_at)}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-zinc-100">
                  {activeReading.explanation}
                </p>
                {activeReading.key_lesson ? (
                  <p className="mt-2 text-sm text-emerald-300">
                    <span className="font-semibold">Lesson:</span> {activeReading.key_lesson}
                  </p>
                ) : null}
                {activeReading.drill_suggestion ? (
                  <p className="mt-2 text-sm text-zinc-300">
                    <span className="mr-1 text-xs uppercase tracking-wider text-zinc-400">Drill</span>
                    {activeReading.drill_suggestion}
                  </p>
                ) : null}
                <p className="mt-2 text-[11px] text-zinc-500">
                  Saved against this exact position and provider, so asking the same model again is
                  free and every other provider you have tried stays here.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-xs text-zinc-400">
                {current
                  ? "No AI reading for this move yet. Ask for one above — every provider you use is kept, so you can compare them later."
                  : "Select a move to ask about it, or explain every flagged move in the game."}
              </p>
            )}
          </section>

          <div className="order-5">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Your evaluation
              </h2>
              <span className="text-xs text-zinc-400">
                click the graph to jump · dots mark critical moves · one pawn ≈ ±1.0
              </span>
            </div>
            <EvalGraph points={graphPoints} currentPly={currentPly} onSelect={setCurrentPly} />
          </div>
        </div>

        <div className="space-y-4">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <div className="flex items-center gap-1" role="tablist" aria-label="Critical moments">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "yours"}
                onClick={() => setTab("yours")}
                className={`min-h-9 flex-1 rounded-lg px-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
                  tab === "yours" ? "bg-indigo-600 text-white" : "text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                Your mistakes ({playerCritical.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "theirs"}
                onClick={() => setTab("theirs")}
                className={`min-h-9 flex-1 rounded-lg px-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
                  tab === "theirs" ? "bg-indigo-600 text-white" : "text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                Their mistakes ({theirCritical.length})
              </button>
            </div>
            <p className="mt-2 px-1 text-xs text-zinc-400">
              {tab === "yours"
                ? "Every move the engine flagged as yours, worst first — the leaks to fix."
                : "Where your opponent went wrong and what you replied. Punishing these is its own skill."}
            </p>
            <CriticalMoments
              positions={activeList}
              all={positions}
              playerColor={playerColor}
              currentPly={currentPly}
              onSelect={setCurrentPly}
              emptyHint={
                tab === "yours"
                  ? "No big mistakes in this game — check the other tab."
                  : "Your opponent never gave you a clear chance in this game."
              }
            />
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              All moves
            </h2>
            <MoveList moves={moveListItems} currentPly={currentPly} onSelect={setCurrentPly} />
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <label
              htmlFor="game-notes"
              className="mb-2 block text-xs font-semibold uppercase tracking-wider text-zinc-400"
            >
              Your notes
            </label>
            <textarea
              id="game-notes"
              value={notes}
              onChange={(e) => saveNotes(e.target.value)}
              placeholder="Annotate your own thoughts before (or after) seeing the engine…"
              rows={5}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <p className="mt-1 text-xs text-zinc-400">
              Saved in this browser, per game. Worth writing before you scroll the review.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
