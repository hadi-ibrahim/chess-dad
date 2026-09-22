"use client";

import { useState } from "react";

export default function ImportForm({ onImported }: { onImported: () => void }) {
  const [lichess, setLichess] = useState("");
  const [chesscom, setChesscom] = useState("");
  const [max, setMax] = useState(100);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!lichess.trim() && !chesscom.trim()) {
      setError("Enter a Lichess and/or Chess.com username.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lichess, chesscom, max }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Import failed");
      } else {
        const parts: string[] = [];
        if (data.lichess) parts.push(`Lichess: ${data.lichess.count} games`);
        if (data.chesscom) parts.push(`Chess.com: ${data.chesscom.count} games`);
        const errs = (data.errors || []).map((e: { source: string; message: string }) => `${e.source}: ${e.message}`);
        setMessage([parts.join(" · "), ...errs].filter(Boolean).join(" — ") || "Done");
        onImported();
      }
    } catch {
      setError("Network error during import.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">
        Import your games
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm text-zinc-300">Lichess username</span>
          <input
            value={lichess}
            onChange={(e) => setLichess(e.target.value)}
            placeholder="e.g. drwolfenstein"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-zinc-300">Chess.com username</span>
          <input
            value={chesscom}
            onChange={(e) => setChesscom(e.target.value)}
            placeholder="e.g. Hikaru"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-zinc-300">Games per site (max {max})</span>
          <input
            type="number"
            min={1}
            max={200}
            value={max}
            onChange={(e) => setMax(Number(e.target.value))}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500"
          />
        </label>
        <div className="flex items-end">
          <button
            onClick={submit}
            disabled={busy}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? "Importing…" : "Import games"}
          </button>
        </div>
      </div>
      {message && <p className="mt-3 text-sm text-emerald-400">{message}</p>}
      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
      <p className="mt-3 text-xs text-zinc-500">
        Games are stored locally in SQLite. No API key is required for public accounts.
      </p>
    </div>
  );
}
