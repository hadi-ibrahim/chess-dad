---
okf_version: "0.2"
---

# ChessMentor Knowledge Bundle

The knowledge behind ChessMentor — an open-source chess tutoring web app —
represented as an Open Knowledge Format (OKF v0.2) bundle. It stores the
coaching rules, move-classification thresholds, weakness definitions, tactical
motif taxonomy, accuracy metric, spaced-repetition policy, and opening theory
notes the app uses to turn engine output into plain-language coaching.

The app both *reads* this bundle (the deterministic coaching fallback grounds
its explanations in [coaching-rules](concepts/coaching-rules.md)) and *writes*
to it (per-user progress is emitted as an entity document under
[progress](progress/) after analysis).

## Concepts

* [Concepts](concepts/) — coaching rules, move classification, weakness definitions, tactical motifs, accuracy, and spaced repetition.

## Entities

* [Entities](entities/) — opening theory notes and tactical motif definitions.

## References

* [Open Knowledge Format specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) — the vendor-neutral spec this bundle conforms to.
