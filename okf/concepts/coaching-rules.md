---
type: Playbook
title: Coaching Rules
description: How ChessMentor turns engine analysis into tier-appropriate, plain-language coaching that never contradicts the engine.
tags: [coaching, engine, llm, explanation]
status: stable
generated: { by: chessmentor/1.0, at: 2026-09-22 }
updated: { by: "process:okf-code-sync", at: 2026-09-23 }
sources:
  - id: engine-first
    resource: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
    title: OKF specification (referenced for knowledge formatting, not coaching content)
  - id: llm-code
    resource: src/lib/llm.ts
    title: ChessMentor — explainPosition() and the deterministic fallback
  - id: okf-reader-code
    resource: src/lib/okf.ts
    title: ChessMentor — readCoachingRules() reader for these sections
---

# Overview

ChessMentor follows one invariant: **the engine is ground truth, the coach only
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

When no LLM is configured (or an LLM call fails), the app generates an
explanation from these rules using the engine data and the motif tag. The
sections below are the fallback lessons the app reads back for blunder, mistake,
miss, inaccuracy, and good; the `explanation` itself is assembled from the
engine's evaluation and best move.

## Move classification: blunder

You gave away a decisive amount of material or position (over three pawns).
Slow down: before moving, check whether your piece or a key square is
undefended, and whether the opponent has a forcing reply.

## Move classification: mistake

You lost a meaningful advantage (one to three pawns). The idea you missed was
tactical or positional rather than forced; look for the opponent's threats and
your own candidate moves before committing.

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

[^engine-first]: The engine-first rule is a ChessMentor design invariant, not a
  claim sourced from the OKF specification; the source is recorded to honor the
  provenance convention.
