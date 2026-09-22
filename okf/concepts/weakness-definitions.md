---
type: Reference
title: Weakness Definitions
description: The recurring-mistake categories ChessMentor profiles across a player's games.
tags: [weakness, profiling, insights, improvement]
status: stable
generated: { by: chessmentor/1.0, at: 2026-09-22 }
---

# Overview

ChessMentor's value is **pattern over incident**: one blunder is noise, but the
same mistake across fifty games is a weakness worth training. Each weakness is a
category aggregated over every analyzed game.

# Weakness categories

* **Tactical motifs missed** — forks, pins, skewers, discovered attacks,
  back-rank mates, and hanging pieces, detected in positions with large
  centipawn loss.
* **Phase-specific weakness** — whether mistakes cluster in the opening,
  middlegame, or endgame.
* **Time management** — the correlation between low clock time and error rate.
* **Opening performance** — win/draw/loss and accuracy by ECO code.
* **Color-specific** — performance as White versus Black.

# How it is used

The [insights dashboard](../../app/insights) surfaces these categories as a
weakness heatmap, an accuracy trend, and an opening-performance table. Each
critical mistake is also turned into a personal [puzzle](entities/) tagged with
its motif.
