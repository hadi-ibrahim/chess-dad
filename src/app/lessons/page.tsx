"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import LessonPuzzleView from "@/components/LessonPuzzle";
import { LESSONS, lessonsByGroup } from "@/lib/lessons";

const STORAGE_KEY = "cd_lessons_done";

/**
 * A beginner's introduction to chess: short lessons, one idea each, with a tiny
 * puzzle to try. This replaces the old knowledge-base screen, which showed the
 * raw OKF bundle — useful to a developer, meaningless to a new player.
 *
 * Progress is kept in the browser (same local-first rule as profiles): there is
 * no account and nothing is sent to the server.
 */
export default function Lessons() {
  const [activeId, setActiveId] = useState(LESSONS[0].id);
  const [done, setDone] = useState<string[]>([]);

  useEffect(() => {
    // Saved progress and the deep link both live outside React, so they are read
    // once after mount rather than during render (which would break static
    // prerendering).
    /* eslint-disable react-hooks/set-state-in-effect -- reading browser-only state after mount */
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) setDone(parsed.filter((id): id is string => typeof id === "string"));
    } catch {
      // A corrupt or unavailable store just means no progress shown.
    }
    // Deep link: /lessons?lesson=castling
    const wanted = new URLSearchParams(window.location.search).get("lesson");
    if (wanted && LESSONS.some((l) => l.id === wanted)) setActiveId(wanted);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const markDone = useCallback((id: string) => {
    setDone((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Progress is a nicety; failing to save it must not break the lesson.
      }
      return next;
    });
  }, []);

  function goTo(id: string) {
    setActiveId(id);
    // Keep the URL shareable without a navigation, so the page never re-renders
    // through the router and the board keeps its place.
    window.history.replaceState(null, "", `/lessons?lesson=${encodeURIComponent(id)}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const lesson = LESSONS.find((l) => l.id === activeId) ?? LESSONS[0];
  const index = LESSONS.findIndex((l) => l.id === lesson.id);
  const prev = index > 0 ? LESSONS[index - 1] : null;
  const next = index < LESSONS.length - 1 ? LESSONS[index + 1] : null;
  const isDone = done.includes(lesson.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Learn the basics</h1>
        <p className="text-sm text-zinc-400">
          Short lessons on the things that confuse every new player — the notation, the special
          moves, the engine — each with one small puzzle. {done.length} of {LESSONS.length} done.
        </p>
        <div
          className="mt-2 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-zinc-800"
          role="progressbar"
          aria-valuenow={done.length}
          aria-valuemin={0}
          aria-valuemax={LESSONS.length}
          aria-label="Lessons completed"
        >
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${(done.length / LESSONS.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
        {/* On narrow screens the list scrolls sideways rather than pushing the lesson down. */}
        <nav aria-label="Lessons" className="lg:sticky lg:top-4 lg:self-start">
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 lg:mx-0 lg:block lg:space-y-3 lg:overflow-visible lg:px-0 lg:pb-0">
            {lessonsByGroup().map(({ group, lessons }) => (
              <div key={group} className="shrink-0 lg:shrink">
                <h2 className="mb-1 hidden text-xs font-semibold uppercase tracking-wider text-zinc-500 lg:block">
                  {group}
                </h2>
                <div className="flex gap-1 lg:block lg:space-y-0.5">
                  {lessons.map((l) => {
                    const active = l.id === lesson.id;
                    const complete = done.includes(l.id);
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => goTo(l.id)}
                        aria-current={active ? "true" : undefined}
                        className={`flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 lg:w-full lg:whitespace-normal ${
                          active
                            ? "bg-indigo-600 text-white"
                            : "text-zinc-300 hover:bg-zinc-800 hover:text-white"
                        }`}
                      >
                        <span
                          aria-hidden
                          className={`shrink-0 text-xs ${complete ? "text-emerald-400" : "opacity-50"}`}
                        >
                          {complete ? "✓" : "○"}
                        </span>
                        <span className="lg:flex-1">{l.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        <article className="min-w-0 space-y-5">
          <header>
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
              {lesson.group} · lesson {index + 1} of {LESSONS.length}
            </p>
            <h2 className="mt-1 text-xl font-bold text-zinc-100">{lesson.title}</h2>
            <p className="mt-1 text-sm text-zinc-400">{lesson.summary}</p>
          </header>

          <div className="space-y-3">
            {lesson.body.map((paragraph) => (
              <p key={paragraph} className="text-sm leading-relaxed text-zinc-300">
                {paragraph}
              </p>
            ))}
          </div>

          {lesson.terms ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Worth remembering
              </h3>
              <dl className="space-y-1.5">
                {lesson.terms.map((t) => (
                  <div key={t.term} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                    <dt className="shrink-0 font-mono text-sm text-zinc-100 sm:w-40">{t.term}</dt>
                    <dd className="text-sm text-zinc-400">{t.def}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-zinc-100">Try it</h3>
              {isDone ? (
                <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
                  done
                </span>
              ) : null}
            </div>
            <LessonPuzzleView
              lessonId={lesson.id}
              puzzle={lesson.puzzle}
              onDone={() => markDone(lesson.id)}
            />
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => prev && goTo(prev.id)}
              disabled={!prev}
              className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-40"
            >
              ← {prev ? prev.title : "Previous"}
            </button>
            <button
              type="button"
              onClick={() => next && goTo(next.id)}
              disabled={!next}
              className="ml-auto min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:opacity-40"
            >
              {next ? next.title : "That's everything"} →
            </button>
          </div>

          <p className="text-xs text-zinc-500">
            Once these make sense, your own games become the next lesson: analyse one on the{" "}
            <Link href="/" className="underline hover:text-zinc-300">
              Games
            </Link>{" "}
            tab and the review will point out where these ideas came up.
          </p>
        </article>
      </div>
    </div>
  );
}
