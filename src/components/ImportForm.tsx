"use client";

import { useEffect, useState } from "react";

export default function ImportForm({ onImported }: { onImported: () => void }) {
  const [lichess, setLichess] = useState("");
  const [chesscom, setChesscom] = useState("");
  const [lichessToken, setLichessToken] = useState("");
  const [tokenSaved, setTokenSaved] = useState(false);
  const [max, setMax] = useState(100);
  const [analyzeAfter, setAnalyzeAfter] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => setTokenSaved(Boolean(d.lichessTokenSet)))
      .catch(() => {});
  }, []);

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
        body: JSON.stringify({ lichess, chesscom, max, lichessToken, analyzeAfter }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not queue the import");
      } else {
        const jobs = (data.importJobs || []) as { source: string; username: string; skipped: boolean }[];
        const queued = jobs.filter((j) => !j.skipped);
        const skipped = jobs.length - queued.length;
        if (queued.length > 0) {
          const names = queued.map((j) => `${j.source}: ${j.username}`).join(" · ");
          setMessage(
            `Queued ${names}${analyzeAfter ? " — analysis will follow automatically" : ""}` +
              `${skipped > 0 ? ` (${skipped} already queued)` : ""}. Watch the queue panel.`
          );
        } else {
          setMessage("Those imports are already queued.");
        }
        if (lichessToken.trim()) setTokenSaved(true);
        onImported();
      }
    } catch {
      setError("Network error during import.");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500";

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
            placeholder="e.g. Rooronoa"
            className={field}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-zinc-300">Chess.com username</span>
          <input
            value={chesscom}
            onChange={(e) => setChesscom(e.target.value)}
            placeholder="e.g. Rooronoa_HaD"
            className={field}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm text-zinc-300">
            Lichess API token{" "}
            <span className="text-zinc-400">(optional — makes imports reliable)</span>
          </span>
          <input
            type="password"
            value={lichessToken}
            onChange={(e) => setLichessToken(e.target.value)}
            placeholder={tokenSaved ? "A token is saved — leave blank to reuse it" : "Paste a personal API token"}
            autoComplete="off"
            className={field}
          />
          <span className="mt-1 block text-xs text-zinc-400">
            Create one at{" "}
            <a
              href="https://lichess.org/account/oauth/token"
              target="_blank"
              rel="noreferrer"
              className="text-indigo-400 hover:underline"
            >
              lichess.org/account/oauth/token
            </a>{" "}
            (no scopes required to read public games). Stored locally in your database.
          </span>
          {tokenSaved && (
            <button
              type="button"
              onClick={async () => {
                await fetch("/api/settings", { method: "DELETE" });
                setTokenSaved(false);
                setLichessToken("");
              }}
              className="mt-1 text-xs text-zinc-400 underline hover:text-zinc-200"
            >
              Clear saved token
            </button>
          )}
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-zinc-300">Games per site (max {max})</span>
          <input
            type="number"
            min={1}
            max={200}
            value={max}
            onChange={(e) => setMax(Number(e.target.value))}
            className={field}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-300 sm:col-span-2">
          <input
            type="checkbox"
            checked={analyzeAfter}
            onChange={(e) => setAnalyzeAfter(e.target.checked)}
            className="h-4 w-4 accent-indigo-500"
          />
          Analyze the imported games automatically
        </label>
        <div className="flex items-end sm:col-span-2">
          <button
            onClick={submit}
            disabled={busy}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? "Queueing…" : "Import games"}
          </button>
        </div>
      </div>
      {message && <p className="mt-3 text-sm text-emerald-400">{message}</p>}
      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
      <p className="mt-3 text-xs text-zinc-400">
        Games are stored locally in SQLite. Lichess limits anonymous game exports to a few requests
        per minute; a token above (or <code className="rounded bg-zinc-800 px-1 text-zinc-200">LICHESS_TOKEN</code>{" "}
        in <code className="rounded bg-zinc-800 px-1 text-zinc-200">.env.local</code>) removes that friction.
      </p>
    </div>
  );
}
