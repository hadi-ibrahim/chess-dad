"use client";

import { useCallback, useEffect, useState } from "react";
import { PROFILE_COOKIE } from "@/lib/profile-cookie";

interface Profile {
  id: number;
  lichess_username: string;
  chesscom_username: string;
  display_name: string;
  games: number;
  analyzed: number;
  lichessTokenSet: boolean;
}

/** What to call someone when neither username has been filled in. */
function label(p: Profile): string {
  return (
    p.display_name ||
    p.lichess_username ||
    p.chesscom_username ||
    `Profile ${p.id}`
  );
}

export default function Profiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [lichess, setLichess] = useState("");
  const [chesscom, setChesscom] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [token, setToken] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/profiles?q=${encodeURIComponent(debouncedQ)}`);
      if (!res.ok) throw new Error(`Could not load profiles (${res.status})`);
      const body = (await res.json()) as { profiles: Profile[]; activeProfileId: number | null };
      setProfiles(body.profiles);
      setActiveId(body.activeProfileId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() clears the error before it fetches
    void load();
  }, [load]);

  /** The choice is a browser preference, not a login. */
  function use_(id: number) {
    document.cookie = `${PROFILE_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
    setActiveId(id);
  }

  async function add() {
    if (!lichess.trim() && !chesscom.trim()) {
      setError("Add a Lichess or Chess.com username.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lichess_username: lichess,
          chesscom_username: chesscom,
          display_name: displayName,
          lichessToken: token,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Could not add the profile (${res.status})`);
      setLichess("");
      setChesscom("");
      setDisplayName("");
      setToken("");
      await load();
      use_(Number(body.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Profile) {
    const owned = p.games > 0 ? ` and its ${p.games} imported game${p.games === 1 ? "" : "s"}` : "";
    if (!window.confirm(`Delete ${label(p)}${owned}? This cannot be undone.`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/profiles/${p.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Could not delete the profile (${res.status})`);
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Profiles</h1>
        <p className="text-sm text-zinc-400">
          Everyone keeps their own library. Add a profile for each person whose games you
          import, then open the app as whoever you are — Games, Insights, Puzzles and
          Openings all follow the profile you pick.
        </p>
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Add a profile
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-zinc-300">Lichess username</span>
            <input
              value={lichess}
              onChange={(e) => setLichess(e.target.value)}
              placeholder="e.g. Rooronoa"
              className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-zinc-100 placeholder:text-zinc-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
            />
          </label>
          <label className="block text-sm">
            <span className="text-zinc-300">Chess.com username</span>
            <input
              value={chesscom}
              onChange={(e) => setChesscom(e.target.value)}
              placeholder="e.g. Rooronoa_HaD"
              className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-zinc-100 placeholder:text-zinc-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
            />
          </label>
          <label className="block text-sm">
            <span className="text-zinc-300">Display name (optional)</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="What to call this player"
              className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-zinc-100 placeholder:text-zinc-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
            />
          </label>
          <label className="block text-sm">
            <span className="text-zinc-300">Lichess API token (optional)</span>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              type="password"
              placeholder="Only needed for private games"
              className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-zinc-100 placeholder:text-zinc-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          Tokens are stored against the profile and are never sent back to the browser —
          the app only ever reports whether one is set.
        </p>
        <button
          type="button"
          onClick={add}
          disabled={busy}
          className="mt-3 min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
        >
          {busy ? "Adding…" : "Add profile"}
        </button>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Everyone
          </h2>
          <label className="text-sm">
            <span className="sr-only">Search profiles</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search usernames…"
              className="min-h-11 w-56 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-zinc-100 placeholder:text-zinc-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
            />
          </label>
        </div>

        {loading ? (
          <p className="py-6 text-center text-sm text-zinc-400">Loading profiles…</p>
        ) : profiles.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-400">
            {debouncedQ
              ? `No profile matches “${debouncedQ}”.`
              : "No profiles yet — add the first one above."}
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {profiles.map((p) => {
              const active = p.id === activeId;
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <div className="min-w-48 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-100">{label(p)}</span>
                      {active ? (
                        <span className="rounded bg-indigo-950 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-300">
                          you
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-zinc-400">
                      {p.lichess_username ? <span>Lichess · {p.lichess_username}</span> : null}
                      {p.chesscom_username ? <span>Chess.com · {p.chesscom_username}</span> : null}
                      <span>
                        {p.games} game{p.games === 1 ? "" : "s"}
                        {p.analyzed ? `, ${p.analyzed} analysed` : ""}
                      </span>
                      {p.lichessTokenSet ? <span>token saved</span> : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => use_(p.id)}
                    disabled={active}
                    className={`min-h-11 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
                      active
                        ? "border-zinc-800 text-zinc-500"
                        : "border-zinc-700 text-zinc-200 hover:bg-zinc-800"
                    }`}
                  >
                    {active ? "In use" : "Use this profile"}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(p)}
                    className="min-h-11 rounded-lg border border-zinc-800 px-3 text-sm text-zinc-400 hover:border-rose-900 hover:text-rose-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400"
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
