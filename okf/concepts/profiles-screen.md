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
