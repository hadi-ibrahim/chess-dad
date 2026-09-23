---
type: Reference
title: Games Browser
description: How the game library is searched, filtered, and paginated, and what each filter means.
tags: [games, search, filters, pagination, ui]
status: stable
generated: { by: chessdad/1.0, at: 2026-09-22 }
updated: { by: "process:okf-code-sync", at: 2026-09-23 }
sources:
  - id: games-query-code
    resource: src/lib/db.ts
    title: Chess Dad — queryGames() search, filters, and paging
---

# Overview

The library is queried **server-side**, so it stays fast as a history grows into
the thousands: filters, sorting and paging are applied in SQLite and only one
page of rows is ever sent to the browser.

# Search

One free-text box matches case-insensitively, as a substring, against both
players, the opponent, the opening name, and the ECO code — so `najdorf`,
`B90`, or an opponent's name all work.

# Filters

| Filter | Values | Notes |
|--------|--------|-------|
| Site | `lichess`, `chesscom` | which site the game came from |
| Speed | `bullet`, `blitz`, `rapid`, `classical` | as the site reported it |
| Result | `win`, `loss`, `draw` | **from the player's perspective** |
| Colour | `w`, `b` | the colour the player had |
| Analysed | yes / no | whether engine analysis has run |
| Date range | from / to | inclusive bounds on the game date |

`result` is the field worth care: `games.result` stores the *board* result
(`1-0`, `0-1`, `1/2-1/2`), so a "win" filter has to account for which colour the
player had — a Black win is `0-1`. Date bounds given as plain dates are widened
to the whole day before comparison.

# Pagination

Queries take `page` and `pageSize` (the server clamps it to 1–200; the UI offers
25, 50, 100, or 200, default 50) and return that page plus `total`, `analyzed`,
and `pageCount`. An out-of-range page is clamped to the last page rather than
returning nothing, so a stale link still shows results.

# What each row says

The listing joins each game with its own analysis signal: the number of flagged
moves (mistake + blunder + miss) by the player, the count of blunders, and the
costliest of them — its ply, SAN, clamped centipawn loss (mate scores count as
1000 cp) and motif. The result is rendered as Won/Lost/Drew rather than raw PGN,
the ECO code links into the [opening trainer](openings-screen.md), and the
turning point links into the [review screen](review-screen.md) at that ply
(`/review/<id>?ply=<n>`).

# View state lives in the URL

Filters, page and page size are mirrored into the query string and hydrated from
it on mount, so a filtered set survives a trip into a review, a reload, or being
shared. `/?speed=blitz&result=win&page=2` is a valid entry point.

# Two layouts, two pagers

Above `sm` the library is a table. Below it, nine columns cannot fit — Actions was
the first thing cut, so a phone could not reach Review at all — and each game
becomes a card whose primary action is a full-width **Review**, with its result,
opening, accuracy, flagged count and turning point beside it.

The pager is rendered twice: under the count line at the top of the list and again
after the last row. With 50 rows per page the footer alone sat roughly ten
thousand pixels down a phone screen, which made page two unreachable.
