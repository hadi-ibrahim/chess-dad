"use client";

import { useState } from "react";
import {
  PROVIDERS,
  connectionLabel,
  emptyConnection,
  providerMeta,
  type LlmConnection,
  type ProviderId,
} from "@/lib/llm-providers";

/**
 * The AI-provider editor, shared by "Add a profile" and the inline profile edit
 * on the Profiles screen.
 *
 * Nothing here is ever sent to the server on save: the whole list, keys included,
 * goes into `localStorage` with the profile. A key is passed to the server only
 * inside one AI request, and only because that request is what talks to the
 * provider.
 *
 * Edit follows the Lichess-token convention: a saved key is never rendered back
 * into the DOM. Leaving the field blank keeps it, and replacing it takes a typed
 * value — so a shoulder or a screenshot cannot lift a key off this screen.
 */

const FIELD =
  "mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-zinc-100 placeholder:text-zinc-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400";
const BTN =
  "min-h-9 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400";
const PRIMARY =
  "min-h-9 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400";

function KeyHint({ provider }: { provider: ProviderId }) {
  const meta = providerMeta(provider);
  if (!meta) return null;
  return (
    <span className="mt-1 block text-xs text-zinc-400">
      {meta.keyUrl ? (
        <>
          Create one at{" "}
          <a
            href={meta.keyUrl}
            target="_blank"
            rel="noreferrer"
            className="text-indigo-400 hover:underline"
          >
            {meta.keyUrl.replace(/^https?:\/\//, "")}
          </a>
          . {meta.note}
        </>
      ) : (
        meta.note
      )}
    </span>
  );
}

export default function LlmConnections({
  connections,
  defaultId,
  onChange,
  idPrefix,
}: {
  connections: LlmConnection[];
  defaultId: string;
  onChange: (connections: LlmConnection[], defaultId: string) => void;
  idPrefix: string;
}) {
  const [draft, setDraft] = useState<LlmConnection | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const meta = draft ? providerMeta(draft.provider) : null;
  // A saved key belongs to the provider it was entered for, so switching provider
  // in the edit form must not silently reuse another provider's key.
  const editing = editingId ? connections.find((c) => c.id === editingId) ?? null : null;
  const savedKey = editing && draft && editing.provider === draft.provider ? editing.apiKey : "";
  const hasSavedKey = Boolean(savedKey);

  function startAdd() {
    setDraft(emptyConnection());
    setEditingId(null);
    setError(null);
  }

  function startEdit(c: LlmConnection) {
    // A blank apiKey in the draft means "keep the saved one"; commit fills it back.
    setDraft({ ...c, apiKey: "" });
    setEditingId(c.id);
    setError(null);
  }

  function changeProvider(provider: ProviderId) {
    const next = providerMeta(provider);
    if (!next || !draft) return;
    setDraft({
      ...draft,
      provider,
      model: next.defaultModel,
      baseUrl: "",
      thinking: false,
    });
  }

  function commit() {
    if (!draft || !meta) return;
    const model = draft.model.trim() || meta.defaultModel;
    if (!model) {
      setError(`${meta.label} needs a model name.`);
      return;
    }
    const apiKey = draft.apiKey.trim() || (editingId ? savedKey : "");
    if (meta.keyRequired && !apiKey) {
      setError(`${meta.label} needs an API key.`);
      return;
    }
    const baseUrl = draft.baseUrl.trim() || meta.defaultBaseUrl || "";
    if (meta.baseUrlRequired && !draft.baseUrl.trim()) {
      setError(`${meta.label} needs a base URL, for example https://openrouter.ai/api/v1.`);
      return;
    }

    const connection: LlmConnection = {
      ...draft,
      label: draft.label.trim(),
      model,
      apiKey,
      baseUrl,
    };
    const next = editingId
      ? connections.map((c) => (c.id === editingId ? connection : c))
      : [...connections, connection];
    // First connection (or a removed default) becomes the default.
    const nextDefault =
      defaultId && next.some((c) => c.id === defaultId) ? defaultId : next[0]?.id ?? "";
    onChange(next, nextDefault);
    setDraft(null);
    setEditingId(null);
    setError(null);
  }

  function remove(id: string) {
    const next = connections.filter((c) => c.id !== id);
    onChange(next, defaultId === id ? next[0]?.id ?? "" : defaultId);
    if (editingId === id) {
      setDraft(null);
      setEditingId(null);
    }
  }

  return (
    <div className="space-y-3">
      {connections.length === 0 ? (
        <p className="text-sm text-zinc-400">
          No AI provider yet. Stockfish analysis works without one — add a provider when you want
          an AI coach to go deeper.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
          {connections.map((c) => {
            const isDefault = c.id === defaultId;
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                <div className="min-w-40 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-100">{connectionLabel(c)}</span>
                    {isDefault ? (
                      <span className="rounded bg-indigo-950 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-300">
                        default
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    {providerMeta(c.provider)?.label ?? c.provider}
                    {c.apiKey ? " · key saved" : c.provider === "ollama" ? " · no key" : " · no key saved"}
                    {c.thinking ? " · reasoning on" : ""}
                  </p>
                </div>
                {!isDefault ? (
                  <button
                    type="button"
                    onClick={() =>
                      onChange(connections, c.id)
                    }
                    className={`${BTN} border-zinc-700 text-zinc-200 hover:bg-zinc-800`}
                  >
                    Make default
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => startEdit(c)}
                  className={`${BTN} border-zinc-700 text-zinc-200 hover:bg-zinc-800`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  className={`${BTN} border-zinc-800 text-zinc-400 hover:border-rose-900 hover:text-rose-300`}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {draft && meta ? (
        <div className="rounded-lg border border-zinc-700 bg-zinc-950/60 p-3">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-100">
              {editingId ? "Edit provider" : "Add a provider"}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-zinc-300">Provider</span>
              <select
                value={draft.provider}
                onChange={(e) => changeProvider(e.target.value as ProviderId)}
                className={FIELD}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-zinc-300">
                Name <span className="text-zinc-400">(optional)</span>
              </span>
              <input
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder={meta.short}
                className={FIELD}
              />
            </label>
            <label className="block text-sm">
              <span className="text-zinc-300">Model</span>
              <input
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                placeholder={meta.defaultModel || "model id"}
                list={`${idPrefix}-models`}
                className={FIELD}
                spellCheck={false}
                autoComplete="off"
              />
              <datalist id={`${idPrefix}-models`}>
                {meta.models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <span className="mt-1 block text-xs text-zinc-400">
                Any model id the provider offers — the suggestions are only a starting point.
              </span>
            </label>
            <label className="block text-sm">
              <span className="text-zinc-300">API key</span>
              <input
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  hasSavedKey
                    ? "A key is saved — leave blank to keep it"
                    : meta.keyRequired
                      ? "Paste your API key"
                      : "Not needed for this provider"
                }
                className={FIELD}
              />
              <KeyHint provider={draft.provider} />
            </label>
            {meta.baseUrlRequired || draft.provider === "ollama" ? (
              <label className="block text-sm sm:col-span-2">
                <span className="text-zinc-300">Base URL</span>
                <input
                  value={draft.baseUrl}
                  onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                  placeholder={meta.defaultBaseUrl ?? "https://example.com/v1"}
                  className={FIELD}
                  spellCheck={false}
                  autoComplete="off"
                />
                <span className="mt-1 block text-xs text-zinc-400">
                  Include the version prefix. http:// is only accepted for a local address.
                </span>
              </label>
            ) : null}
            {meta.supportsThinkingToggle ? (
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={draft.thinking}
                  onChange={(e) => setDraft({ ...draft, thinking: e.target.checked })}
                  className="mt-1"
                />
                <span className="text-zinc-300">
                  Allow reasoning mode
                  <span className="mt-0.5 block text-xs text-zinc-400">
                    Off by default. Reasoning tokens are billed as output and can take minutes; the
                    engine has already done the thinking.
                  </span>
                </span>
              </label>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="mt-2 text-sm text-rose-300">
              {error}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={commit} className={PRIMARY}>
              {editingId ? "Save provider" : "Add provider"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setEditingId(null);
                setError(null);
              }}
              className={`${BTN} border-zinc-700 text-zinc-200 hover:bg-zinc-800`}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={startAdd} className={`${BTN} border-zinc-700 text-zinc-200 hover:bg-zinc-800`}>
          Add a provider
        </button>
      )}
    </div>
  );
}
