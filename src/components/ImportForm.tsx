"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface ActiveProfile {
  id: number;
  lichess_username: string;
  chesscom_username: string;
  display_name: string;
  games: number;
  analyzed: number;
  lichessTokenSet: boolean;
}

function label(p: ActiveProfile): string {
  return p.display_name || p.lichess_username || p.chesscom_username || `Profile ${p.id}`;
}

/**
 * The Games tab's only import control.
 *
 * Profiles are added on the Profiles tab — this panel never asks for a username.
 * It imports for whoever is active, reading their linked accounts and stored
 * token server-side, so the action is one button.
 */
export default function ImportForm({ onImported }: { onImported: () => void }) {
  const [profile, setProfile] = useState<ActiveProfile | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const d = await res.json();
      setProfile((d.profile as ActiveProfile) ?? null);
    } catch {
      setProfile(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount
    void load();
  }, [load]);

  async function runImport() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Import failed (${res.status})`);
      const queued = Number(body.queued ?? 0);
      setMessage(
        queued === 0
          ? "Those accounts are already being imported."
          : `Queued ${queued} import${queued === 1 ? "" : "s"} — games appear as they arrive.`
      );
      await load();
      onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-400">
        Loading your profile…
      </section>
    );
  }

  if (!profile) {
    return (
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm">
        <p className="text-zinc-200">No profile is active.</p>
        <p className="mt-1 text-zinc-400">
          Games belong to a profile. Add one and the app will import for whoever is active.
        </p>
        <Link
          href="/profiles"
          className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-indigo-600 px-4 font-semibold text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
        >
          Go to Profiles
        </Link>
      </section>
    );
  }

  const accounts = [profile.lichess_username, profile.chesscom_username].filter(Boolean);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Importing as
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-zinc-100">{label(profile)}</span>
            {accounts.map((a) => (
              <span key={a} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300">
                {a}
              </span>
            ))}
            <span className="text-xs text-zinc-400">
              {profile.games} game{profile.games === 1 ? "" : "s"}
              {profile.analyzed ? `, ${profile.analyzed} analysed` : ""}
              {profile.lichessTokenSet ? " · token saved" : ""}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/profiles"
            className="inline-flex min-h-11 items-center rounded-lg border border-zinc-700 px-3 text-sm font-medium text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
          >
            Switch profile
          </Link>
          <button
            type="button"
            onClick={runImport}
            disabled={busy || accounts.length === 0}
            className="min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
          >
            {busy ? "Importing…" : profile.games > 0 ? "Re-import games" : "Import games"}
          </button>
        </div>
      </div>

      {accounts.length === 0 ? (
        <p className="mt-3 text-sm text-amber-200">
          This profile has no accounts yet.{" "}
          <Link href="/profiles" className="underline hover:text-amber-100">
            Add a Lichess or Chess.com username
          </Link>{" "}
          and the import button will light up.
        </p>
      ) : null}

      {message ? <p className="mt-3 text-sm text-emerald-300">{message}</p> : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-rose-300">
          {error}
        </p>
      ) : null}
    </section>
  );
}
