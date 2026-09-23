"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Counts {
  queued: number;
  running: number;
  done: number;
  failed: number;
  canceled: number;
}

interface Status {
  jobs: Counts;
  byType: Record<string, Counts>;
  games: { total: number; analyzed: number; pending: number; empty: number };
  active: { id: number; type: string; label: string | null; progress: number; stage: string | null }[];
  worker: { started: boolean; running: number; concurrency: number; poolSize: number };
}

const EMPTY: Counts = { queued: 0, running: 0, done: 0, failed: 0, canceled: 0 };

export default function AnalysisQueue({ onProgress }: { onProgress?: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const last = useRef<{ total: number; analyzed: number } | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs/status");
      setStatus((await res.json()) as Status);
    } catch {
      // transient network error — try again on the next tick
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling an external queue
    void poll();
    const timer = setInterval(() => void poll(), 1500);
    return () => clearInterval(timer);
  }, [poll]);

  // Refresh the parent list whenever the library changes — new imports or analyses.
  useEffect(() => {
    if (!status) return;
    const now = { total: status.games.total, analyzed: status.games.analyzed };
    const prev = last.current;
    if (prev && (prev.total !== now.total || prev.analyzed !== now.analyzed)) onProgress?.();
    last.current = now;
  }, [status, onProgress]);

  async function action(name: string) {
    setBusy(true);
    try {
      await fetch(`/api/jobs?action=${name}`, { method: "DELETE" });
      await poll();
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  const { jobs, games, active, worker, byType } = status;
  const importing = byType.import ?? EMPTY;
  const analyzing = byType.analyze ?? EMPTY;
  const inFlight = jobs.queued + jobs.running;
  const analyzable = Math.max(0, games.total - games.empty);
  const pct = analyzable > 0 ? Math.round((games.analyzed / analyzable) * 100) : 0;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Job queue</h2>
        <span className="text-xs text-zinc-400">
          {worker.concurrency} workers · {games.analyzed}/{analyzable} games analyzed
          {jobs.running > 0 && <span className="text-indigo-300"> · {jobs.running} running</span>}
        </span>
      </div>

      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-400">
        <span>
          Queued <b className="text-zinc-200">{jobs.queued}</b>
        </span>
        <span>
          Running <b className="text-indigo-300">{jobs.running}</b>
        </span>
        <span>
          Done <b className="text-emerald-400">{jobs.done}</b>
        </span>
        {jobs.failed > 0 && (
          <span className="text-rose-400">
            Failed <b>{jobs.failed}</b>
          </span>
        )}
        {jobs.canceled > 0 && <span>Canceled {jobs.canceled}</span>}
      </div>

      {(importing.queued + importing.running > 0 || analyzing.queued + analyzing.running > 0) && (
        <div className="mt-2 flex flex-wrap gap-x-5 text-xs text-zinc-400">
          {importing.queued + importing.running > 0 && (
            <span>
              imports: <b className="text-zinc-300">{importing.running}</b> running /{" "}
              <b className="text-zinc-300">{importing.queued}</b> queued
            </span>
          )}
          {analyzing.queued + analyzing.running > 0 && (
            <span>
              analysis: <b className="text-zinc-300">{analyzing.running}</b> running /{" "}
              <b className="text-zinc-300">{analyzing.queued}</b> queued
            </span>
          )}
        </div>
      )}

      {active.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {active.map((j) => (
            <div key={j.id} className="flex items-center gap-2 text-xs">
              <span
                className={`w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] uppercase tracking-wide ${
                  j.type === "import"
                    ? "bg-cyan-950 text-cyan-300"
                    : "bg-indigo-950 text-indigo-300"
                }`}
              >
                {j.type}
              </span>
              <span className="w-40 shrink-0 truncate text-zinc-400">{j.label ?? ""}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full bg-indigo-400 transition-all"
                  style={{ width: `${Math.round(j.progress * 100)}%` }}
                />
              </div>
              <span className="w-16 text-right text-zinc-500">{j.stage ?? ""}</span>
            </div>
          ))}
        </div>
      )}

      {(inFlight > 0 || jobs.failed > 0 || jobs.done > 0 || jobs.canceled > 0) && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => action("cancel")}
            disabled={busy || jobs.queued === 0}
            className="rounded bg-zinc-800 px-2.5 py-1 text-xs hover:bg-zinc-700 disabled:opacity-40"
          >
            Cancel pending
          </button>
          {jobs.failed > 0 && (
            <button
              onClick={() => action("retry")}
              disabled={busy}
              className="rounded bg-amber-900/40 px-2.5 py-1 text-xs text-amber-200 hover:bg-amber-900/60 disabled:opacity-40"
            >
              Retry failed
            </button>
          )}
          {(jobs.done > 0 || jobs.canceled > 0) && (
            <button
              onClick={() => action("clear")}
              disabled={busy}
              className="rounded bg-zinc-800 px-2.5 py-1 text-xs hover:bg-zinc-700 disabled:opacity-40"
            >
              Clear finished
            </button>
          )}
        </div>
      )}
    </div>
  );
}
