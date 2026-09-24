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

/**
 * Where to actually get a token — the one thing about this field nobody can
 * guess. Carried over from the original import form rather than summarised away,
 * because "paste a personal API token" is only actionable with the link.
 */
function TokenHint() {
  return (
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
      — no scopes are required to read public games.
    </span>
  );
}

/** What to call someone when neither username has been filled in. */
function label(p: Profile): string {
  return p.display_name || p.lichess_username || p.chesscom_username || `Profile ${p.id}`;
}

const EMPTY_DRAFT = {
  display_name: "",
  lichess_username: "",
  chesscom_username: "",
  lichessToken: "",
};

const FIELD =
  "mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-zinc-100 placeholder:text-zinc-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400";
const BTN =
  "min-h-11 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400";
const PRIMARY =
  "min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400";

export default function Profiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Add form.
  const [addDraft, setAddDraft] = useState(EMPTY_DRAFT);
  const [adding, setAdding] = useState(false);

  // Inline edit — one row at a time, so the directory stays visible and there is
  // no modal for something that needs neither interruption nor protected focus.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/profiles?q=${encodeURIComponent(debouncedQ)}`);
      if (!res.ok) throw new Error(`Could not load profiles (${res.status})`);
      const body = (await res.json()) as { profiles: Profile[]; activeProfileId: number | null };
      setProfiles(body.profiles);
      setActiveId(body.activeProfileId);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch keyed by the search term
    void load();
  }, [load]);

  /** The choice is a browser preference, not a login. */
  function activateProfile(id: number) {
    document.cookie = `${PROFILE_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
    setActiveId(id);
  }

  async function add() {
    const lichess = addDraft.lichess_username.trim();
    const chesscom = addDraft.chesscom_username.trim();
    if (!lichess && !chesscom) {
      setError("Add a Lichess or Chess.com username.");
      return;
    }
    setAdding(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lichess_username: lichess,
          chesscom_username: chesscom,
          display_name: addDraft.display_name,
          lichessToken: addDraft.lichessToken,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Could not add the profile (${res.status})`);
      setAddDraft(EMPTY_DRAFT);
      await load();
      activateProfile(Number(body.id));
      setNotice("Profile added and switched to.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(false);
    }
  }

  function startEdit(p: Profile) {
    setEditingId(p.id);
    setDraft({
      display_name: p.display_name,
      lichess_username: p.lichess_username,
      chesscom_username: p.chesscom_username,
      lichessToken: "",
    });
    setError(null);
    setNotice(null);
  }

  async function saveEdit(id: number) {
    if (!draft.lichess_username.trim() && !draft.chesscom_username.trim()) {
      setError("A profile needs at least one Lichess or Chess.com username.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/profiles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: draft.display_name,
          lichess_username: draft.lichess_username,
          chesscom_username: draft.chesscom_username,
          // Omitted when blank, so editing a name cannot wipe a stored token.
          ...(draft.lichessToken.trim() ? { lichessToken: draft.lichessToken } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Could not save the profile (${res.status})`);
      setEditingId(null);
      await load();
      setNotice("Profile updated.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function clearToken(p: Profile) {
    if (!window.confirm(`Remove the saved Lichess token for ${label(p)}?`)) return;
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/profiles/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lichessToken: "" }),
      });
      if (!res.ok) throw new Error(`Could not clear the token (${res.status})`);
      await load();
      setNotice("Saved token removed.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(p: Profile) {
    const owned = p.games > 0 ? ` and its ${p.games} imported game${p.games === 1 ? "" : "s"}` : "";
    if (!window.confirm(`Delete ${label(p)}${owned}? This cannot be undone.`)) return;
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/profiles/${p.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Could not delete the profile (${res.status})`);
      }
      if (editingId === p.id) setEditingId(null);
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
          Everyone keeps their own library. A profile can hold a Lichess account, a Chess.com
          account, or both — imports from either land in the same library. Open the app as
          whoever you are and every other tab follows.
        </p>
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="rounded-xl border border-emerald-900 bg-emerald-950/30 p-4 text-sm text-emerald-200">
          {notice}
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
              value={addDraft.lichess_username}
              onChange={(e) => setAddDraft((d) => ({ ...d, lichess_username: e.target.value }))}
              placeholder="e.g. Rooronoa"
              className={FIELD}
            />
          </label>
          <label className="block text-sm">
            <span className="text-zinc-300">Chess.com username</span>
            <input
              value={addDraft.chesscom_username}
              onChange={(e) => setAddDraft((d) => ({ ...d, chesscom_username: e.target.value }))}
              placeholder="e.g. Rooronoa_HaD"
              className={FIELD}
            />
          </label>
          <label className="block text-sm">
            <span className="text-zinc-300">Display name (optional)</span>
            <input
              value={addDraft.display_name}
              onChange={(e) => setAddDraft((d) => ({ ...d, display_name: e.target.value }))}
              placeholder="What to call this player"
              className={FIELD}
            />
          </label>
          <label className="block text-sm">
            <span className="text-zinc-300">
              Lichess API token{" "}
              <span className="text-zinc-400">(optional — makes imports reliable)</span>
            </span>
            <input
              value={addDraft.lichessToken}
              onChange={(e) => setAddDraft((d) => ({ ...d, lichessToken: e.target.value }))}
              type="password"
              autoComplete="off"
              placeholder="Paste a personal API token"
              className={FIELD}
            />
            <TokenHint />
          </label>
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          Fill in either username, or both. Tokens are stored against the profile and are never
          sent back to the browser — the app only ever reports whether one is set, so removing one
          is a deliberate action on its row below.
        </p>
        <button type="button" onClick={add} disabled={adding} className={`mt-3 ${PRIMARY}`}>
          {adding ? "Adding…" : "Add profile"}
        </button>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Everyone</h2>
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
            {debouncedQ ? `No profile matches “${debouncedQ}”.` : "No profiles yet — add the first one above."}
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {profiles.map((p) => {
              const active = p.id === activeId;

              if (editingId === p.id) {
                return (
                  <li key={p.id} className="py-4">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveEdit(p.id);
                      }}
                    >
                      <div className="mb-3 flex items-center gap-2">
                        <span className="text-sm font-semibold text-zinc-100">Editing {label(p)}</span>
                        {active ? (
                          <span className="rounded bg-indigo-950 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-300">
                            you
                          </span>
                        ) : null}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block text-sm">
                          <span className="text-zinc-300">Lichess username</span>
                          <input
                            value={draft.lichess_username}
                            onChange={(e) => setDraft((d) => ({ ...d, lichess_username: e.target.value }))}
                            className={FIELD}
                            autoFocus
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="text-zinc-300">Chess.com username</span>
                          <input
                            value={draft.chesscom_username}
                            onChange={(e) => setDraft((d) => ({ ...d, chesscom_username: e.target.value }))}
                            className={FIELD}
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="text-zinc-300">Display name</span>
                          <input
                            value={draft.display_name}
                            onChange={(e) => setDraft((d) => ({ ...d, display_name: e.target.value }))}
                            className={FIELD}
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="text-zinc-300">Replace Lichess token</span>
                          <input
                            value={draft.lichessToken}
                            onChange={(e) => setDraft((d) => ({ ...d, lichessToken: e.target.value }))}
                            type="password"
                            autoComplete="off"
                            placeholder={
                              p.lichessTokenSet
                                ? "A token is saved — leave blank to reuse it"
                                : "Paste a personal API token"
                            }
                            className={FIELD}
                          />
                          <TokenHint />
                        </label>
                      </div>
                      <p className="mt-2 text-xs text-zinc-400">
                        Existing games keep the profile they were imported under, so changing a
                        username here does not move or re-attribute anything.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="submit" disabled={saving} className={PRIMARY}>
                          {saving ? "Saving…" : "Save changes"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className={`${BTN} border-zinc-700 text-zinc-200 hover:bg-zinc-800`}
                        >
                          Cancel
                        </button>
                        {p.lichessTokenSet ? (
                          <button
                            type="button"
                            onClick={() => clearToken(p)}
                            className={`${BTN} border-zinc-800 text-zinc-400 hover:border-rose-900 hover:text-rose-300`}
                          >
                            Remove saved token
                          </button>
                        ) : null}
                      </div>
                    </form>
                  </li>
                );
              }

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
                      {!p.lichess_username && !p.chesscom_username ? <span>No accounts linked</span> : null}
                      <span>
                        {p.games} game{p.games === 1 ? "" : "s"}
                        {p.analyzed ? `, ${p.analyzed} analysed` : ""}
                      </span>
                      {p.lichessTokenSet ? <span>token saved</span> : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => startEdit(p)}
                    className={`${BTN} border-zinc-700 text-zinc-200 hover:bg-zinc-800`}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => activateProfile(p.id)}
                    disabled={active}
                    className={`${BTN} ${active ? "border-zinc-800 text-zinc-500" : "border-zinc-700 text-zinc-200 hover:bg-zinc-800"}`}
                  >
                    {active ? "In use" : "Use this profile"}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(p)}
                    className={`${BTN} border-zinc-800 text-zinc-400 hover:border-rose-900 hover:text-rose-300`}
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
