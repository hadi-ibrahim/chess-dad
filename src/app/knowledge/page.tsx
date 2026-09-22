"use client";

import { useEffect, useState } from "react";

interface OkfIndex {
  title: string;
  body: string;
}

export default function Knowledge() {
  const [index, setIndex] = useState<OkfIndex | null>(null);
  const [concepts, setConcepts] = useState<string[]>([]);
  const [entities, setEntities] = useState<string[]>([]);
  const [doc, setDoc] = useState<{ title: string; body: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void fetch("/api/okf")
      .then((r) => r.json())
      .then((d) => {
        setIndex(d.index);
        setConcepts(d.concepts || []);
        setEntities(d.entities || []);
      });
  }, []);

  async function openDoc(path: string) {
    setLoading(true);
    const res = await fetch(`/api/okf?path=${encodeURIComponent(path)}`);
    const d = await res.json();
    setDoc(d.body != null ? d : { title: path, body: "Document not found." });
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Knowledge base</h1>
        <p className="text-sm text-zinc-400">
          ChessMentor&apos;s coaching knowledge is stored as an{" "}
          <a
            href="https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md"
            target="_blank"
            rel="noreferrer"
            className="text-indigo-400 hover:underline"
          >
            Open Knowledge Format (OKF)
          </a>{" "}
          bundle — markdown + YAML frontmatter, agent-readable and git-diffable.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Concepts</h2>
            <div className="space-y-1">
              {concepts.map((c) => (
                <button key={c} onClick={() => openDoc(c)} className="block w-full rounded px-2 py-1 text-left text-sm text-zinc-300 hover:bg-zinc-800">
                  {c.replace("concepts/", "").replace(".md", "")}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Entities</h2>
            <div className="space-y-1">
              {entities.map((c) => (
                <button key={c} onClick={() => openDoc(c)} className="block w-full rounded px-2 py-1 text-left text-sm text-zinc-300 hover:bg-zinc-800">
                  {c.replace("entities/", "").replace(".md", "")}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          {doc ? (
            <div>
              <h2 className="mb-3 text-lg font-bold">{doc.title}</h2>
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-300">{doc.body}</pre>
            </div>
          ) : (
            <div>
              <h2 className="mb-3 text-lg font-bold">{index?.title ?? "ChessMentor Knowledge"}</h2>
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-300">{index?.body ?? "Loading…"}</pre>
            </div>
          )}
          {loading && <p className="mt-2 text-xs text-zinc-500">Loading…</p>}
        </div>
      </div>
    </div>
  );
}
