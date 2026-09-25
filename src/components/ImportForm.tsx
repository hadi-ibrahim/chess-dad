"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { activeToken } from "@/lib/client-profiles";

interface ActiveProfile {
  id: string;
  name: string;
  lichess_username: string;
  chesscom_username: string;
  display_name: string;
  games: number;
  analyzed: number;
}

interface AccountResult {
  source: string;
  username: string;
  imported: number;
  analysisQueued: number;
  alreadyKnown: number;
  error?: string;
}

function label(p: ActiveProfile): string {
  return p.display_name || p.lichess_username || p.chesscom_username || "This player";
}

/**
 * How many games to fetch, per account.
 *
 * The server clamps to 1..200 and treats this as the *most recent* N, so a small
 * number is the cheap way to try the app out — or to set up a new profile without
 * pulling and analysing a hundred games. The choice is remembered in the browser,
 * because having it reset every visit was the annoying part.
 */
const MAX_OPTIONS = [5, 10, 25, 50, 100];
const MAX_STORAGE_KEY = "cd_import_max";
const DEFAULT_MAX = 100;

function storedMax(): number {
  try {
    const raw = Number(window.localStorage.getItem(MAX_STORAGE_KEY));
    return MAX_OPTIONS.includes(raw) ? raw : DEFAULT_MAX;
  } catch {
    return DEFAULT_MAX;
  }
}

/**
 * The Games tab's only import control.
 *
 * Profiles live in the browser and are added on the Profiles tab — this panel
 * never asks for a username. The Lichess token is read from this browser and
 * posted with the import; the server uses it for that one request and keeps
 * nothing. Because games are filed by account rather than by profile, an account
 * that is already known is served its existing analysis instead of being fetched
 * and analysed again.
 */
export default function ImportForm({ onImported }: { onImported: () => void }) {
  const [profile, setProfile] = useState<ActiveProfile | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [max, setMax] = useState(DEFAULT_MAX);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const d = await res.json();
      setProfile((d.profile as ActiveProfile) ?? null);
      setHasToken(Boolean(activeToken()));
    } catch {
      setProfile(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    // Read after mount, not during render: `localStorage` does not exist while the
    // page is prerendered on the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only preference
    setMax(storedMax());
    void load();
  }, [load]);

  function changeMax(value: number) {
    setMax(value);
    try {
      window.localStorage.setItem(MAX_STORAGE_KEY, String(value));
    } catch {
      // A preference we cannot save is not worth failing the import over.
    }
  }

  async function runImport() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The token goes with the request, and only this request. It is never
        // stored server-side, so it survives restarts and redeploys with the
        // browser that holds it.
        body: JSON.stringify({ lichessToken: activeToken(), max }),
      });
      const body = (await res.json()) as {
        error?: string;
        imported?: number;
        analysisQueued?: number;
        accounts?: AccountResult[];
      };
      if (!res.ok) throw new Error(body.error ?? `Import failed (${res.status})`);

      const accounts = body.accounts ?? [];
      const failed = accounts.filter((a) => a.error);
      const lines = accounts
        .filter((a) => !a.error)
        .map(
          (a) =>
            `${a.source}: ${a.imported} game${a.imported === 1 ? "" : "s"}` +
            // Say when the site sent fewer than were asked for — a throttled or
            // truncated export otherwise reads as "the account only has one game".
            (a.imported < max ? ` of ${max} asked` : "") +
            (a.alreadyKnown ? ` (${a.alreadyKnown} already here)` : "") +
            (a.analysisQueued ? `, ${a.analysisQueued} queued to analyse` : "")
        );
      for (const f of failed) lines.push(`${f.source}: ${f.error}`);

      if (!lines.length) {
        setMessage("Nothing new to import.");
      } else {
        setMessage(lines.join(" · "));
      }
      if (failed.length && failed.length < accounts.length) {
        setError("Some accounts could not be fetched — see above.");
      }
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
              {hasToken ? " · token in this browser" : ""}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor="import-max"
            className="flex min-h-11 items-center gap-2 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-300"
          >
            <span className="text-xs text-zinc-400">Games per account</span>
            <select
              id="import-max"
              value={max}
              onChange={(e) => changeMax(Number(e.target.value))}
              disabled={busy || accounts.length === 0}
              className="bg-transparent text-sm font-semibold text-zinc-100 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
            >
              {MAX_OPTIONS.map((n) => (
                <option key={n} value={n} className="bg-zinc-900 text-zinc-100">
                  {n}
                </option>
              ))}
            </select>
          </label>
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
            {busy ? "Fetching…" : profile.games > 0 ? "Re-import games" : "Import games"}
          </button>
        </div>
      </div>

      {accounts.length > 1 ? (
        <p className="mt-2 text-xs text-zinc-500">
          Each account imports its own most recent games, so {max} here means up to {max} from
          each.
        </p>
      ) : null}

      {accounts.length === 0 ? (
        <p className="mt-3 text-sm text-amber-200">
          This profile has no accounts yet.{" "}
          <Link href="/profiles" className="underline hover:text-amber-100">
            Add a Lichess or Chess.com username
          </Link>{" "}
          and the import button will light up.
        </p>
      ) : null}

      {!hasToken && profile.lichess_username ? (
        <p className="mt-3 text-xs text-zinc-400">
          No Lichess token saved for this profile, so the import runs anonymously and may be
          throttled.{" "}
          <Link href="/profiles" className="underline hover:text-zinc-200">
            Add one on the Profiles tab
          </Link>{" "}
          to make it reliable.
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
