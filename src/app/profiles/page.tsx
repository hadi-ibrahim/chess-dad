"use client";

import { useCallback, useEffect, useState } from "react";
import {
  activeProfile,
  clearActiveProfile,
  createProfile,
  loadProfiles,
  refreshCookie,
  saveProfiles,
  setActiveProfile,
  type StoredProfile,
} from "@/lib/client-profiles";
import { profileLabel } from "@/lib/profile-cookie";
import { connectionLabel, type LlmConnection } from "@/lib/llm-providers";
import LlmConnections from "@/components/LlmConnections";

interface Stats {
  id: string;
  games: number;
  analyzed: number;
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

const EMPTY_DRAFT = {
  name: "",
  lichess: "",
  chesscom: "",
  lichessToken: "",
  llm: [] as LlmConnection[],
  defaultLlmId: "",
};

const FIELD =
  "mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-zinc-100 placeholder:text-zinc-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400";
const BTN =
  "min-h-11 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400";
const PRIMARY =
  "min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400";

const TOKEN_NOTE =
  "Kept in this browser only, saved with the profile. It is sent once per import — for the Lichess request and nothing else — and is never sent to the server at any other time.";

export default function Profiles() {
  const [profiles, setProfiles] = useState<StoredProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, Stats>>({});
  const [deploymentTokenSet, setDeploymentTokenSet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Add form.
  const [addDraft, setAddDraft] = useState(EMPTY_DRAFT);
  const [adding, setAdding] = useState(false);

  // Inline edit — one row at a time, so the list stays visible and there is no
  // modal for something that needs neither interruption nor protected focus.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const refreshStats = useCallback(async (list: StoredProfile[]) => {
    const [statsRes, settingsRes] = await Promise.all([
      list.length
        ? fetch("/api/profiles/stats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // The profiles are local, so the screen sends them up to be counted.
            body: JSON.stringify({ profiles: list }),
          })
        : Promise.resolve(null),
      fetch("/api/settings"),
    ]);
    if (statsRes?.ok) {
      const body = (await statsRes.json()) as { stats: Stats[] };
      setStats(Object.fromEntries(body.stats.map((s) => [s.id, s])));
    }
    if (settingsRes.ok) {
      const body = (await settingsRes.json()) as { deploymentTokenSet: boolean };
      setDeploymentTokenSet(Boolean(body.deploymentTokenSet));
    }
  }, []);

  useEffect(() => {
    const list = loadProfiles();
    const active = activeProfile();
    /* eslint-disable react-hooks/set-state-in-effect -- reading this browser's own storage on mount */
    setProfiles(list);
    setActiveId(active?.id ?? null);
    /* eslint-enable react-hooks/set-state-in-effect */
    void refreshStats(list).finally(() => setLoading(false));
  }, [refreshStats]);

  /** The choice is a browser preference, not a login. */
  async function activate(profile: StoredProfile) {
    setActiveProfile(profile);
    setActiveId(profile.id);
    setError(null);
    setNotice(null);
    // Linking runs server-side: any game already stored for these accounts is
    // attached immediately, which is why a second browser starts with a full
    // library and nothing to re-import.
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sync: true }),
    });
    if (res.ok) {
      const known = stats[profile.id]?.games ?? 0;
      setNotice(
        known > 0
          ? `Now using ${profileLabel(profile)} — ${known} already-analysed game${known === 1 ? "" : "s"} are waiting.`
          : `Now using ${profileLabel(profile)}.`
      );
    }
    await refreshStats(profiles);
  }

  async function add() {
    const lichess = addDraft.lichess.trim();
    const chesscom = addDraft.chesscom.trim();
    if (!lichess && !chesscom) {
      setError("Add a Lichess or Chess.com username.");
      return;
    }
    setAdding(true);
    setError(null);
    setNotice(null);
    try {
      const profile = createProfile(
        addDraft.name.trim(),
        lichess,
        chesscom,
        addDraft.lichessToken.trim(),
        addDraft.llm,
        addDraft.defaultLlmId
      );
      const next = [...profiles, profile];
      saveProfiles(next);
      setProfiles(next);
      setAddDraft(EMPTY_DRAFT);
      setActiveProfile(profile);
      setActiveId(profile.id);
      await refreshStats(next);
      setNotice("Profile added and switched to. It is stored in this browser only.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(false);
    }
  }

  function startEdit(p: StoredProfile) {
    setEditingId(p.id);
    setDraft({
      name: p.name,
      lichess: p.lichess,
      chesscom: p.chesscom,
      lichessToken: "",
      llm: p.llm,
      defaultLlmId: p.defaultLlmId,
    });
    setError(null);
    setNotice(null);
  }

  async function saveEdit(id: string) {
    if (!draft.lichess.trim() && !draft.chesscom.trim()) {
      setError("A profile needs at least one Lichess or Chess.com username.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const existing = profiles.find((p) => p.id === id);
      const updated: StoredProfile = {
        id,
        name: draft.name.trim(),
        lichess: draft.lichess.trim(),
        chesscom: draft.chesscom.trim(),
        // A blank field keeps the stored token, so renaming cannot wipe it.
        token: draft.lichessToken.trim() || existing?.token || "",
        llm: draft.llm,
        defaultLlmId: draft.defaultLlmId,
      };
      const next = profiles.map((p) => (p.id === id ? updated : p));
      saveProfiles(next);
      setProfiles(next);
      refreshCookie(updated);
      setEditingId(null);
      await refreshStats(next);
      setNotice("Profile updated.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function clearToken(p: StoredProfile) {
    if (!window.confirm(`Remove the saved Lichess token for ${profileLabel(p)}?`)) return;
    const next = profiles.map((x) => (x.id === p.id ? { ...x, token: "" } : x));
    saveProfiles(next);
    setProfiles(next);
    setError(null);
    setNotice("Saved token removed. Imports from this browser go back to the anonymous limits.");
  }

  function remove(p: StoredProfile) {
    const owned = stats[p.id]?.games ?? 0;
    const detail = owned > 0 ? ` It will stop showing its ${owned} game${owned === 1 ? "" : "s"}.` : "";
    if (
      !window.confirm(
        `Remove ${profileLabel(p)} from this browser?${detail} The analysed games stay on the server, and adding the account again brings them straight back.`
      )
    ) {
      return;
    }
    const next = profiles.filter((x) => x.id !== p.id);
    saveProfiles(next);
    setProfiles(next);
    if (editingId === p.id) setEditingId(null);
    if (activeId === p.id) {
      // Fall back to whoever is left, or to nobody.
      clearActiveProfile();
      const fallback = next[0] ?? null;
      if (fallback) {
        setActiveProfile(fallback);
        setActiveId(fallback.id);
      } else {
        setActiveId(null);
      }
    }
    setError(null);
    setNotice("Removed from this browser.");
    void refreshStats(next);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Profiles</h1>
        <p className="text-sm text-zinc-400">
          Profiles are kept in <span className="text-zinc-200">this browser</span>, not on the
          server. A profile can hold a Lichess account, a Chess.com account, or both — imports from
          either land in the same library, and every other tab follows whoever is active.
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
              value={addDraft.lichess}
              onChange={(e) => setAddDraft((d) => ({ ...d, lichess: e.target.value }))}
              placeholder="e.g. Rooronoa"
              className={FIELD}
            />
          </label>
          <label className="block text-sm">
            <span className="text-zinc-300">Chess.com username</span>
            <input
              value={addDraft.chesscom}
              onChange={(e) => setAddDraft((d) => ({ ...d, chesscom: e.target.value }))}
              placeholder="e.g. Rooronoa_HaD"
              className={FIELD}
            />
          </label>
          <label className="block text-sm">
            <span className="text-zinc-300">Display name (optional)</span>
            <input
              value={addDraft.name}
              onChange={(e) => setAddDraft((d) => ({ ...d, name: e.target.value }))}
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
        <div className="mt-4 border-t border-zinc-800 pt-4">
          <h3 className="mb-2 text-sm font-semibold text-zinc-200">AI analysis providers</h3>
          <p className="mb-3 text-xs text-zinc-400">
            Optional. Stockfish analysis is always available; a provider adds an AI coach when you
            ask for one on the review screen. Keys are saved in this browser with the profile.
          </p>
          <LlmConnections
            idPrefix="add"
            connections={addDraft.llm}
            defaultId={addDraft.defaultLlmId}
            onChange={(llm, defaultLlmId) => setAddDraft((d) => ({ ...d, llm, defaultLlmId }))}
          />
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          Fill in either username, or both. The token is saved with <em>this</em> profile, in this
          browser, and means Lichess imports are not throttled.
        </p>
        <button type="button" onClick={add} disabled={adding} className={`mt-3 ${PRIMARY}`}>
          {adding ? "Adding…" : "Add profile"}
        </button>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            On this browser
          </h2>
          {deploymentTokenSet ? (
            <span className="text-xs text-zinc-400">
              The deployment supplies its own Lichess token as a fallback
            </span>
          ) : null}
        </div>

        {loading ? (
          <p className="py-6 text-center text-sm text-zinc-400">Loading profiles…</p>
        ) : profiles.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-400">
            No profiles in this browser yet — add the first one above.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {profiles.map((p) => {
              const active = p.id === activeId;
              const own = stats[p.id];
              const defaultLlm = p.llm.find((c) => c.id === p.defaultLlmId) ?? p.llm[0] ?? null;

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
                        <span className="text-sm font-semibold text-zinc-100">Editing {profileLabel(p)}</span>
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
                            value={draft.lichess}
                            onChange={(e) => setDraft((d) => ({ ...d, lichess: e.target.value }))}
                            className={FIELD}
                            autoFocus
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="text-zinc-300">Chess.com username</span>
                          <input
                            value={draft.chesscom}
                            onChange={(e) => setDraft((d) => ({ ...d, chesscom: e.target.value }))}
                            className={FIELD}
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="text-zinc-300">Display name</span>
                          <input
                            value={draft.name}
                            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
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
                              p.token
                                ? "A token is saved — leave blank to keep it"
                                : "Paste a personal API token"
                            }
                            className={FIELD}
                          />
                          <TokenHint />
                        </label>
                      </div>
                      <div className="mt-4 border-t border-zinc-800 pt-4">
                        <h4 className="mb-2 text-sm font-semibold text-zinc-200">
                          AI analysis providers
                        </h4>
                        <LlmConnections
                          idPrefix={`edit-${p.id}`}
                          connections={draft.llm}
                          defaultId={draft.defaultLlmId}
                          onChange={(llm, defaultLlmId) =>
                            setDraft((d) => ({ ...d, llm, defaultLlmId }))
                          }
                        />
                      </div>
                      <p className="mt-2 text-xs text-zinc-400">
                        Games are stored against the account, not the profile, so adding a username
                        that already has games brings its analysis back instantly. Removing one only
                        stops this browser listing it.
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
                      </div>
                    </form>
                  </li>
                );
              }

              return (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <div className="min-w-48 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-100">{profileLabel(p)}</span>
                      {active ? (
                        <span className="rounded bg-indigo-950 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-300">
                          you
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-zinc-400">
                      {p.lichess ? <span>Lichess · {p.lichess}</span> : null}
                      {p.chesscom ? <span>Chess.com · {p.chesscom}</span> : null}
                      {!p.lichess && !p.chesscom ? <span>No accounts linked</span> : null}
                      {own ? (
                        <span>
                          {own.games} game{own.games === 1 ? "" : "s"}
                          {own.analyzed ? `, ${own.analyzed} analysed` : ""}
                        </span>
                      ) : null}
                      {p.token ? <span className="text-emerald-400">token saved</span> : null}
                      {defaultLlm ? (
                        <span className="text-indigo-300">
                          AI · {connectionLabel(defaultLlm)}
                          {p.llm.length > 1 ? ` +${p.llm.length - 1}` : ""}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => startEdit(p)}
                    className={`${BTN} border-zinc-700 text-zinc-200 hover:bg-zinc-800`}
                  >
                    Edit
                  </button>
                  {p.token ? (
                    <button
                      type="button"
                      onClick={() => clearToken(p)}
                      className={`${BTN} border-zinc-800 text-zinc-400 hover:border-rose-900 hover:text-rose-300`}
                    >
                      Forget token
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void activate(p)}
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
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-400">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          How this works
        </h2>
        <p>
          A profile is a preference in this browser, not an account. Games are stored against the
          Lichess or Chess.com username they were played under, so the same account set up anywhere
          gets the same games and the same engine analysis — the second browser never re-imports or
          re-analyses anything.
        </p>
        <p className="mt-2">{TOKEN_NOTE}</p>
        <p className="mt-2">
          AI provider keys work the same way. They live in this browser with the profile, and a key
          is sent to the server only inside the one AI request that uses it — the server keeps no
          provider, model or key of its own. Removing a provider here removes it everywhere it
          appears for this profile.
        </p>
      </section>
    </div>
  );
}
