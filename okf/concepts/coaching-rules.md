---
type: Playbook
title: Coaching Rules
description: How Chess Dad turns engine analysis into tier-appropriate, plain-language coaching that never contradicts the engine.
tags: [coaching, engine, llm, explanation]
status: stable
generated: { by: chessdad/1.0, at: 2026-09-22 }
updated: { by: "process:ai-providers", at: 2026-09-25 }
sources:
  - id: engine-first
    resource: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
    title: OKF specification (referenced for knowledge formatting, not coaching content)
  - id: llm-code
    resource: src/lib/llm.ts
    title: Chess Dad — explainPosition() and the deterministic fallback
  - id: okf-reader-code
    resource: src/lib/okf.ts
    title: Chess Dad — readCoachingRules() reader for these sections
---

# Overview

Chess Dad follows one invariant: **the engine is ground truth, the coach only
explains it.** The LLM never evaluates a position; it receives the engine's
best move and evaluation and is instructed never to contradict them.[^engine-first]
This prevents hallucinated chess facts while keeping explanations human and
level-calibrated.

# Structure of an explanation

Every coaching explanation has three parts:

* `explanation` — 2–3 sentences on *why* the move was suboptimal, in plain language.
* `key_lesson` — the transferable idea the player should take away.
* `drill_suggestion` — a concrete exercise to internalize the lesson.

# Deterministic fallback

The app always generates this explanation from the rules below, using the engine
data and the motif tag — it is the default, not a degradation. No AI provider is
involved, no key is needed, and it cannot fail. The sections below are the
fallback lessons the app reads back for blunder, mistake, miss, inaccuracy, and
good; the `explanation` itself is assembled from the verdict verb, the engine's
preferred move, the evaluation change, the direction of the game, and the motif
phrase.

Two rules keep that assembly readable:

* **Mate scores are sentinels, not numbers.** The engine stores a forced mate as
  ±100000 centipawns, so any value at or beyond ±10000 is described as *a forced
  mate* ("This let a forced mate slip."). An earlier version printed
  "+999.98 to +999.98 (a 0.0-pawn swing)", which appeared in 224 stored
  explanations.
* **The direction of the game is stated.** If the player was better before the
  move the explanation says so; if they were already worse it says the practical
  aim was to hold. The lesson therefore never contradicts the evaluation printed
  on the same card.

Motif tags are detector keys, so each is mapped to a noun phrase (`tactical` → "a
tactical opportunity", `hung-piece` → "a hung piece") and to an article-free topic
for drill text ("Solve 10 hung piece puzzles").

The template is computed fresh on every analysis — it is pure and offline, so
there is nothing to cache. Changing it therefore affects any game re-analysed
afterwards; the engine evaluations come from `engine_cache`, so a re-run costs no
Stockfish time.

# AI readings

An AI provider can add a second reading of a position, on the user's request. It
is stored separately in `ai_explanations` and never overwrites the deterministic
text above. The prompt is the same engine data (FEN, played move, engine best
move, evaluations, classification, motif, opening, and the mover's rating), with
the same accuracy rules. What differs is the transport: the provider, model and
API key come from the user's browser profile rather than the environment, and the
key is used only for the request that carries it. See
[AI providers](ai-providers.md) for the provider list, the cache key, and the
failure modes. The illegal-move guard below applies to both.

## Move classification: blunder

You gave away a decisive amount of material or position (over three pawns).
Slow down: before moving, check whether your piece or a key square is
undefended, and whether the opponent has a forcing reply.

## Move classification: mistake

Your move gave up real value (one to three pawns). Most often the missed idea
was a defensive resource or a forcing reply. Check the opponent's threats and your
own candidate moves before committing, and when you are on top, convert calmly
rather than forcing matters.

## Move classification: miss

You had a winning chance — a forced mate or a clearly winning position (at least
+2.00) — and let it slip. Train yourself to spot forcing moves (checks, captures,
threats) first.

## Move classification: inaccuracy

Your move was playable but imprecise (half a pawn to a pawn). Tighten your move
selection by comparing candidate moves against the opponent's best reply.

## Move classification: good

A solid move, close to best. Keep building: consistency here is what separates
steady improvers from streaky players.

[^engine-first]: The engine-first rule is a Chess Dad design invariant, not a
  claim sourced from the OKF specification; the source is recorded to honor the
  provenance convention.
