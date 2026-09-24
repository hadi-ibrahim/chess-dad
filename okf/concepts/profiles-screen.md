---
type: Reference
title: Profiles Screen
description: How Chess Dad keeps several people's games apart without accounts, and how a browser picks the profile it is acting as.
tags: [profiles, identity, multi-user, scoping]
status: stable
generated: { by: chessdad/1.0, at: 2026-09-24 }
sources:
  - id: profiles-page
    resource: src/app/profiles/page.tsx
    title: Chess Dad — profiles directory
  - id: active-profile
    resource: src/lib/active-profile.ts
    title: Chess Dad — activeProfileId() cookie resolution
  - id: profiles-api
    resource: src/app/api/profiles/route.ts
    title: Chess Dad — profile directory and create
---

# Overview

Chess Dad holds **several people's libraries in one database**. The
[profiles screen](../../src/app/profiles/page.tsx) is the directory: it lists
everyone, adds a new person, searches usernames, and switches who the app is
acting as.

# Creating a profile

Profiles are added **only here**. The Games tab has no username, token or options
form — importing is one button and it always acts for whoever is active, reading
that profile's linked accounts and stored token server-side.

Nothing auto-creates a profile. An empty database therefore has none, and the
Games tab shows a "no profile is active" state that leads back to this screen.
Deleting every profile returns the app to that state.

# Choosing a profile

There are **no accounts**. The browser stores a profile id in a `cd_profile`
cookie; `activeProfileId()` in `src/lib/active-profile.ts` validates it against
the database on every request and falls back to the lowest-numbered profile when
the cookie is missing, stale or not a number. Switching is a single click and
takes effect immediately, because every scoped query reads the same cookie.

It is a **preference, not an access-control boundary**. Anyone using the app can
add a profile, search the directory, and see any profile's library by switching
to it. The app is single-tenant and assumes its users trust each other; it should
not be exposed publicly without adding real authentication first.

# Importing

The Games tab shows the acting profile and a single **Import games** /
**Re-import games** button — the label follows whether that profile already has
games. It posts to `/api/import` with no body; the route resolves the acting
profile, and refuses with 409 when none is active rather than silently creating
one. Explicit usernames are still accepted by the API for scripted use, and only
then does an import update the profile's accounts.

# One profile, both accounts

A profile holds a Lichess username, a Chess.com username, or both — they are two
columns on the same row, and an import queues a job per linked account against
the same `profileId`, so games from either source land in one library. An import
is skipped only if that account is already queued for that profile.

# Editing

Any profile can be edited in place, not just selected or deleted. The row opens
an inline form — no modal, since this needs neither interruption nor protected
focus — over the same fields as creation. Saving sends a `PATCH` with only the
fields that changed.

Token handling is deliberately asymmetric, because a token is never sent back to
the browser and so cannot be prefilled:

* the token field starts **blank**, and a blank field is **omitted** from the
  request, so renaming a profile cannot wipe its token;
* typing a value **replaces** it;
* removing it needs the explicit **Remove saved token** action, which is the only
  path that sends an empty string and so the only path that clears it.

Changing a username does **not** re-attribute existing games: they keep the
`profile_id` they were imported under. Editing is about the account, not the
history.

# What a profile owns

* Its **games**, and through them its positions and puzzles.
* Its **opening review schedule**.
* Its **Lichess token**.

Every read path is scoped: the [games browser](games-browser.md),
[insights](weakness-definitions.md), [puzzles screen](puzzles-screen.md) and
[openings screen](openings-screen.md) all resolve the acting profile first. An
import job carries its `profileId` in the payload, so a fetch that outlives the
request still writes to the right library.

# Tokens

A token is stored in `profile_secrets` — deliberately not on the `profiles` row,
so a listing endpoint cannot serialise it by accident — and is **write-only
across the API**. Both `/api/settings` and the profile endpoints report only
`lichessTokenSet`, never the value.

# Known limits

* **Not an auth boundary.** See above; the accepted consequence of having no
  accounts.
* **Deleting a profile deletes its games, positions, puzzles, review schedule and
  token.** The API requires an explicit `DELETE` per profile and the UI confirms
  first, but there is no undo.
* **Puzzle deduplication is per profile**, so two profiles can hold a puzzle for
  the same position. That is intended: they are different people's drills.
