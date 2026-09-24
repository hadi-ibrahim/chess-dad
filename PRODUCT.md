# Chess Dad — product truth

Chess Dad is a chess tutoring web app that turns your own games into coaching.
It imports from Lichess and Chess.com, replays every position through Stockfish,
labels each move, and explains the moments that mattered — then builds personal
puzzles out of your own worst mistakes.

## Who it is for

Originally a single-player, local-first tool: one person, one SQLite file, no
accounts. It is now **multi-profile**. Several people can keep separate
libraries in one deployment, each importing their own accounts and seeing only
their own games, insights, puzzles and opening schedule.

## Identity — deliberately not accounts

There is **no authentication**. A profile is a row; the browser remembers which
one it is acting as in a `cd_profile` cookie, and the server validates that id on
every request, falling back to the first profile. Anyone using the app can add a
profile and search the directory.

This is a **preference, not a boundary**. The app is single-tenant and assumes
the people using it trust each other. It must not be exposed publicly without
real authentication first — that is a known, accepted limitation, not an
oversight.

Lichess tokens are per profile, stored in their own table, and are **write-only
across the API**: `/api/settings` and the profile endpoints report only whether a
token is set, never its value.

## Modes

Operate. Every surface is a tool for a task: review a game, drill a weakness,
practise an opening. The dashboard's job is to say what to work on next.

## What it never does

- Never diagnoses, never claims to cure, never shames after a slip.
- The engine is ground truth; the coach only explains it, and never contradicts it.
- Points and progress only ever move for positive actions.

## Visual world

Dark, near-black chrome (`#09090b`) with restrained indigo accents and a single
warm highlight, editorial restraint, generous whitespace, and real data density
rather than decoration. The mark is a crowned king with a handlebar moustache
and a full beard, on its own black ground.

## Surfaces

| Surface | Mode | Purpose |
| --- | --- | --- |
| Games (`/`) | Operate | Import, browse, filter, triage |
| Review (`/review/[id]`) | Read | Understand one game, move by move |
| Insights (`/insights`) | Read | What to work on next, and what already works |
| Puzzles (`/puzzles`) | Operate | Drill your own mistakes on a spaced-repetition curve |
| Openings (`/openings`) | Operate | Step through and practise a repertoire |
| Profiles (`/profiles`) | Operate | Who is using this, and switch between them |
| Knowledge (`/knowledge`) | Read | The OKF bundle this app reasons from |
