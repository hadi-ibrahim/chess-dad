---
type: Reference
title: Profiles Screen
description: How Chess Dad keeps a person's chess theirs without accounts — profiles live in the browser, games are filed by account, and the server remembers nobody.
tags: [profiles, identity, multi-user, scoping, privacy]
status: stable
generated: { by: chessdad/1.0, at: 2026-09-24 }
updated: { by: "process:ai-providers", at: 2026-09-25 }
sources:
  - id: profiles-page
    resource: src/app/profiles/page.tsx
    title: Chess Dad — browser-local profiles screen
  - id: client-profiles
    resource: src/lib/client-profiles.ts
    title: Chess Dad — localStorage profile store
  - id: profile-cookie
    resource: src/lib/profile-cookie.ts
    title: Chess Dad — the cd_profile cookie codec
  - id: identity-code
    resource: src/lib/identity.ts
    title: Chess Dad — identityOf() and scopesOf()
  - id: library-code
    resource: src/lib/library.ts
    title: Chess Dad — viewerOf() and the account-to-game sync
---

# Overview

Chess Dad is **multi-profile without accounts and without a user table**. A
profile is a small object the browser owns:

```json
{ "id": "…", "name": "Hadi", "lichess": "Rooronoa", "chesscom": "Rooronoa_HaD" }
```

The list lives in `localStorage`; the acting one rides a `cd_profile` cookie as
base64url JSON, which the server reads on every request. Nothing about a person
is ever written to SQLite — so publishing the app cannot expose who uses it, and
one visitor's setup cannot disturb another's.

# What is local and what is shared

| Thing | Where it lives | Shared? |
|-------|----------------|---------|
| The profile itself (name, accounts, which is active) | This browser | No |
| The Lichess token | This browser, with the profile | No — posted per import |
| AI provider connections, including API keys | This browser, with the profile | No — posted per AI request |
| Games, positions, engine and coach explanations | `games` / `positions` / the FEN-keyed caches | Yes, globally |
| AI readings of a position | `ai_explanations`, keyed by position + provider + model | Yes, globally |
| Which games are *yours*, and your colour | `library`, keyed by account | Per account |
| Puzzle and opening schedules | `puzzle_reviews` / `opening_reviews`, keyed by account | Per account |

The library key is the **account** (`lichess:rooronoa`), not the profile. That one
choice is what makes the important case work: setting up the same account in a
second browser produces the same key, so the games and their analysis are already
there.

# Creating a profile

Profiles are added only on this screen, and only in this browser. Either username
is enough — a profile can hold a Lichess account, a Chess.com account, or both,
and the two accounts feed one library. Nothing auto-creates a profile, and a
browser with none shows a "no profile is active" state on the Games tab that
leads back here.

Adding or switching a profile also asks the server to **link** the accounts: every
game already stored that those names appear in is attached immediately. That is
why a second browser starts with its whole history and nothing to import.

# Choosing a profile

Switching writes the cookie and nothing else. `identityOf()` reads it back and
`scopesOf()` turns the accounts into library keys; every viewer-scoped query is
built from those. It is a **preference, not an access-control boundary** — anyone
can write a different cookie and see a different account's library, which amounts
to the same information the games themselves already publish. It is not a
security claim, and the app does not pretend it is one.

# Importing

The Games tab shows the acting profile, a **Games per account** selector, and one
**Import games** / **Re-import games** button. It posts no usernames: the route
resolves the accounts from the cookie and refuses with 409 when there is nobody to
import for. An import that finds a game already stored links it and keeps the
existing analysis, so an account that is already known costs no engine time at all.

The selector sets `max` on that request — the *most recent* N games, **per
account** (so with both Lichess and Chess.com configured, "10" means up to ten from
each). The server clamps it to 1..200 and otherwise falls back to
`MAX_GAMES_PER_SOURCE`. Being able to ask for a handful is what makes the app
cheap to try, and what lets a new profile be set up without pulling and analysing a
hundred games; the choice is remembered in `localStorage` under `cd_import_max`,
because having it reset on every visit was the annoying part.

# Editing

Any profile can be edited in place, over the same fields as creation. Games are
**not** re-attributed by an edit, because they were never attributed to a profile
in the first place: they belong to the account. Changing a username only changes
which accounts this browser reads from.

Removing a profile removes it from this browser and stops listing its games. The
games and their analysis stay on the server, and adding the same account again
brings them straight back — the UI says so rather than warning about data loss.

# Tokens

The Lichess token is **part of the profile and never leaves the browser.** It is
saved in `localStorage` beside the name and accounts, sent in the body of the one
import request that needs it, and used there for a single `Authorization` header.
The server stores nothing — no table, no session map, no cookie — so a restart or
redeploy does not lose it and a compromised deployment has nothing to hand over.
`encodeProfile` whitelists the four profile fields, so the token cannot ride along
in the `cd_profile` cookie by accident.

Because the field cannot be prefilled, both forms link out to
<https://lichess.org/account/oauth/token> and state that **no scopes are
required** to read public games. A profile can hold a token per account, and
"Forget token" on its row clears just that one.

An operator can still set `LICHESS_TOKEN` for a headless install; that belongs to
the deployment, not to a user, and only shows up as `deploymentTokenSet`.

# AI providers

The same form holds a profile's **AI provider connections**, and they are edited
with the shared `LlmConnections` component in both "Add a profile" and the inline
edit. Each connection is a provider, an optional name, a model, an API key, an
optional base URL, and — for DeepSeek — a reasoning toggle that is off unless
explicitly enabled. The model field is free text **and** a picker: **Load models**
fetches what the key can actually reach and shows it as a filterable list, while
the static suggestions appear as quick picks until then. See
[AI providers](ai-providers.md).

A connection's key is **never rendered back into the DOM**: editing shows a blank
field that means "keep the saved key", and replacing it takes a typed value. This
is the same convention as the Lichess token, for the same reason.

The list also selects a **default** connection, which the review screen
preselects. A profile row shows the default provider and how many others exist.
Provider and model metadata (labels, suggested models, where to get a key, which
base URLs are allowed) lives in `src/lib/llm-providers.ts`, which is deliberately
importable from both the browser and the server so the two can never disagree
about what a connection is. See [AI providers](ai-providers.md).

# Known limits

* **Not an auth boundary.** See above; a cookie names the library, it does not
  guard it.
* **Profiles are per browser.** Clearing site data forgets them, token included.
  That is the trade for having nothing to leak, and re-adding an account costs one
  form.
* **A throttled anonymous import holds its request open** while it waits out a
  rate-limit window. A saved token raises the limits and avoids it.
* **Deduplication is global**, not per person: two players who reach the same
  position share one drill, and each keeps their own practice schedule for it.
