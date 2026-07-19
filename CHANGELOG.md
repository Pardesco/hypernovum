# Changelog

## 0.4.0 — 3D-IDE overhaul (2026-07-19)

Interaction foundation (click-focus, HighlightManager), multi-agent fleet
visibility, needs-attention triage, typed project graph, trace impact + session
intelligence, parametric buildings (opt-in), and hardening. See
`RELEASE-NOTES.md` for the user-facing summary and the **interaction behavior
change** (single-click now selects instead of opening).

### Deprecated — scheduled for removal in 0.5 (nothing removed in 0.4)

These still work in 0.4 and are only marked here so integrators can prepare. Because
`@hypernovum/core` is a published package that Pro vendors via tarball, removals are
a semver event, not a local cleanup.

| Item | Replacement | Removal |
|------|-------------|---------|
| Legacy single-file heartbeat `.hypernovum-status.json` **write** path (docs) | Per-session `.hypernovum/agents/*.json` (heartbeat v2) | 0.5 — read support drops too |
| Dead core exports: `FacetFilter`, `QueryEngine`, `VisualEncoder`, `DecayEffect`, `GlowManager`, `CityLayoutEngine` | Superseded by view-level filtering + `HighlightManager` (see `docs/DEAD-CODE.md`) | 0.5 |
| `LinkEdge` type alias | `GraphEdge` (`type: 'backlink'`) | 0.5 |

**Before removing dead core exports in 0.5:** grep the Pro monorepo to confirm it
doesn't consume any of them from the vendored core tarball.
