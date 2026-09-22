"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Status {
  jobs: { queued: number; running: number; done: number; failed: number; canceled: number };
  games: { total: number; analyzed: number; pending: number; empty: number };
  active: { id: number; gameId: number; progress: number; stage: string | null }[];
  worker: { started: boolean; running: number; concurrency: number; poolSize: number };
}

export default function AnalysisQueue({ onProgress }: { onProgress?: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const lastAnalyzed = useRef<number | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/analysis/status");
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

  // Let the parent refresh its list whenever the analysed count advances.
  useEffect(() => {
    const n = status?.games.analyzed;
    if (n == null) return;
    if (lastAnalyzed.current !== null && n !== lastAnalyzed.current) onProgress?.();
    lastAnalyzed.current = n;
  }, [status, onProgress]);

  async function action(name: string) {
    setBusy(true);
    try {
      await fetch(`/api/analysis/jobs?action=${name}`, { method: "DELETE" });
      await poll();
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  const { jobs, games, active, worker } = status;
  const inFlight = jobs.queued + jobs.running;
  const analyzable = Math.max(0, games.total - games.empty);
  const pct = analyzable > 0 ? Math.round((games.analyzed / analyzable) * 100) : 0;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Analysis queue
        </h2>
        <span className="text-xs text-zinc-500">
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

      {active.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {active.map((j) => (
            <div key={j.id} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 text-zinc-500">game {j.gameId}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full bg-indigo-400 transition-all"
                  style={{ width: `${Math.round(j.progress * 100)}%` }}
                />
              </div>
              <span className="w-14 text-right text-zinc-500">{j.stage ?? ""}</span>
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
