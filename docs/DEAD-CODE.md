# Dead / placeholder module disposition (PREP-005)

`@hypernovum/core` is published (0.3.0) and HYPERNOVUM Pro vendors it via tarball, so removals are a
semver event: this cycle only tags `@deprecated`; deletions land in the release AFTER 0.4, once a grep
of the Pro monorepo confirms nothing imports them.

| Module | Status | Disposition |
|---|---|---|
| `stores/projectStore.ts` | superseded | **Repurposed** — `stores/interactionStore.ts` is the live store; projectStore kept as deprecated export until next release |
| `filters/FacetFilter.ts` | never used | Deprecate → delete next release (view-level filtering supersedes) |
| `filters/QueryEngine.ts` | never used | Deprecate → delete next release (view-level search supersedes) |
| `effects/DecayEffect.ts` | never used | Deprecate → delete next release (HighlightManager.timeDecay supersedes) |
| `effects/GlowManager.ts` | never used | Deprecate → delete next release (visualState resolver supersedes) |
| `renderers/VisualEncoder.ts` | never used | Deprecate → delete next release (STATUS_COLORS + resolver supersede) |
| `layout/CityLayoutEngine.ts` | trivial wrapper, never used | Keep UNDECIDED until PERF-002 (incremental visibility) picks its layout seam; deprecate otherwise |
| `interactions/MapController.ts` | not even exported | Delete next release (no consumer possible) |

Pre-deletion gate: `grep -rE "FacetFilter|QueryEngine|DecayEffect|GlowManager|VisualEncoder|createProjectStore|MapController"`
across the Pro monorepo and any other consumer of the vendored core tarball.
