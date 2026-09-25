---
okf_version: "0.2"
---

# Chess Dad Knowledge Bundle

The knowledge behind Chess Dad — an open-source chess tutoring web app —
represented as an Open Knowledge Format (OKF v0.2) bundle. It stores the
coaching rules, move-classification thresholds, weakness definitions, tactical
motif taxonomy, accuracy metric, spaced-repetition policy, opening theory notes,
and an account of the per-profile [AI providers](concepts/ai-providers.md) the app
can call, all used to turn engine output into plain-language coaching.

The app both *reads* this bundle (the deterministic coaching fallback grounds
its explanations in [coaching-rules](concepts/coaching-rules.md)) and *writes*
to it (per-account progress is regenerated under [progress](progress/) after
analysis).

## Concepts

* [Concepts](concepts/) — coaching rules, [AI providers](concepts/ai-providers.md), move classification, weakness definitions, tactical motifs, accuracy, spaced repetition, game import, the games browser, [the review screen](concepts/review-screen.md), [the puzzles screen](concepts/puzzles-screen.md), [the openings screen](concepts/openings-screen.md), [the profiles screen](concepts/profiles-screen.md), persistence, and the job queue.

## Entities

* [Entities](entities/) — opening theory notes and tactical motif definitions.

## References

* [Open Knowledge Format specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) — the vendor-neutral spec this bundle conforms to.
