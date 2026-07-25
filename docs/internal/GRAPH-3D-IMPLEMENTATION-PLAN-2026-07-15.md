# Hypernovum 3D IDE — Implementation Plan (2026-07-15)

Companion to `GRAPH-3D-AUDIT-2026-07-15.md`. Planning only — no code in this document is final; interfaces are
contracts for the implementing agent. Target: solo developers, small teams, AI-assisted "vibe coders."

Product goal (verbatim): **Open the city and know within five seconds what needs attention, what each agent is
doing, how projects are connected, and where intervention is required.**

---

# 1. Executive implementation summary

**Current problem.** The scene renders rich per-building information, but the interaction layer works against
the product goal: a single click navigates *away* from the city, selection has no visual state, agent orbs are
anonymous, concurrent agents clobber each other's heartbeat, there are no typed relationships, no warning
triage, and every search keystroke destroys and rebuilds every mesh. Visual state (hover, weather, move mode,
status pulse) is mutated by four independent code paths fighting over the same material properties.

**Intended end state.** Click focuses; the city dims around your selection; orbs carry names, states, and
files; two agents on the same files produce a visible deterministic conflict; a Needs-Attention lens turns the
city into a triage board; typed edges (backlink / agent-working-on / depends-on / blocked-by) make structure
visible and enable bounded trace-impact; buildings optionally upgrade to data-true parametric towers behind a
setting; filters/lenses toggle visibility instead of rebuilding the world.

**Foundational changes (before features):**
1. A central interaction store (repurposing the dead `stores/projectStore.ts`) owning selected/hovered/focus.
2. A `HighlightManager` visual-state resolver — the *only* code allowed to write building material values.
3. A versioned, multi-writer-safe heartbeat format (per-session snapshot files + legacy fallback).
4. A typed `GraphEdge` model and single `EdgeManager` renderer.
5. Minimal test infrastructure (vitest) — **the repo currently has zero tests**.

**Phases:** 8 (Phase 0–7). Phase 6 (TowerLoft) is parallelizable with Phases 2–5.

**Highest-risk areas:** (a) material-state refactor regressing existing weather/glitch/pulse visuals;
(b) heartbeat migration breaking users' existing Claude Code hook configurations; (c) incremental
visibility updates replacing full rebuilds (layout depends on the filtered set — see PERF-002 for the
resolution); (d) TowerLoft changing city identity for existing users (mitigated by the `buildingStyle` gate).

**First shippable milestone:** Phase 1 (interaction foundation) — click-focus, visual selection, dim-unrelated,
HighlightManager, inspector sync. Independently shippable, immediately felt, and everything later renders
through it.

**Expected product impact:** the five-second glance becomes real: selection persists, warnings aggregate,
agents are identifiable, conflicts surface before they burn tokens, and structure is visible on demand.

---

# 2. Confirmed current architecture

Verified against source on 2026-07-15. Line numbers are approximate anchors, not contracts.

| System | Location | Key symbols |
|---|---|---|
| Plugin entry | `packages/obsidian-plugin/src/main.ts` | `HypernovumPlugin`, commands `open-hypernovum`, `prepare-vault-for-agents`, `generate-daily-briefing` |
| Main view (all HUD/UI) | `packages/obsidian-plugin/src/views/HypernovumView.ts` (1,713 lines) | `HypernovumView`, `VisualLayer` type, `applyFiltersAndRebuild()`, `computeLinkEdges()`, `computeLayerColors()`, `updateInspector()`, `renderCityOverview()`, `showBuildingContextMenu()`, `launchAgentForProject()`, `resolveProjectPath()`, `FolderInputModal` |
| Scene manager (god class) | `packages/core/src/scene/SceneManager.ts` (2,481 lines) | `buildCity()`, `clearCity()`, `createBuilding()`, `createBuildingGeometry()`, `onMouseMove/Down/Up`, `animate()`, `showTooltip()`, `updateAgentPresence()`, `applyWeather()`, `applyLayerColors()`, `showLinkArcs()`, `moveBlock()`, `moveSingleBuilding()`, block-drag state, `blocks: Map<string, BlockData>`, `buildingPathMap: Map<string, Mesh>` |
| Data model | `packages/core/src/types.ts` | `ProjectData`, `District`, `LinkEdge`, `WeatherData`, `HypernovumSettings`, `BlockPosition`, `DEFAULT_SETTINGS` |
| State store (DEAD) | `packages/core/src/stores/projectStore.ts` | zustand vanilla store, exported from `index.ts`, imported by nothing |
| Parsing | `packages/obsidian-plugin/src/parsers/ProjectParser.ts` | frontmatter → `ProjectData`; `parseTasks()` (checkbox fallback), `parseQuestions()`, normalizers |
| Vault watch | `packages/obsidian-plugin/src/parsers/MetadataExtractor.ts` | debounced (2s) full `buildCity()` on metadata change |
| Activity monitor | `packages/obsidian-plugin/src/monitors/ActivityMonitor.ts` | polls `.hypernovum-status.json` every 500ms; `extractAgents()` **already parses an `agents[]` array**; `ActivityStatus` has unused `tool`/`file` fields; idle after 10s |
| Heartbeat writer | `scripts/heartbeat.js` | **single-agent format only; whole-file overwrite; `--stop` nukes fleet state** |
| Git collection | `packages/obsidian-plugin/src/monitors/GitActivityCollector.ts` | branch, last commit, 7/30d counts, porcelain dirty, MERGE_HEAD; `staleBranchCount` is a whole-repo-age proxy |
| Agent context | `packages/obsidian-plugin/src/utils/AgentContext.ts` | writes `.hypernovum/SETUP.md` (+ `.gitignore`) per launch |
| Terminal launcher | `packages/obsidian-plugin/src/utils/TerminalLauncher.ts` | `launch({projectPath, command})` (wt/cmd, iTerm/Terminal.app, linux list), `openInExplorer()`; no agent-less "open shell" entry point (Windows path runs `cmd /k <command>`) |
| Vault agent setup | `packages/obsidian-plugin/src/utils/VaultAgentSetup.ts` | AGENTS.md section writer |
| Skills | `packages/obsidian-plugin/src/utils/SkillsScanner.ts` | scans vault + `~/.claude/skills` SKILL.md |
| Briefing | `packages/obsidian-plugin/src/utils/BriefingGenerator.ts` | daily digest note |
| Raycasting | `packages/core/src/interactions/Raycaster.ts` | `BuildingRaycaster` — `click` + `contextmenu` listeners on canvas; hits `isBuilding` and `isNeuralCore` only (orbs have `isAgentOrb` userData but are building children; `intersectObjects(scene.children, false)` is non-recursive so **orbs and roof details are not hoverable/clickable**) |
| Keyboard | `packages/core/src/interactions/KeyboardNav.ts` | b/s/1-3/space/t, focus-gated; no Escape handling (Escape lives in `SceneManager.onKeyDown`, move-mode only, on `document`) |
| Layout | `packages/core/src/layout/BinPacker.ts` | category×stage districts, priority→height (`calculateHeight`), scope→footprint, grid snap 5 |
| Geometry | `packages/core/src/renderers/GeometryFactory.ts` (6 category silhouettes), `BuildingFactory.ts` (status-based spire/monolith/ziggurat + `createFoundation`), `RooftopFactory.ts` (greebles, beacon, seeded PRNG) |
| Shaders | `packages/core/src/shaders/building.vert/.frag` | uniforms `uColor uDecay uLitPercent uPulse uTime uGlitch uScope uTotalTasks`; window grid from `vUv`, rows clamped 4–20; glitch, decay dither, rim |
| Shader wrapper | `packages/core/src/renderers/BuildingShader.ts` | compile test, per-project material; own status palette |
| Ambient visuals | `NeuralCore.ts`, `ArteryManager.ts`, `DataArtery.ts` | core states IDLE/STREAMING/BULK_UPDATE/ERROR; streaming artery per active project |
| Persistence | `main.ts` `loadSettings/saveSettings` (Obsidian `loadData`); `HypernovumSettings` + plugin extension in `SettingsTab.ts` (`vaultMode`, `agentName`, `agentCommand`); `blockPositions` is the only persisted view state |
| Dead/placeholder modules | `CityLayoutEngine.ts`, `filters/FacetFilter.ts`, `filters/QueryEngine.ts`, `effects/DecayEffect.ts`, `effects/GlowManager.ts`, `renderers/VisualEncoder.ts`, `stores/projectStore.ts`, `interactions/MapController.ts` (not even exported) | all unused by the plugin; all except MapController exported from `core/src/index.ts` of the **published** `@hypernovum/core@0.3.0` package |
| Build | core: `tsc --build` + stamp script; plugin: `esbuild.config.mjs` | **No test runner, no test files, no CI config in repo** |

### Audit refinements discovered during re-verification (corrections of record)

1. **Double-click today opens the note AND enters move mode.** `BuildingRaycaster` fires the open handler on
   the first `click` of the pair; `SceneManager.onMouseDown` (~line 1404) detects the second within 400ms and
   enters move mode. The audit described these as alternatives; they actually stack. Strengthens the case for
   INT-003.
2. **`enableShadows` and `showLabels` settings are dead.** `SceneManager.initRenderer` enables shadows
   unconditionally; `createSmartLabels` never checks `showLabels`. Fixed by INT-006 / PERF-004.
3. **`maxBuildings` is never enforced** — no code slices the project list. Fixed by PERF-003.
4. **Status color palettes disagree.** `SceneManager.getStatusColor` (active `0x00cc66`, blocked `0xdd3333`,
   paused `0x3366dd`, complete `0x9966cc`) vs `BuildingShader.getStatusColor` (`0x00ff88`, `0xff4444`,
   `0x4488ff`, `0xaa88ff`) vs `VisualEncoder` (copy of the shader palette). Shader-on and shader-off cities are
   different colors. Consolidate in INT-002 (single `STATUS_COLORS` source in core).
5. **`VisualEncoder` is dead code** (audit listed it as live). Added to the disposition list.
6. **Agent orbs are un-raycastable** — `intersectObjects(scene.children, false)` is non-recursive and orbs are
   building children. AGT-004 must add orbs to an explicit raycast target list.
7. **`@hypernovum/core` is published** (`prepublishOnly` present, version 0.3.0) and Pro vendors core via
   tarball (`sync-core.sh`, per project memory). Dead-export removal is a semver event, not a local cleanup —
   see PREP-005 and Unresolved Decision U3.
8. **`escapeHtml` exists twice** with different implementations (`HypernovumView` regex map,
   `SceneManager` DOM-based). Consolidation folded into PREP-006.

---

# 3. Decisions and non-goals

## Firm decisions

| Area | Decision |
|---|---|
| Interaction semantics | Hover = temporary inspect (tooltip + neighbor brighten). Single-click = persistent focus (highlight, dim unrelated, inspector). Double-click = open note. Right-click = actions menu. Move mode = context-menu item only. Escape / empty-space click = clear focus. Ships **default-on** with a one-time hint (see U1). |
| Edge types | Exactly four: `backlink`, `agent-working-on`, `depends-on`, `blocked-by`. No import/call/test ontology. `GraphEdge.source` field (`deterministic` \| `inferred`) reserved so inferred edges can arrive later without schema change; nothing emits `inferred` in this initiative. |
| Heartbeat strategy | **Directory of per-session atomic snapshot files** (`.hypernovum/agents/*.json` at vault root) as primary; legacy `.hypernovum-status.json` still read (and written by legacy invocations) for ≥1 release. Session telemetry (Phase 5) uses **append-only JSONL** per session — different job, different format. Rationale in §7. |
| Conflict detection scope | Deterministic only: same-file overlap, overlapping file sets, same-project multi-agent notice, dirty-tree-at-session-start ("stale context"), heartbeat clobbering (eliminated structurally by the new format), agent-complete-while-repo-conflicted. No AI analysis. |
| Lens strategy | Keep the six scan layers. Add named presets = `{layer, statusFilter, priorityFilter, categoryFilter, showLinks/edgeTypes}` persisted **per vault** in plugin settings (same channel as `blockPositions`). Three shipped defaults. No global store. |
| Building gating | New `buildingStyle: 'classic' \| 'parametric'` setting, default `'classic'`. TowerLoft only renders under `'parametric'`. Classic path byte-for-byte untouched. Helix/ziggurat migration = parametric-mode replacements, not classic-mode changes. |
| Persistence | Everything through existing `plugin.saveSettings()` (Obsidian `data.json`). New keys are additive with defaults; no migration framework — `Object.assign({}, DEFAULT_SETTINGS, loaded)` already tolerates missing keys. |
| Backwards compatibility | Saved layouts, frontmatter schema, classic silhouettes, legacy heartbeat consumers, and the NEURAL LINKS toggle behavior all preserved. The only intentional behavior break is single-click no longer opening the note (documented, hinted, and strictly better aligned with product goal). |
| Visual state | One resolver (`HighlightManager`) computes a composed `VisualState` per building per change; nothing else writes `material.color/emissive/emissiveIntensity/opacity` or `mesh.scale`. `animate()` keeps only time-based modulation *of resolver-provided baselines*. Precedence model in §8. |
| Testing | vitest at workspace root; unit tests for all new pure logic (edge model, conflict engine, warning aggregator, dependency parser, traversal, TowerLoft invariants, heartbeat writer via Node `child_process`). Plugin UI remains manually tested via the Phase 0 checklist (Obsidian API mocking is out of scope). |

## Non-goals (explicitly out of scope)

- Enterprise orchestration, agent handoff/review chains, approval pipelines.
- AI-inferred graph relationships (schema slot reserved; no implementation).
- Time-slider / historical replay (recency lens + activity feed suffice).
- In-scene CSS3D terminal (Future Dev.md's own "Hybrid Shell" conclusion stands).
- Code-level import/call graphs; parsing source files for dependencies.
- CI/test-status collection (no lightweight local source exists; git signals only).
- Permissions, roles, organizational hierarchy, multi-user sync.
- Universal package-manager framework (npm-family manifests + explicit frontmatter only; §12).
- Rewriting SceneManager wholesale — extract only what the features require.
- Plan parsing / semantic diffing of agent transcripts (Phase 5 ships a data digest only).

---

# 4. Dependency graph of the work

```text
PREP-002 vitest harness ──────────────────────────────(gates every "Tests" line below)

INT-001 Central interaction store (repurpose projectStore.ts)
└── INT-002 HighlightManager (visual-state resolver; consolidates STATUS_COLORS)
    ├── INT-003 Click=focus / dblclick=open (needs somewhere to put focus)
    │   ├── INT-004 Move mode via context menu + Esc/empty-space clear
    │   └── INT-007 Inspector driven by store
    ├── INT-005 Dim-unrelated / selected emphasis
    ├── INT-006 Label visibility policy
    ├── INT-008 Hover neighborhood (backlink arcs)  ──later upgraded by EDG-008
    ├── AGT-005 Orb visual states        (orb color/pulse routed through resolver)
    ├── TRI-002 Needs-Attention lens     (warning visuals routed through resolver)
    └── BLD-004 parametric gate          (resolver must not assume box geometry)

AGT-001 Heartbeat v2 (per-session snapshot dir + atomic writes)
├── AGT-002 ActivityMonitor v2 (dir + legacy merge)
│   ├── AGT-003 Agent session registry & state derivation
│   │   ├── AGT-004 Orb identity/tooltip (also needs raycast fix)
│   │   ├── AGT-005 Orb visual states
│   │   ├── AGT-007 Conflict engine ── AGT-008 Conflict presentation
│   │   ├── AGT-009 Inspector agent section
│   │   ├── TRI-001 Warning aggregator (agent-derived warnings)
│   │   └── EDG-005 agent-working-on edges
│   └── SES-001 JSONL session events ── SES-002 session digest ── SES-003 plan-vs-action lite
└── AGT-006 Hook/docs updates (SETUP.md, AGENTS.md, heartbeat usage)

TRI-001 Warning aggregator (needs AGT-003 for agent warnings; git warnings standalone)
├── TRI-002 Needs-Attention lens + badge
└── TRI-003 Actionable warning rows in overview inspector

GitActivityCollector extension (TRI-004 commits; part of TRI-001 data)
├── TRI-004 Recent commits in inspector
└── TRI-005 Recent activity feed

LENS-001 Saved presets (independent; only touches settings + command panel)

PERF-001 Search debounce (independent, tiny)
PERF-002 Incremental visibility (independent of features, prerequisite-ish for
         comfortable lens switching; must land before or with TRI-002 for UX quality)

EDG-001 GraphEdge model + EdgeManager
├── EDG-002 Backlink migration
├── EDG-003 blocked-by (parser + edge + TRI-001 integration)
├── EDG-004 Dependency scanner + cache ── EDG-007 inspector dep sections
├── EDG-005 agent-working-on edges (needs AGT-003)
├── EDG-006 Edge-type filter UI
├── EDG-008 Neighborhood highlight via edges (upgrades INT-008; needs INT-002)
└── IMP-001 Traversal util ── IMP-002 Trace-impact mode (also reads AGT-003 for overlap)

BLD-001 TowerLoft generator (standalone in core; no upstream deps)
├── BLD-002 Geometry invariants/tests
├── BLD-003 Category presets + data mapping
├── BLD-004 buildingStyle gate + SceneManager wiring (after INT-002 to avoid rebasing
│           material logic twice — soft ordering, not a hard dependency)
├── BLD-005 Shader floor-truth + diagrid uniform
└── BLD-006 Caching + rooftop compatibility
```

**Files likely to cause merge conflicts if agents work in parallel:**
`SceneManager.ts` (touched by INT-002/003/004/005/006, AGT-004/005/008, EDG-001, BLD-004, PERF-002) and
`HypernovumView.ts` (touched by INT-003/007, AGT-009, TRI-*, LENS-001, PERF-001/002, EDG-006/007). Any two
workstreams touching these must be serialized or rebased carefully. `types.ts`, `SettingsTab.ts`, and
`core/src/index.ts` get small additive edits from many tasks — keep those edits append-only. Safe parallel
islands: `scripts/heartbeat.js` + `ActivityMonitor.ts` (AGT-001/002), `TowerLoft.ts` (BLD-001/002/003),
`DependencyScanner` (EDG-004 core logic), `GitActivityCollector.ts` (TRI-004), test files.

---

# 5. Phased roadmap

## Phase 0 — Safety, baselines, cleanup decisions (PREP)
Manual regression checklist capturing today's behavior (including the quirks we intend to change, marked as
such); vitest harness; performance baseline script + numbers recorded for 25/100/250 synthetic projects;
feature-flag plumbing (`buildingStyle`, `interactionHintShown`); dead-module disposition *decision* (deletion
deferred to Phase 7 — see PREP-005); dev-log utility replacing stray `console.log`s. No user-facing change.

## Phase 1 — Interaction foundation (INT) — **first shippable milestone**
Central interaction store; HighlightManager with the §8 precedence model (absorbing hover, move-mode, weather,
status-pulse, and layer-color mutations); click=focus / dblclick=open / context-menu move / Esc + empty-space
clear; dim-unrelated; label policy (selected/hovered/warning always visible, distance culling, honor
`showLabels`); inspector synchronized to the store; hover-neighborhood v1 (brighten backlink arcs).
Non-color cues: selected = edge-glow + scale + label weight (not color alone); controls hint updated;
one-time "click now focuses — double-click opens" notice.

## Phase 2 — Multi-agent fleet visibility (AGT)
Heartbeat v2: versioned per-session snapshot files, atomic writes, stale pruning, legacy file still honored;
ActivityMonitor v2 merging both sources; agent session registry with the §10 state model; orb identity
(raycastable orbs, hover tooltip: name/type/project/action/tool/file/age), orb state visuals; deterministic
conflict engine + presentation (red pairing arc, inspector rows, warning integration); inspector "Agents"
section; SETUP.md/AGENTS.md doc updates teaching agents the v2 heartbeat.

## Phase 3 — Triage & small-team operations (TRI, LENS, PERF)
Warning aggregator + severity/precedence (§11); Needs-Attention lens + ⚠ badge; actionable warning rows;
GitActivityCollector v2 (recent commit subjects, ahead/behind when upstream exists); recent-activity feed;
Open Terminal + Copy Path actions; Add Quest action; saved lens presets (3 shipped defaults); search debounce;
incremental visibility updates (visible-toggle + retint instead of rebuild for filter/lens/search changes);
`maxBuildings` enforcement; empty/error states for all new panels.

## Phase 4 — Typed project graph (EDG)
`GraphEdge` schema + `EdgeManager` (one renderer for all arcs: style per type, direction indicator via
dash-flow or arrowhead cone); backlink migration (NEURAL LINKS button becomes edge-type toggles); `blocked_by`
frontmatter → edges + warnings; manifest dependency scanner with cache and invalidation; agent-working-on
edges from live sessions; inspector Dependencies/Dependents sections; hover/selection neighborhood upgraded to
all edge types.

## Phase 5 — Trace impact & session intelligence (IMP, SES)
Bounded, cycle-safe traversal util; "Trace impact" context-menu mode (upstream/downstream highlight through
HighlightManager, inspector result list, active-agent overlap flags, Esc exits); JSONL session event log
written by heartbeat; last-session digest in inspector (duration, files touched, commits landed in window);
plan-vs-action **lite**: only when an agent voluntarily emitted `objective` and/or `plannedFiles`, show
"planned N / touched M" — never fabricate.

## Phase 6 — TowerLoft building system (BLD) — parallelizable from Phase 2 onward
`TowerLoft(params)` loft generator (superellipse/polygon profile × taper/twist/waist/lean/setbacks, discrete
floor rings, quad strips, cap, param-grid UVs, computed normals, bottom-anchored); hard clamps to the realism
ranges; geometry invariant tests; category presets with data-driven floor counts; `buildingStyle` gate wired
into `createBuildingGeometry` with full classic fallback; shader gains `uFloors` so window rows = real floors
in parametric mode (classic behavior unchanged); optional diagrid uniform; geometry cache keyed by params;
RooftopFactory safe-radius verification on new silhouettes.

Can start any time after Phase 0 (BLD-001..003 touch only new files + tests). Final wiring (BLD-004) should
land after INT-002 so material handling isn't rebased twice — soft ordering.

## Phase 7 — Hardening & release (HRD, DOC)
Full regression pass against the Phase 0 checklist; performance verification at 25/100/250 projects, 4
concurrent agents, dense edges; corrupt/partial heartbeat and manifest fuzz tests; settings round-trip tests;
visual-clutter review (edge + label density at 100+ projects); README/SCHEMA/controls-hint/legend
documentation; release notes with the click-behavior change front and center; rollback notes (all risky
features behind settings); deprecation timeline for legacy heartbeat single-file support and dead core
exports (removal in the *following* release, not this one).

---

# 6. Detailed implementation tasks

Field key: **Outcome** (user-facing) · **Tech** (approach) · **Files** · **Deps** · **Schema** · **UI** ·
**Edges** (edge cases) · **Perf** · **Tests** · **Accept** (acceptance criteria) · **Size** · **Parallel** ·
**Checkpoint** (commit boundary).

## Phase 0

---
**PREP-001 — Behavior snapshot & manual regression checklist**
**Outcome:** none (safety net). **Tech:** Write `docs/QA-CHECKLIST.md` enumerating current observable behaviors:
open view, hover tooltip (building + foundation), click-opens-note (marked "will change"), double-click
move-mode+note-open quirk (marked "will change"), block drag + Save Layout, per-lens legends, all 6 lenses,
NEURAL LINKS toggle, search/filters, empty states, snapshot button, agent launch (all 3 menu paths), quest
gem + resolution burst, keyboard b/s/space/t, vault mode differences, settings toggles (note which are dead).
Capture reference screenshots into `docs/qa-baseline/` via the existing Snapshot button.
**Files:** new docs only. **Deps:** none. **Tests:** n/a (this *is* the manual test).
**Accept:** checklist covers every behavior listed above; screenshots exist for status lens + git lens + links-on.
**Size:** S. **Parallel:** yes. **Checkpoint:** `docs: add QA baseline checklist`.

---
**PREP-002 — vitest harness**
**Outcome:** none. **Tech:** Add vitest as root devDependency; `vitest.config.ts` with two projects: `core`
(environment `node`; three.js works headless for geometry/math) and `plugin-utils` (node; only pure modules —
no `obsidian` imports). Add `npm test` root script. Seed with 3 smoke tests: `BinPacker.packDistricts` produces
positions/dimensions for 3 projects; `RooftopFactory` determinism (same path → same geometry hash);
`heartbeat.js` writes parseable JSON (spawn via `child_process` into a temp dir).
**Files:** `package.json`, `vitest.config.ts`, `packages/core/test/`, `scripts/test/`. **Deps:** none.
**Edges:** `obsidian` package cannot be imported in tests — keep plugin-side tests to `utils/` modules that
don't import it (currently `SkillsScanner` partially, heartbeat fully); document this constraint in the config.
**Accept:** `npm test` green locally on Windows. **Size:** S–M. **Parallel:** yes.
**Checkpoint:** `test: add vitest harness + smoke tests`.

---
**PREP-003 — Performance baseline**
**Outcome:** none. **Tech:** `scripts/gen-test-vault.mjs` generating N synthetic project notes (frontmatter
matrix over status/priority/category/stack/tasks; a subset with real `projectDir` pointing at a scratch git
repo the script inits). Add a dev-only timing wrapper (gated by `localStorage.hypernovumDebug`) around
`buildCity()`, `applyFiltersAndRebuild()`, and a rolling FPS meter logged to console. Record numbers for
25/100/250 into `docs/PERF-BASELINE.md`.
**Files:** new script + doc; ~6 timing lines in `HypernovumView.ts`/`SceneManager.ts`. **Deps:** none.
**Accept:** baseline table committed with hardware note. **Size:** S. **Parallel:** yes.
**Checkpoint:** `chore: perf baseline tooling + numbers`.

---
**PREP-004 — Feature-flag / settings plumbing**
**Outcome:** none yet. **Tech:** Add to `HypernovumSettings` (core) + `DEFAULT_SETTINGS`:
`buildingStyle: 'classic' | 'parametric'` (default `'classic'`), and to plugin settings:
`interactionHintShown: boolean` (default false), `savedLenses: LensPreset[]` (default `[]`, consumed in
LENS-001). Settings UI rows land with their features, not here — this is schema only so later tasks don't all
collide in `types.ts`.
**Files:** `core/src/types.ts`, `SettingsTab.ts`. **Deps:** none. **Schema:** additive keys.
**Tests:** settings default-merge round-trip (pure object test). **Accept:** plugin loads with old `data.json`
(missing keys) without error. **Size:** S. **Parallel:** yes. **Checkpoint:** `feat: settings schema for flags`.

---
**PREP-005 — Dead-module disposition (decision, not deletion)**
**Outcome:** none. **Tech:** Record in `docs/DEAD-CODE.md`: `projectStore.ts` → **repurpose** as interaction
store (INT-001). `FacetFilter`/`QueryEngine` → superseded by view-level filtering; mark `@deprecated` JSDoc,
delete in Phase 7. `DecayEffect`/`GlowManager`/`VisualEncoder` → superseded by HighlightManager; same
treatment. `CityLayoutEngine` → trivial BinPacker wrapper; keep as the future layout seam **only if** PERF-002
uses it, else deprecate. `MapController` → unexported and unused; delete in Phase 7. Because
`@hypernovum/core` is published and Pro vendors it (see U3), removals ship in the next minor (0.4.0) with
CHANGELOG notice; this initiative only adds `@deprecated` tags.
**Files:** JSDoc tags + doc. **Deps:** none. **Accept:** every placeholder module has an explicit disposition.
**Size:** S. **Parallel:** yes. **Checkpoint:** `docs: dead-code disposition`.

---
**PREP-006 — Dev logging + escapeHtml consolidation**
**Outcome:** none. **Tech:** `core/src/utils/log.ts` — `debugLog(...)` gated by a module flag settable from the
plugin (reads `localStorage.hypernovumDebug`). Replace stray `console.log`s in SceneManager (launch/stream
logs). Move one `escapeHtml` into a shared plugin util; delete the duplicate.
**Files:** new util, `SceneManager.ts`, `HypernovumView.ts`. **Deps:** none. **Accept:** no unconditional
console output in normal operation. **Size:** S. **Parallel:** yes. **Checkpoint:** `chore: gated dev logging`.

## Phase 1

---
**INT-001 — Central interaction store**
**Outcome:** none directly; enables everything. **Tech:** Repurpose `core/src/stores/projectStore.ts` into
`interactionStore.ts` (zustand vanilla — dependency already present): state per §7.1 (`selectedPath`,
`hoveredPath`, `focusActive`, `traceImpact` placeholder, `moveModePath`). Factory instantiated by
`HypernovumView`, handed to `SceneManager` and later `HighlightManager`. All *writes* go through store actions;
`HypernovumView` and `SceneManager` *subscribe*. Replace `HypernovumView.selectedProject` and
`SceneManager.focusedProject`/`hoveredMesh`-as-state (raycast scratch may remain local, but the *authoritative*
hovered path lives in the store). Keep `ProjectData` objects out of the store — store paths, resolve via
existing `buildingPathMap`/project arrays (avoids stale-object bugs across rebuilds).
**Files:** `stores/projectStore.ts` (renamed export kept for compat: `createProjectStore` re-exported as
deprecated alias), `core/src/index.ts`, `SceneManager.ts`, `HypernovumView.ts`.
**Deps:** PREP-002. **Schema:** §7.1. **Edges:** selection must survive `buildCity()` rebuilds (paths do;
meshes don't) — after rebuild, re-apply highlight for `selectedPath` if the building still exists, else clear
selection. **Tests:** store transitions (select→hover→clear, rebuild-survival logic as pure function).
**Accept:** selection state readable from one place; existing behavior unchanged (this task is wiring only).
**Size:** M. **Parallel:** no (SceneManager). **Checkpoint:** `refactor: central interaction store`.

---
**INT-002 — HighlightManager (visual-state resolver)**
**Outcome:** hover/status/weather visuals identical to before, but driven by one system. **Tech:** New
`core/src/scene/HighlightManager.ts`. Owns, per building path: base color, emissive color/intensity baseline,
opacity, scale, outline (edge-glow line opacity/color), and label emphasis. Implements the §8 resolver:
`resolve(path) → VisualState`, applied to fallback materials, shader uniforms (`uColor`, `uGlitch`, `uPulse`,
`uDecay`), and edge-glow LineSegments. Migrate INTO it: `onMouseMove` hover emissive bumps, move-mode
brightening, `applyWeather` material branches, `applyLayerColors`, and the per-status emissive baselines in
`animate()`. `animate()` afterwards only does `baseline + sin(t·speed)·amplitude` using per-building
`{baseIntensity, pulseSpeed, pulseAmplitude}` published by the resolver — it never chooses colors again.
Consolidate the three status palettes into one exported `STATUS_COLORS` in `types.ts` (**decision: adopt the
shader palette** — brighter, matches published screenshots of shader mode; classic-mode buildings get slightly
brighter status colors, note in release notes).
**Files:** new `HighlightManager.ts`, heavy edits in `SceneManager.ts` (`createBuilding` material setup,
`onMouseMove`, `applyWeather`, `applyLayerColors`, `animate`, move mode), `types.ts`, `index.ts`.
**Deps:** INT-001. **Schema:** §7.2. **Edges:** shader vs fallback material paths must both route through it;
weather overrides interact with lens colors (lens wins base color, weather keeps glitch/pulse channels — per
§8); disposed meshes must be evicted (hook into `clearCity`). **Perf:** resolver runs on state *changes*, not
per frame; dirty-set application; no per-frame allocation. **Tests:** precedence unit tests (pure `resolve()`
over synthetic inputs — the §8 table as a test matrix). **Accept:** QA checklist visuals unchanged (except
documented palette unification); zero direct `emissiveIntensity`/`material.color` writes outside
HighlightManager + animate's published-baseline modulation (enforced by grep in review).
**Size:** L. **Parallel:** no (SceneManager). **Checkpoint:** two commits — `feat: HighlightManager skeleton +
status/hover migration`, then `refactor: weather/layer/move-mode routed through HighlightManager`.

---
**INT-003 — Click = focus, double-click = open**
**Outcome:** clicking a building selects and focuses it without leaving the city; double-click opens the note.
**Tech:** In `BuildingRaycaster`: track click timestamps; single-click (after 250–300ms with no second click,
or immediately with a suppressed-open pattern — implement as: click fires `onSelect` immediately; a second
click within 350ms fires `onOpen` and cancels nothing since select is idempotent). Remove the double-click
move-mode detection from `SceneManager.onMouseDown` (~1404–1420). `HypernovumView`: click handler →
`store.select(path)` (+ `sceneManager.focusOnPosition` only via the explicit Focus action, NOT on every click
— camera stays put per product decision); dblclick handler → `openLinkText`. Keyboard cycling (`cycleByStatus`)
now also writes `store.select`.
**Files:** `Raycaster.ts`, `SceneManager.ts`, `HypernovumView.ts`. **Deps:** INT-001, INT-002.
**UI:** selected building gets §8 selected treatment instantly on first click; no camera motion; note opens
only on double-click. **Edges:** double-click must not ALSO trigger empty-space deselect between clicks;
foundation clicks select the same project as building clicks (add foundation hit pads to click targets);
touch/pen events out of scope. **Tests:** click-timing state machine as pure function.
**Accept:** single click never opens a note; double-click opens exactly one leaf; select is visible.
**Size:** M. **Parallel:** no. **Checkpoint:** `feat: click-focus interaction model`.

---
**INT-004 — Explicit move mode, Escape, empty-space deselect**
**Outcome:** "Move building" appears in the right-click menu; Esc or clicking empty ground clears
selection/move mode. **Tech:** Context-menu item calls existing `enterBuildingMoveMode(mesh)`; move mode state
mirrored into store (`moveModePath`) so HighlightManager renders it. Escape handling consolidated: extend
`KeyboardNav` with Escape → callback (view decides: exit move mode first if active, else clear selection);
remove `SceneManager`'s document-level `onKeyDown` (currently move-mode-only; note it was NOT focus-gated —
consolidating into KeyboardNav makes Escape focus-gated; acceptable, since move mode is entered via
canvas interaction so canvas has focus). Empty-space: in click handling, a raycast hitting nothing
building/orb/handle → `store.clearSelection()`.
**Files:** `KeyboardNav.ts`, `SceneManager.ts`, `HypernovumView.ts` (menu item), `Raycaster.ts`.
**Deps:** INT-003. **UI:** move-mode indicator text updated ("Esc to exit"). **Edges:** block-drag handles and
Neural Core clicks must not deselect; clicking a CSS2D label (pointer-events none) falls through — fine.
**Accept:** every path into/out of move mode leaves cursor + emissive state consistent (checklist item).
**Size:** S. **Parallel:** no. **Checkpoint:** with INT-003 or separate `feat: explicit move mode + esc`.

---
**INT-005 — Dim-unrelated & selected emphasis**
**Outcome:** selecting a building visibly mutes everything unrelated; connected items stay readable.
**Tech:** HighlightManager focus pass: selected → `selected` state; buildings sharing an edge with selection
(Phase 1: backlink arcs if links on; Phase 4: all edge types) → `connected`; all others → `dimmed`
(opacity ~0.35 on fallback materials; shader path gets new `uDimFactor` uniform multiplying final color —
small `building.frag` addition; edge-glow lines and foundations dim too). District outlines/fills exempt.
**Files:** `HighlightManager.ts`, `building.frag` (one uniform), `BuildingShader.ts` (uniform decl),
`SceneManager.ts`. **Deps:** INT-002, INT-003. **Edges:** transparent-material sorting artifacts — set
`transparent: true` only while dimmed to avoid permanent alpha-sort cost; restore on clear. Quest gems/orbs
(children) inherit? Decision: children dim with parent except agent orbs (agents stay visible — they're the
point). **Perf:** state application only on selection change. **Tests:** resolver matrix rows for
selected/connected/dimmed. **Accept:** with 20+ projects, the selected building is findable in <1s from a
screenshot; Esc restores exactly prior appearance. **Size:** M. **Parallel:** no.
**Checkpoint:** `feat: focus dim/emphasis pass`.

---
**INT-006 — Label visibility policy**
**Outcome:** fewer overlapping labels; important labels always visible; `showLabels` setting works.
**Tech:** In `animate()` (or a 4Hz throttled tick), per label: hide if camera distance > threshold (scaled to
city radius) UNLESS its building is selected/hovered/connected/warning-active; honor `settings.showLabels`
master toggle (off = only selected/hovered). CSS class toggle (`display:none`) — no DOM churn.
**Files:** `SceneManager.ts` (`createSmartLabels`, `animate`), settings already exist.
**Deps:** INT-002 (warning/selected flags), INT-005. **Edges:** category labels (district) unaffected; labels
for filtered-out buildings don't exist (rebuild handles). **Perf:** distance checks are ~N vector ops at 4Hz —
negligible; verify no layout thrash from class toggles. **Accept:** at 100 projects zoomed out, ≤ ~15 labels
visible; zooming in reveals more; selected label always on. **Size:** S–M. **Parallel:** after INT-005.
**Checkpoint:** `feat: label visibility policy`.

---
**INT-007 — Inspector synchronized to store**
**Outcome:** inspector always mirrors the selection; closing it clears focus. **Tech:** `updateInspector()`
subscribes to store; the ✕ button and Esc both call `store.clearSelection()`; "Focus" action remains the
camera-mover. Remove direct `this.selectedProject` field (store is truth).
**Files:** `HypernovumView.ts`. **Deps:** INT-001, INT-003. **Edges:** selection of a project that gets
filtered out mid-selection (vault edit) → store clears (rebuild hook from INT-001). **Accept:** no path exists
where inspector shows A while scene highlights B. **Size:** S. **Parallel:** no.
**Checkpoint:** part of INT-003 commit or `refactor: inspector via store`.

---
**INT-008 — Hover neighborhood v1 (backlink arcs)**
**Outcome:** with NEURAL LINKS on, hovering a building brightens its arcs and shows neighbor labels.
**Tech:** `SceneManager.showLinkArcs` already stores per-arc userData; add path-pair index; on hover-change,
HighlightManager sets arc opacity boost for arcs touching hovered path + `connected` label-visibility for
their endpoints; restore on hover-out. No layout change, no new geometry.
**Files:** `SceneManager.ts`/`HighlightManager.ts`. **Deps:** INT-002, INT-006. **Edges:** hover during focus:
hover effects layer *on top of* focus dimming per §8 precedence. **Accept:** hover feedback <16ms (no
allocation). **Size:** S. **Parallel:** after INT-005. **Checkpoint:** `feat: hover neighborhood (backlinks)`.

## Phase 2

---
**AGT-001 — Heartbeat v2: per-session snapshot directory + safe writer**
**Outcome:** concurrent agents never clobber each other. **Tech:** New format per §7.4: each session writes
`<vault>/.hypernovum/agents/<sessionId>.json` atomically (write `.tmp`, `fs.renameSync`). Rewrite
`scripts/heartbeat.js`: args `--vault --id --name --agent-type --project --action --tool --file --state
--objective --session-start --stop`; auto-generate + persist sessionId in env-file-less mode by hashing
`pid+start` when `--id` absent (documented: pass `--id` for stable identity across hook invocations, e.g.
`$CLAUDE_SESSION_ID`); `--stop` writes `state: 'complete'` (file remains until pruned — completed sessions
stay visible per §10); writer prunes sibling files with `lastPing` older than 24h. Legacy behavior: when
invoked WITHOUT `--id` and vault has no `.hypernovum/agents/` dir yet… **decision: always write v2**; legacy
single-file `.hypernovum-status.json` is no longer written by the new script but REMAINS READ by the monitor
(AGT-002) so old script copies / third-party writers keep working. Also ensure `.hypernovum/agents/` is
covered by the existing `.hypernovum/.gitignore` convention — note: the agents dir is at the *vault* root's
`.hypernovum/`, distinct from per-project `.hypernovum/` dirs; heartbeat creates `.hypernovum/.gitignore`
(`*`) if absent.
**Files:** `scripts/heartbeat.js`. **Deps:** PREP-002. **Schema:** §7.4. **Edges:** two processes pruning
simultaneously (rename/unlink races — wrap in try/catch, ignore ENOENT); clock skew (use file's own lastPing,
not mtime); vault path with spaces (already handled via arg parsing — verify). **Tests:** spawn 4 concurrent
writer processes × 25 pings each into a temp dir → 4 files, all parseable, no torn JSON; `--stop` affects only
own file. **Accept:** concurrency test green on Windows (rename semantics differ — this is the platform that
matters). **Size:** M. **Parallel:** YES (no plugin files). **Checkpoint:** `feat: heartbeat v2 writer`.

---
**AGT-002 — ActivityMonitor v2 reader**
**Outcome:** the city sees all agents from both formats. **Tech:** Extend `ActivityMonitor.poll()`: list
`.hypernovum/agents/*.json` via `vault.adapter.list`, parse each (skip unparseable silently, count for a
degraded-data warning), merge with legacy `.hypernovum-status.json` (legacy entry id `'legacy'`; ignored if a
v2 file claims the same project with fresher ping). Emit `AgentPresence[]` extended with v2 fields (§7.5).
Poll stays 500ms but directory listing is cheap; keep a per-file mtime short-circuit if adapter exposes it
(else parse — files are <1KB).
**Files:** `ActivityMonitor.ts`. **Deps:** AGT-001. **Edges:** dir absent (fine, legacy-only); >20 session
files (prune consideration is writer-side; reader caps at 32 freshest); JSON with wrong `version` → attempt
best-effort field pick, else skip. **Tests:** merge logic as pure function (`extractAgents` already is —
extend). **Accept:** legacy-only vault behaves exactly as today; v2 sessions appear within one poll.
**Size:** M. **Parallel:** yes (pairs with AGT-001). **Checkpoint:** `feat: fleet-safe activity monitor`.

---
**AGT-003 — Agent session registry & state derivation**
**Outcome:** internal; agents have coherent lifecycle. **Tech:** New
`packages/obsidian-plugin/src/monitors/AgentRegistry.ts`: consumes `onFleetUpdate`, maintains
`Map<sessionId, AgentSession>` (§7.5) with derived state per §10 (explicit `state` field wins; else inferred
from tool/action keywords + ping age). Tracks per-session `filesTouched` set (accumulated from `file` field
across pings), `startedAt`, project resolution (reuse `findProjectByName`, but prefer exact `projectDir` match
when v2 sends a path — v2 heartbeat sends `--project` as the cwd basename by convention; registry resolves
against `resolveProjectPath` outputs). Emits registry snapshots to view.
**Files:** new `AgentRegistry.ts`, `HypernovumView.ts` wiring. **Deps:** AGT-002. **Schema:** §7.5.
**Edges:** same agent id, project changes mid-session (reassign, keep filesTouched split per project? —
decision: filesTouched keyed per (session, project)); sessions completing then restarting with same id (new
`startedAt` resets). **Tests:** state-derivation table (§10) as unit matrix; filesTouched accumulation.
**Accept:** registry mirrors N synthetic session files correctly, including stale expiry.
**Size:** M. **Parallel:** yes until view wiring. **Checkpoint:** `feat: agent session registry`.

---
**AGT-004 — Orb identity: raycastable orbs + tooltip**
**Outcome:** hovering an agent orb shows who it is and what it's doing. **Tech:** `SceneManager` keeps
`agentOrbs` map — expose orb meshes as raycast targets: add them to a dedicated array checked in
`onMouseMove` (before buildings) and in `BuildingRaycaster` (new `orbHits` path via explicit target list —
fix from §2 note 6: pass orb list, don't rely on scene.children). Orb hover → tooltip (reuse
`showTooltip` frame): agent name, type, state, project, action, tool, current file (basename), ping age.
`updateAgentPresence` signature extended to carry the display fields (§7.5 subset).
**Files:** `SceneManager.ts`, `Raycaster.ts`, `HypernovumView.ts` (`onFleetUpdate` mapping).
**Deps:** AGT-003, INT-002 (tooltip/hover conventions). **UI:** orb tooltip visually distinct from building
tooltip (kicker "AGENT"). **Edges:** orb of a filtered-out building doesn't exist (presence targets only
rendered buildings — registry keeps the session; orb reappears when filter clears). **Perf:** orb raycast list
is ~agent count (≤8 realistically). **Accept:** hover any orb → correct identity within one frame.
**Size:** M. **Parallel:** after AGT-003 + INT-002. **Checkpoint:** `feat: identifiable agent orbs`.

---
**AGT-005 — Orb visual state model**
**Outcome:** orb appearance answers "working / waiting / blocked / done / stale" at a glance. **Tech:** Routed
through HighlightManager (orbs registered as satellites): working = agent hue (existing stable hash), steady
orbit; waiting = amber, slow strong pulse, orbit paused; blocked/failed = red, fast pulse; complete = green,
static, fades out over 60s then orb removed (session row remains in inspector); stale = grey 40% opacity,
no orbit. Plus a subtle interior-glow tint on the host building while any agent is `editing` (existing
`uPulse` channel — already wired for streaming; extend trigger to registry state).
**Files:** `SceneManager.ts` (orb anim block in `animate()`), `HighlightManager.ts`.
**Deps:** AGT-003, AGT-004, INT-002. **Edges:** multiple orbs on one building — offset orbit phases (already
hash-phased) and stack tooltips by nearest-hit only. **Tests:** state→visual mapping table (pure).
**Accept:** each §10 state visually distinct in one screenshot; no flicker on state transitions.
**Size:** S–M. **Parallel:** with AGT-004. **Checkpoint:** `feat: orb state visuals`.

---
**AGT-006 — Hook & docs update (SETUP.md, AGENTS.md, README)**
**Outcome:** agents (and users configuring hooks) know how to emit v2 heartbeats. **Tech:** Update
`AgentContext.ts` SETUP.md template: v2 invocation with `--id "$CLAUDE_SESSION_ID" --state --tool --file`,
example PreToolUse/Stop hook JSON, note that `--stop` marks complete. Update `heartbeat.js` header comment,
`VaultAgentSetup.ts` AGENTS.md section, README.
**Files:** `AgentContext.ts`, `VaultAgentSetup.ts`, `scripts/heartbeat.js` comments, `README.md`.
**Deps:** AGT-001 final schema. **Accept:** following SETUP.md verbatim from a fresh Claude Code session
produces a named, stateful orb. **Size:** S. **Parallel:** yes. **Checkpoint:** `docs: heartbeat v2 usage`.

---
**AGT-007 — Deterministic conflict engine**
**Outcome:** internal; conflicts computed. **Tech:** New
`packages/obsidian-plugin/src/monitors/ConflictDetector.ts`, pure function
`detectConflicts(sessions: AgentSession[], projects: ProjectData[]) → ConflictRecord[]` (§7.6), run on each
registry emit (throttled 2s). Checks (all deterministic): (1) `same-file` — two active sessions whose
`filesTouched` intersect on ≥1 path; (2) `overlapping-files` — intersection ≥3 or ≥30% of either set
(tunable consts); (3) `same-project` — two active sessions, same project (informational); (4) `stale-context`
— session active AND project `hasUncommittedChanges` was true at `startedAt` snapshot (registry records
weather snapshot at session start when available) — phrased as "started on a dirty tree"; (5)
`complete-while-conflicted` — session `complete` while project `hasMergeConflicts`. Clobbering (audit item)
needs no check — structurally eliminated by AGT-001.
**Files:** new `ConflictDetector.ts`. **Deps:** AGT-003. **Schema:** §7.6. **Edges:** file paths from
different agents may be relative vs absolute — normalize against project dir before intersecting; dedupe
conflict records by stable key so UI doesn't flicker. **Tests:** full unit matrix per check, incl. path
normalization. **Accept:** synthetic session fixtures produce exactly the expected records.
**Size:** M. **Parallel:** yes (pure module). **Checkpoint:** `feat: conflict detector`.

---
**AGT-008 — Conflict presentation**
**Outcome:** conflicts are visible in-scene and actionable in the inspector. **Tech:** `same-file` /
`overlapping-files`: red pulsing arc between the two orbs (reuse `showLinkArcs` tube mechanics via EdgeManager
once EDG-001 lands; pre-EDG interim: dedicated `conflictArcs` array in SceneManager, same pattern as
`linkArcs`) + both host buildings get `warning:high` visual channel. All conflict types: rows in city-overview
inspector and in each affected project's inspector (message per §7.6, action buttons: focus other project /
open note). Feed into TRI-001's warning stream.
**Files:** `SceneManager.ts`, `HypernovumView.ts`, `HighlightManager.ts`. **Deps:** AGT-007, INT-002.
**Edges:** conflict between agents on the SAME building → ring highlight instead of arc. **Accept:** two live
Claude sessions touching one file produce a visible red link within ~2 polls. **Size:** M. **Parallel:** no
(SceneManager/View). **Checkpoint:** `feat: conflict presentation`.

---
**AGT-009 — Inspector "Agents" section**
**Outcome:** selecting a project shows its active + recent agents. **Tech:** In `updateInspector()`: section
listing registry sessions for the project — name, state chip, action, current file, started-ago; completed
sessions from the last 24h shown collapsed ("2 completed sessions"). City overview gets fleet summary line
(N active / M waiting / K conflicts).
**Files:** `HypernovumView.ts`. **Deps:** AGT-003. **Accept:** matches registry within one poll; empty state
("No agent activity") when none. **Size:** S. **Parallel:** after AGT-003. **Checkpoint:** with AGT-008.

## Phase 3

---
**TRI-001 — Warning model + aggregator**
**Outcome:** internal; one ranked warning list. **Tech:** New
`packages/obsidian-plugin/src/monitors/WarningAggregator.ts`: pure
`computeWarnings(projects, sessions, conflicts) → WarningItem[]` (§7.7) implementing the §11 catalog with
severity precedence and per-project cap (max 1 shown per project at overview level = highest severity;
full list in project inspector). Recomputed on rebuild + registry emits (throttled).
**Files:** new module. **Deps:** AGT-003/007 for agent warnings (git-only subset has no deps — can land
first). **Schema:** §7.7. **Tests:** full §11 trigger matrix. **Accept:** synthetic fixtures rank as specced.
**Size:** M. **Parallel:** yes (pure). **Checkpoint:** `feat: warning aggregator`.

---
**TRI-002 — Needs-Attention lens + badge**
**Outcome:** one click shows only what needs you, colored by severity. **Tech:** Add `attention` to
`VisualLayer` union + layer dropdown + legend branch (severity ramp: red high / amber medium / slate ok).
Lens behavior: buildings with warnings colored by top severity (via `applyLayerColors` path through
HighlightManager), warning-free buildings dimmed (not hidden — context preserved). ⚠ count badge in command
panel header (visible in every lens), click → switches to attention lens.
**Files:** `HypernovumView.ts` (layer plumbing, legend), `HighlightManager.ts`.
**Deps:** TRI-001, INT-002, ideally PERF-002 (lens switch without rebuild). **Edges:** zero warnings → lens
shows all-dimmed city + "City is healthy" empty state. **Accept:** blocked project + dirty repo + waiting
agent each surface correctly; badge count matches list. **Size:** M. **Parallel:** no (View).
**Checkpoint:** `feat: needs-attention lens`.

---
**TRI-003 — Actionable warning rows**
**Outcome:** every warning is one click from its remedy. **Tech:** City-overview inspector gains "Attention"
section (top 8 by severity, then "+N more"); each row: icon, project, message, action button per §11 (Focus /
Open note / Launch agent / View conflict). Project inspector shows that project's full warning list.
**Files:** `HypernovumView.ts`. **Deps:** TRI-001/002, INT-007. **Accept:** each §11 warning type's action
does what the table says. **Size:** S–M. **Parallel:** no. **Checkpoint:** with TRI-002.

---
**TRI-004 — GitActivityCollector v2: recent commits + ahead/behind**
**Outcome:** inspector shows last 3 commit subjects and branch drift. **Tech:** Add to collector (same
`Promise.all`): `git log -3 --format=%h%x09%ct%x09%s` → `recentCommits[]`; `git rev-list --count
--left-right @{upstream}...HEAD` → `{behind, ahead}` (null when no upstream — common for local-only repos;
show nothing rather than a warning). Extend `WeatherData` additively. Render in inspector Git section.
**Files:** `GitActivityCollector.ts`, `types.ts`, `HypernovumView.ts`. **Deps:** none (parallel-safe).
**Edges:** detached HEAD (`branch --show-current` empty — already handled); shallow clones (rev-list may
error → null). **Perf:** +2 git calls per project per rebuild; keep 8s timeout; consider collector-level
concurrency cap of 8 simultaneous project scans (currently unbounded `Promise.all` over all projects —
add `p-limit`-style tiny semaphore inline). **Tests:** parser unit tests on fixture strings.
**Accept:** inspector shows subjects + relative times; no upstream → row absent. **Size:** S–M.
**Parallel:** YES. **Checkpoint:** `feat: git recent commits + drift`.

---
**TRI-005 — Recent activity feed**
**Outcome:** city overview answers "what happened lately". **Tech:** Overview inspector section: top 5 of
(projects by `lastCommitDate` desc within 7d, merged with agent sessions completed <24h) — "pardesco-web —
commit 'fix cart' · 2h ago", "polytope — Claude session complete · 40m ago". Pure render from existing data.
**Files:** `HypernovumView.ts`. **Deps:** TRI-004, AGT-003 (optional rows degrade gracefully).
**Accept:** feed present, sorted, relative-timed; empty state clean. **Size:** S. **Parallel:** no.
**Checkpoint:** with TRI-003.

---
**TRI-006 — Open Terminal action**
**Outcome:** right-click / inspector → shell in project dir, no agent. **Tech:**
`TerminalLauncher.openShell(projectPath)`: Windows `wt -d <path>` fallback `cmd /k` with cwd (no command);
macOS omit `&& ${command}`; Linux drop the `bash -c run` wrapper, use plain interactive shell flags.
Menu + inspector buttons.
**Files:** `TerminalLauncher.ts`, `HypernovumView.ts`. **Deps:** none. **Tests:** arg-construction unit tests
(pure portions). **Accept:** opens shell at project dir on Windows (primary platform).
**Size:** S. **Parallel:** YES. **Checkpoint:** `feat: open terminal action`.

---
**TRI-007 — Copy Path action**
**Outcome:** context menu + inspector copy the resolved project dir. **Tech:** `navigator.clipboard.writeText
(resolveProjectPath(project))` + Notice. **Files:** `HypernovumView.ts`. **Deps:** none. **Accept:** clipboard
holds absolute path. **Size:** S. **Parallel:** yes. **Checkpoint:** with TRI-006.

---
**TRI-008 — Add Quest action**
**Outcome:** add a research question to a project from the city. **Tech:** Menu/inspector → small modal (reuse
`FolderInputModal` pattern) → `app.fileManager.processFrontMatter(file, fm => push to questions[])`. Rebuild
picks up the gem automatically via MetadataExtractor.
**Files:** `HypernovumView.ts`. **Deps:** none. **Edges:** `questions` as string vs array (parser handles
both; writer normalizes to array). **Accept:** quest gem appears ≤2s after add. **Size:** S. **Parallel:** yes.
**Checkpoint:** `feat: add quest action`. *(See U5 — confirm wanted.)*

---
**LENS-001 — Saved lens presets**
**Outcome:** named one-click views; 3 shipped defaults. **Tech:** `LensPreset` (§7.8) in plugin settings.
Command panel: preset dropdown (Defaults: **Active Work** = layer status + statusFilter active; **Needs
Attention** = layer attention; **Agents** = layer status + edges agent-working-on once EDG lands, pre-EDG:
status + links off) + "Save current view…" (name modal) + delete on custom presets. Applying a preset sets
the existing filter/layer state and calls the (post-PERF-002 incremental) refresh.
**Files:** `HypernovumView.ts`, `SettingsTab.ts` (optional management list), `types.ts` (plugin-side).
**Deps:** PREP-004; TRI-002 for the attention default (ship preset disabled until lens exists if sequenced
earlier). **Edges:** preset referencing a category that no longer exists → filters fall back to 'all' silently.
**Tests:** preset apply/serialize round-trip (pure). **Accept:** presets survive reload; defaults present on
fresh install. **Size:** M. **Parallel:** semi (View). **Checkpoint:** `feat: saved lens presets`.

---
**PERF-001 — Search debounce**
**Outcome:** typing is smooth. **Tech:** Debounce the search `input` handler 200ms (Obsidian's `debounce`
util, already imported in MetadataExtractor).
**Files:** `HypernovumView.ts` (~line 1048). **Deps:** none. **Accept:** one rebuild per pause, not per key.
**Size:** S. **Parallel:** yes. **Checkpoint:** `perf: debounce search`.

---
**PERF-002 — Incremental visibility instead of full rebuild**
**Outcome:** filter/lens/search changes feel instant; layout stops jumping. **Tech:** THE structural decision:
today `applyFiltersAndRebuild` re-packs districts from the filtered set, so filtering *changes layout*.
New model: **layout from `allProjects` once per vault change; filters toggle visibility.** Split into
`rebuildCity()` (vault data changed → full BinPacker + buildCity as today, using allProjects) and
`applyView()` (filters/search/lens changed → per-building `setVisible(path, bool)` on SceneManager (mesh +
foundation + wireframes + label + hit pads via a per-project object registry — introduce
`Map<path, BuildingParts>` built during `createBuilding`, replacing the scattered `scene.traverse` moves too),
then `HighlightManager.applyLayerColors`, then edges refresh). District outlines of fully-hidden categories
dim to 25%. Behavior change (accepted): filtered-out buildings leave gaps instead of re-packing — this is
*better* (spatial memory preserved) and matches saved-layout semantics. `MetadataExtractor` continues to
trigger full `rebuildCity()`.
**Files:** `HypernovumView.ts` (`applyFiltersAndRebuild` split), `SceneManager.ts` (`BuildingParts` registry,
`setVisible`), `HighlightManager.ts`. **Deps:** INT-002 (registry doubles as its target index). **Edges:**
weather application must follow visibility (hidden buildings skip); selection of a hidden building → clear;
NEURAL LINKS arcs filter to visible pairs. **Perf targets:** §13. **Tests:** visibility-set diff logic (pure);
manual FPS check per §13. **Accept:** lens/filter/search switch <50ms at 100 projects, no geometry disposal in
profile; Save Layout unaffected. **Size:** L. **Parallel:** no (SceneManager+View). **Checkpoint:** two
commits: `refactor: BuildingParts registry`, `perf: incremental visibility`.

---
**PERF-003 — Enforce maxBuildings**
**Outcome:** oversized vaults degrade predictably. **Tech:** After parse, if `allProjects.length >
maxBuildings`: keep top-N by (priority desc, lastModified desc), show persistent notice "Showing N of M —
raise limit in settings". **Files:** `HypernovumView.ts`. **Deps:** none. **Accept:** synthetic 400-project
vault renders the cap. **Size:** S. **Parallel:** yes. **Checkpoint:** `fix: enforce maxBuildings`.

---
**PERF-004 — Honor enableShadows**
**Outcome:** the existing setting works. **Tech:** `initRenderer` reads `options.settings.enableShadows`;
skip `castShadow/receiveShadow` when off. **Files:** `SceneManager.ts`. **Deps:** none. **Accept:** toggle +
view reload changes shadows. **Size:** S. **Parallel:** yes. **Checkpoint:** `fix: honor enableShadows`.

## Phase 4

---
**EDG-001 — GraphEdge model + EdgeManager**
**Outcome:** internal; one edge pipeline. **Tech:** `GraphEdge` (§7.3) in `types.ts`. New
`core/src/scene/EdgeManager.ts` owning all inter-building arcs: build from `GraphEdge[]`, per-type style
(§7.3 table), direction shown by animated dash flow from→to (reuse DataArtery's dash shader on tube geometry;
undirected = no flow) or static arrowhead cone at 0.8t for cheap mode; per-type visibility set;
`setEdges(edges)`, `setVisibleTypes(types)`, `highlightForPath(path)`, `dispose()`. SceneManager's
`showLinkArcs`/`clearLinkArcs`/`linkArcs` migrate into it (conflict arcs from AGT-008 too).
**Files:** new `EdgeManager.ts`, `types.ts`, `SceneManager.ts`, `index.ts`. **Deps:** INT-002.
**Schema:** §7.3. **Perf:** rebuild edges only on data change; cap rendered edges (§13). **Tests:** style
mapping + endpoint resolution (pure parts). **Accept:** backlinks render identically to today when only
`backlink` type enabled. **Size:** M–L. **Parallel:** no (SceneManager). **Checkpoint:** `feat: EdgeManager`.

---
**EDG-002 — Backlink migration**
**Outcome:** invisible (parity). **Tech:** `computeLinkEdges()` returns `GraphEdge[]` (`type: 'backlink'`,
`direction: 'undirected'`, `source: 'deterministic'`, weight = count); `LinkEdge` kept as deprecated alias.
**Files:** `HypernovumView.ts`, `types.ts`. **Deps:** EDG-001. **Accept:** QA parity with links-on baseline
screenshot. **Size:** S. **Parallel:** no. **Checkpoint:** with EDG-001.

---
**EDG-003 — blocked-by relationships**
**Outcome:** `blocked_by: ["[[Other Project]]"]` frontmatter renders as a directed red-amber edge and feeds
warnings. **Tech:** `ProjectParser` parses `blocked_by`/`blockedBy` (wikilink or plain title/path); resolve
against project set at edge-build time (unresolved → `WarningItem` type `broken-link`, low severity);
`WarningAggregator` upgrades project's blocked warning with "blocked by X". SCHEMA.md updated.
**Files:** `ProjectParser.ts`, `HypernovumView.ts` (edge build), `WarningAggregator.ts`, `SCHEMA.md`.
**Deps:** EDG-001, TRI-001. **Edges:** self-reference ignored; case-insensitive title match; multiple
blockers. **Tests:** parser + resolution matrix. **Accept:** frontmatter edit → edge within 2s.
**Size:** S–M. **Parallel:** parser part yes. **Checkpoint:** `feat: blocked-by edges`.

---
**EDG-004 — Dependency scanner + cache**
**Outcome:** local projects that depend on each other get directed `depends-on` edges automatically.
**Tech:** New `packages/obsidian-plugin/src/monitors/DependencyScanner.ts` per §12: reads each project's
manifest(s), matches against sibling projects (by package name and by normalized `projectDir` for `file:`/
workspace deps), returns `DependencyScanResult` (§7.9). Cache keyed by manifest mtime; scan piggybacks the
existing per-project pass in `buildCity()` (same place GitActivityCollector runs), throttled to one full scan
per rebuild. Also supports explicit frontmatter `depends_on:` (same resolution as blocked_by) for
non-npm projects — cheapest correct answer for Python/Blender/art repos.
**Files:** new `DependencyScanner.ts`, `HypernovumView.ts` wiring, `SCHEMA.md`.
**Deps:** EDG-001 (rendering); scanner logic standalone. **Schema:** §7.9. **Edges:** §12 failure table.
**Perf:** ≤1 manifest read per project per rebuild, mtime-cached. **Tests:** fixture manifests (npm dep on
sibling by name, file: path, workspace:*, missing manifest, malformed JSON, name collision).
**Accept:** two real repos with a name-match dependency show a directed edge. **Size:** M–L.
**Parallel:** YES (pure module + fixtures). **Checkpoint:** `feat: dependency scanner`.

---
**EDG-005 — agent-working-on edges**
**Outcome:** active sessions appear as typed edges (Neural Core → building), making "Agents" lens/filter
coherent. **Tech:** Registry snapshot → `GraphEdge[]` (`type: 'agent-working-on'`, from `'core'` sentinel to
project path); EdgeManager renders as the existing cyan stream style (visual continuity with today's artery;
the legacy single `streamingArtery` path retires — `startStreaming` calls route through EdgeManager).
**Files:** `HypernovumView.ts`, `EdgeManager.ts`, `SceneManager.ts`. **Deps:** EDG-001, AGT-003.
**Accept:** N active agents → N flowing edges; completion fades. **Size:** S–M. **Parallel:** no.
**Checkpoint:** `feat: agent edges`.

---
**EDG-006 — Edge-type filter UI**
**Outcome:** NEURAL LINKS button becomes a 4-toggle group (Backlinks / Dependencies / Blocked / Agents).
**Tech:** Command panel chip row; state in view (+ saved into LensPreset.edgeTypes). Default: agents on,
others off (matches today's default-off links).
**Files:** `HypernovumView.ts`. **Deps:** EDG-001..005, LENS-001 (preset field). **Accept:** toggles
independent; legend notes active edge types. **Size:** S. **Parallel:** no. **Checkpoint:** `feat: edge filters`.

---
**EDG-007 — Inspector dependency sections**
**Outcome:** project inspector lists Depends on / Used by / Blocked by / Blocks, click-to-focus each.
**Files:** `HypernovumView.ts`. **Deps:** EDG-003/004. **Accept:** rows match edge set; absent sections when
empty. **Size:** S. **Parallel:** no. **Checkpoint:** with EDG-006.

---
**EDG-008 — Neighborhood highlight via typed edges**
**Outcome:** hover/selection brightens all connected edges and neighbors, with dependency direction readable
(upstream vs downstream tint per §8). **Tech:** Upgrade INT-008 + INT-005 connected-set computation to use the
full `GraphEdge` set (visible types only); `EdgeManager.highlightForPath`.
**Files:** `HighlightManager.ts`, `EdgeManager.ts`. **Deps:** EDG-001..006, INT-005.
**Accept:** selecting a project with deps shows green-tinted dependencies and violet-tinted dependents (or
final chosen tints) + labels per INT-006. **Size:** S–M. **Parallel:** no. **Checkpoint:** `feat: typed
neighborhood highlight`.

## Phase 5

---
**IMP-001 — Bounded traversal util**
**Outcome:** internal. **Tech:** `core/src/graph/traverse.ts`: `collectImpact(edges, startPath, {maxDepth: 3,
maxNodes: 50}) → TraceImpactResult` (§7.10) — BFS both directions over directed types (`depends-on`,
`blocked-by`), visited-set cycle protection, per-node depth + direction tags, truncation flags.
**Files:** new pure module + tests. **Deps:** EDG-001 types only. **Tests:** cycles, diamonds, depth caps,
disconnected. **Accept:** unit matrix green. **Size:** S. **Parallel:** YES. **Checkpoint:** `feat: graph
traversal util`.

---
**IMP-002 — Trace-impact mode**
**Outcome:** right-click → "Trace impact": upstream/downstream light up, everything else dims, inspector lists
affected projects with depth + any active agents on them; Esc exits. **Tech:** Store gains
`traceImpact: {origin, result} | null`; HighlightManager renders (origin = selected style; downstream
dependents = warning-amber tint; upstream dependencies = info-blue tint; per §8); EdgeManager highlights path
edges; inspector section lists nodes (grouped by direction, sorted by depth) with agent chips from registry;
"N truncated" row when capped.
**Files:** `HypernovumView.ts`, `HighlightManager.ts`, `EdgeManager.ts`, store. **Deps:** IMP-001, EDG-008,
AGT-003. **Edges:** origin with zero edges → Notice "No known dependencies or dependents"; lens switch during
trace → trace persists (it's an overlay), cleared on Esc/new selection. **Accept:** bounded, readable, exits
cleanly. **Size:** M. **Parallel:** no. **Checkpoint:** `feat: trace impact`.

---
**SES-001 — JSONL session events**
**Outcome:** internal telemetry file per session. **Tech:** heartbeat gains `--log` mode: append
`ActivityEvent` (§7.5b) lines to `<vault>/.hypernovum/sessions/<sessionId>.jsonl` (append-only `fs.appendFileSync`
— atomic enough for single-writer-per-session lines <4KB); events: `session-start`, `ping` (sampled: only when
project/tool/file/state changes, not every heartbeat), `stop`. Prune files >7d (writer-side, same pattern as
AGT-001). **Files:** `scripts/heartbeat.js`. **Deps:** AGT-001. **Schema:** §7.5b. **Tests:** concurrent
append integrity; sampling logic. **Accept:** a session yields a small parseable JSONL. **Size:** S–M.
**Parallel:** YES. **Checkpoint:** `feat: session event log`.

---
**SES-002 — Session digest in inspector**
**Outcome:** "Last session: Claude Code · 34m · 6 files · 2 commits" per project. **Tech:** Registry (or a
lazy reader on inspector open — decision: lazy on inspector open to avoid polling cost) parses the most recent
JSONL for the project: duration = last-first ts; distinct files; commits = `git log --since=<start>
--until=<end> --count` via collector call.
**Files:** `AgentRegistry.ts` or new `SessionReader.ts`, `HypernovumView.ts`, `GitActivityCollector.ts`
(one helper). **Deps:** SES-001, AGT-003, TRI-004. **Edges:** clock drift between event ts and git ts —
±60s slack on the window. **Accept:** digest matches a scripted synthetic session. **Size:** M.
**Parallel:** partly. **Checkpoint:** `feat: session digest`.

---
**SES-003 — Plan-vs-action lite**
**Outcome:** when an agent voluntarily declared intent, show drift: "planned 3 files · touched 11".
**Tech:** heartbeat accepts `--objective` and `--planned-files "a,b,c"` (documented in SETUP.md as optional);
digest compares declared vs observed `filesTouched`. If absent → section absent. NO parsing of transcripts,
NO inference. **Files:** `scripts/heartbeat.js`, `SessionReader`, `HypernovumView.ts`, `AgentContext.ts` docs.
**Deps:** SES-002, AGT-006. **Accept:** with fields: comparison renders; without: nothing renders.
**Size:** S. **Parallel:** yes. **Checkpoint:** `feat: plan-vs-action lite`.

## Phase 6

---
**BLD-001 — TowerLoft generator**
**Outcome:** none until gated on. **Tech:** New `core/src/renderers/TowerLoft.ts`: pure
`loftTower(params: TowerLoftParams) → THREE.BufferGeometry` per §7.11. Pipeline: sample profile (superellipse
`n∈[2,5]` M points, or polygon m sides with edge interpolation) → per-floor ring i∈[0,N): scale
`s(v) = (1 - τv + β·sin(πv)) − waistGauss(v) − crownSmoothstep(v) − Σ setbacks S(v)`, rotate
`θ(v) = Θ·smoothstep(v)`, offset centerline `C(v)` (cubic-smoothstep lean or single-S curve) → quad strip
between consecutive rings (two triangles per quad, indexed), roof cap (triangle fan; polygon profiles get flat
planar cap) → `uv = (j/M, i/(N-1))` → `computeVertexNormals()` (flat-shading friendly; polygon profiles use
non-indexed duplication per facet for crisp facets — flag `facetedNormals`) → bottom-anchored (base ring at
y=0; matches BuildingFactory convention; `createBuildingGeometry`'s re-anchor pass tolerates either).
Hard clamps inside the function: twist ≤120°, waist depth ≤0.10, lean ≤0.12·H, taper ∈[0, 0.35], sides ∈[3,12],
floors ∈[3,40], M ∈[8,32]. Invalid params clamp + `debugLog` — never throw.
**Files:** new file + `index.ts` export. **Deps:** PREP-002 only. **Schema:** §7.11. **Tests:** BLD-002.
**Accept:** generates all four §7.11 presets without NaN, degenerate triangles, or non-finite normals.
**Size:** L. **Parallel:** YES — fully. **Checkpoint:** `feat: TowerLoft generator`.

---
**BLD-002 — Geometry invariant tests**
**Outcome:** none. **Tech:** vitest over the generator: (1) vertex count = expected f(M,N); (2) all positions
finite; (3) bounding box height = floors·floorHeight ±ε and base at y=0; (4) UV v strictly increasing per ring,
u∈[0,1]; (5) no zero-area quads at max-clamp params; (6) determinism (same params → identical buffer);
(7) clamp behavior (twist 500° → 120°); (8) footprint at every floor within base footprint × (1+β) (raycast/
hit-pad safety). **Files:** `packages/core/test/towerloft.test.ts`. **Deps:** BLD-001.
**Accept:** matrix green across the 4 presets × 3 sizes. **Size:** M. **Parallel:** yes.
**Checkpoint:** with BLD-001.

---
**BLD-003 — Category presets + data mapping**
**Outcome:** none until gate on. **Tech:** `TOWER_PRESETS: Record<category, PresetFn>` mapping project →
params: floors = `clamp(round(height / 2.5 * detailScale), 4, 28)` seeded from existing BinPacker height
(priority preserved as overall height — **existing visual encoding unchanged**), profile/twist/waist/lean per
preset family: A spiral (web-apps), B sculpted waist (content, desktop-apps), C leaning S-curve
(visualization, art), D faceted octagon + setbacks (infrastructure, trading). Unmapped categories keep
`BuildingFactory` fallback exactly as classic. Per-project determinism via existing seeded-PRNG pattern
(small jitter on twist/waist within clamps keyed by path). *(Preset↔category assignment is an art-direction
call — see U2; implement behind constants that are trivial to retune.)*
**Files:** `TowerLoft.ts` or sibling `TowerPresets.ts`. **Deps:** BLD-001. **Tests:** preset params always
inside clamps for boundary ProjectData. **Accept:** four visually distinct families at three priorities each
(screenshot set for review). **Size:** M. **Parallel:** yes. **Checkpoint:** `feat: tower presets`.

---
**BLD-004 — buildingStyle gate + wiring**
**Outcome:** setting "Building style: Classic / Parametric (beta)" switches silhouettes; classic is default
and pixel-identical to before. **Tech:** `createBuildingGeometry` branches on
`settings.buildingStyle === 'parametric'` → preset lookup → `loftTower` (fallback to classic path for
unmapped/error); SettingsTab row with "reload view" note (consistent with shader toggles). Foundation +
hit-pad sizing reuse `project.dimensions` (loft respects the same width/depth envelope — guaranteed by
BLD-002 invariant 8).
**Files:** `SceneManager.ts`, `SettingsTab.ts`, `types.ts` (done in PREP-004). **Deps:** BLD-003, INT-002
(soft). **Edges:** shader mode × parametric (BLD-005), bloom, weather — all orthogonal channels, verify via
checklist. **Accept:** toggling produces both cities; classic diff vs baseline screenshots = none.
**Size:** S–M. **Parallel:** no (SceneManager). **Checkpoint:** `feat: parametric building gate`.

---
**BLD-005 — Shader floor-truth + diagrid**
**Outcome:** in parametric mode, lit windows = actual floors; optional diagrid facade on preset D.
**Tech:** Add uniforms `uFloors` (0 = legacy auto-density → existing clamp path, preserving classic behavior)
and `uDiagrid` (0/1 + density) to `building.frag`; when `uFloors > 0`: `windowRows = uFloors`, cols stay
scope-derived; diagrid = two `fract(k·(u ± v·slope))` line families multiplied into wall color.
`BuildingShader.createMaterial` gains optional params from the preset.
**Files:** `building.frag`, `BuildingShader.ts`, `SceneManager.ts` (pass floors). **Deps:** BLD-004.
**Edges:** shader-compile test must still pass with new uniforms (update `testCompilation` uniform set).
**Accept:** parametric+shader tower shows exactly N window rows; classic mode unchanged (uFloors=0 path).
**Size:** M. **Parallel:** semi. **Checkpoint:** `feat: floor-true windows + diagrid`.

---
**BLD-006 — Geometry cache + rooftop compatibility**
**Outcome:** rebuilds stay fast in parametric mode. **Tech:** Module-level `Map<paramsHash, BufferGeometry>`
with clone-on-use (geometry is shared-safe if never mutated per-instance — buildings translate via mesh
position; the one mutation risk is `createBuildingGeometry`'s translate → do the bottom-anchor inside
loftTower and return clones or unique instances per building… **decision: cache the generated arrays, return
fresh BufferGeometry per call sharing attribute buffers is fragile in three — cache full geometry and
`.clone()` per building**; measure — at ≤300 buildings generation may be cheap enough to skip cache; keep
cache behind a simple const flag and record numbers). Verify `RooftopFactory` safe radius
(`min(w,d)·0.18`) sits inside every preset's top-floor footprint at max taper+twist (add invariant test);
pointed-category exemption list unchanged.
**Files:** `TowerLoft.ts`, `RooftopFactory.ts` (test only unless violated). **Deps:** BLD-004, PREP-003
numbers. **Accept:** 250-project parametric rebuild within §13 target. **Size:** S–M. **Parallel:** yes.
**Checkpoint:** `perf: towerloft caching`.

## Phase 7

---
**HRD-001 — Full regression + perf verification** — run PREP-001 checklist (updated for new behaviors) on
Windows; §13 scenarios at 25/100/250; 4 concurrent synthetic agents (script spawning heartbeat writers);
record results in `docs/PERF-BASELINE.md` v2. **Deps:** all. **Size:** M. **Parallel:** no.

**HRD-002 — Corrupt-data hardening** — fuzz tests: truncated/garbage agent JSON, JSONL with torn last line,
manifest JSON with BOM/comments, missing dirs, permission errors — all degrade silently to skip+debugLog, one
aggregated "degraded data" low-severity warning when >0 skips. **Deps:** AGT-002, EDG-004, SES-002.
**Size:** S–M. **Parallel:** yes.

**HRD-003 — Settings round-trip & migration tests** — old `data.json` fixtures (pre-plan, mid-plan) load
clean; unknown keys preserved. **Deps:** PREP-004, LENS-001. **Size:** S. **Parallel:** yes.

**HRD-004 — Deprecation execution plan** — CHANGELOG entries scheduling for NEXT release: remove legacy
single-file heartbeat write-path docs, remove dead core exports (per PREP-005), remove `LinkEdge` alias.
Nothing removed in THIS release. **Size:** S.

**DOC-001 — User docs** — README (v2 heartbeat, interaction model, lenses, edges, building styles), SCHEMA.md
(`blocked_by`, `depends_on`, questions writer behavior), controls hint overlay update, legend additions,
settings descriptions. **Deps:** feature freeze. **Size:** M. **Parallel:** yes.

**DOC-002 — Release notes + rollback map** — user-facing notes leading with the click change; table of
feature → setting/flag that disables it (parametric → buildingStyle classic; edges → type toggles off;
attention lens → don't select it; heartbeat v2 → legacy file still honored). **Size:** S.

---

# 7. Data schemas

## 7.1 Graph interaction state (core, zustand vanilla — repurposed `projectStore.ts`)

```ts
interface InteractionState {
  selectedPath: string | null;         // project note path — survives rebuilds
  hoveredPath: string | null;          // building OR foundation hover
  hoveredAgentId: string | null;       // orb hover (mutually exclusive w/ hoveredPath in UI)
  moveModePath: string | null;
  traceImpact: { originPath: string; result: TraceImpactResult } | null;   // Phase 5
  // actions
  select(path: string | null): void;
  hover(path: string | null): void;
  hoverAgent(id: string | null): void;
  enterMoveMode(path: string): void;  exitMoveMode(): void;
  setTraceImpact(t: InteractionState['traceImpact']): void;
  clearSelection(): void;              // clears selected + traceImpact
}
```

## 7.2 Composed visual state (HighlightManager output — per building, per change)

```ts
interface VisualState {
  baseColor: number;            // status OR lens color (lens wins)
  emissiveColor: number;
  emissiveBase: number;         // baseline intensity
  pulseSpeed: number;           // animate() modulates: base + sin(t*speed)*amp
  pulseAmplitude: number;
  opacity: number;              // 1 normal, ~0.35 dimmed
  scale: number;                // 1 normal, 1.04 selected
  edgeGlowOpacity: number;      // wireframe LineSegments
  edgeGlowColor: number;
  glitch: number;               // shader uGlitch / fallback flicker
  decay: number;                // shader uDecay
  dimFactor: number;            // shader uDimFactor (1 = none)
  labelTier: 'always' | 'normal' | 'hidden';
}
```

## 7.3 GraphEdge

```ts
type EdgeType = 'backlink' | 'agent-working-on' | 'depends-on' | 'blocked-by';

interface GraphEdge {
  from: string;                 // project path, or 'core' sentinel (agent edges)
  to: string;                   // project path
  type: EdgeType;
  direction: 'directed' | 'undirected';
  weight?: number;              // backlink count / dep count
  source: 'deterministic' | 'inferred';   // nothing emits 'inferred' yet
  meta?: { agentId?: string; via?: 'manifest' | 'frontmatter' };
}
```

Render styles: `backlink` violet tube, undirected, opacity∝weight (today's look) · `depends-on` teal, directed
flow from dependent → dependency, thin · `blocked-by` red-amber, directed blocker → blocked, dashed ·
`agent-working-on` cyan dash-flow (today's artery look), core → building.

## 7.4 Agent heartbeat v2 — strategy comparison and choice

| Strategy | Pros | Cons |
|---|---|---|
| 1. One file per agent **session** (snapshot, atomic rename) | No locks; writer owns its file; reader = list+parse; natural stale expiry per file; trivially debuggable | Directory listing each poll (cheap); prune needed |
| 2. Append-only JSONL events | Full history; great for telemetry | Presence requires tail-scan/compaction; unbounded growth; wrong shape for "current state" |
| 3. Locked shared aggregate file | Single read | No reliable cross-process file lock in portable Node on Windows without native deps; the exact failure mode we're fixing |
| 4. Directory of atomic snapshots keyed by agent (not session) | Like 1 | Same agent CLI running two sessions collides; session identity is the truer key |

**Choice: Strategy 1** (per-session snapshot files, atomic tmp+rename) for *presence*, plus Strategy 2 JSONL
per session for *telemetry* (Phase 5) where history is the point. Fits a local desktop app: no daemon, no
locks, crash-tolerant (a dead session simply goes stale), Windows-safe.

```ts
// <vault>/.hypernovum/agents/<sessionId>.json   (atomic tmp+rename)
interface HeartbeatSnapshotV2 {
  version: 2;
  sessionId: string;            // stable per session (--id, e.g. $CLAUDE_SESSION_ID)
  name: string;                 // "Claude Code"
  agentType?: string;           // 'claude' | 'codex' | 'agy' | custom
  project: string | null;       // name or path hint
  state: 'starting'|'planning'|'reading'|'editing'|'running'|'testing'|'reviewing'
        |'waiting'|'blocked'|'complete'|'failed';   // explicit; may be absent → inferred
  action: string | null;        // human phrase
  tool?: string | null;
  file?: string | null;         // most recent file (project-relative preferred)
  objective?: string;           // optional, SES-003
  plannedFiles?: string[];      // optional, SES-003
  sessionStart: number;         // epoch ms
  lastPing: number;
  branch?: string;              // optional working-tree snapshot info
  dirtyAtStart?: boolean;
}
```

**Migration path:** new heartbeat.js writes only v2. `ActivityMonitor` reads v2 dir *and* legacy
`.hypernovum-status.json` (existing users' hooks keep working unmodified — their old script copies still write
the legacy file, which still renders as the anonymous `'legacy'` agent exactly like today). SETUP.md/AGENTS.md
teach the v2 invocation; legacy read support scheduled for removal one release later (HRD-004).

## 7.5 Agent session (registry) & activity event

```ts
interface AgentSession {
  sessionId: string; name: string; agentType?: string;
  projectPath: string | null;          // resolved to a ProjectData.path
  state: AgentState;                   // §10 (derived ⊇ explicit)
  action: string | null; tool?: string | null; file?: string | null;
  filesTouched: Map<string /*projectPath*/, Set<string>>;
  sessionStart: number; lastPing: number;
  dirtyAtStart?: boolean;
  legacy: boolean;
}

// 7.5b — <vault>/.hypernovum/sessions/<sessionId>.jsonl
interface ActivityEvent {
  t: number; sessionId: string;
  kind: 'session-start' | 'ping' | 'stop';
  project?: string; state?: string; tool?: string; file?: string;
  objective?: string; plannedFiles?: string[];
}
```

## 7.6 Conflict record

```ts
type ConflictKind = 'same-file' | 'overlapping-files' | 'same-project'
                  | 'stale-context' | 'complete-while-conflicted';
interface ConflictRecord {
  key: string;                          // stable dedupe key (kind + sorted ids + path)
  kind: ConflictKind;
  severity: 'high' | 'medium' | 'info';
  sessions: string[];                   // sessionIds involved (1 or 2)
  projectPaths: string[];
  files?: string[];                     // offending intersection (capped list)
  message: string;                      // human sentence
}
```

## 7.7 Warning item

```ts
interface WarningItem {
  key: string;
  projectPath: string | null;           // null = vault-level (e.g. degraded data)
  type: 'merge-conflict'|'agents-same-file'|'agent-failed'|'blocked'|'agent-waiting'
       |'uncommitted'|'behind-upstream'|'stale-project'|'stale-agent'|'broken-link'
       |'degraded-data';
  severity: 'high' | 'medium' | 'low';
  message: string;
  action: { label: string; kind: 'focus'|'open-note'|'launch-agent'|'open-terminal'|'show-conflict' };
}
```

## 7.8 Lens preset

```ts
interface LensPreset {
  id: string; name: string; builtIn?: boolean;
  layer: VisualLayer;                   // includes 'attention'
  statusFilter: string; priorityFilter: string; categoryFilter: string;
  searchQuery?: string;
  edgeTypes: EdgeType[];                // Phase 4; pre-Phase-4: [] | ['backlink']
}
```

## 7.9 Dependency scan result

```ts
interface DependencyScanResult {
  projectPath: string;
  manifest: string | null;              // absolute manifest path found
  manifestMtime: number | null;         // cache key
  dependsOn: { targetPath: string; via: 'manifest' | 'frontmatter' }[];
  errors: string[];                     // parse failures etc. (→ degraded-data)
}
```

## 7.10 Trace-impact result

```ts
interface TraceImpactResult {
  origin: string;
  upstream:  { path: string; depth: number }[];   // dependencies
  downstream:{ path: string; depth: number }[];   // dependents
  edges: GraphEdge[];                              // path edges for highlighting
  truncated: boolean;
}
```

## 7.11 TowerLoft parameters

```ts
interface TowerLoftParams {
  profile:
    | { kind: 'superellipse'; a: number; b: number; n: number /*2–5*/; samples: number /*8–32*/ }
    | { kind: 'polygon'; sides: number /*3–12*/; a: number; b: number };
  floors: number;            // 3–40 discrete floor plates
  floorHeight: number;       // world units (≈2.5 to match BinPacker stories)
  taper: number;             // τ 0–0.35
  bulge?: number;            // β 0–0.08
  twistDeg?: number;         // Θ 0–120, cubic smoothstep distribution
  waist?: { depth: number /*≤0.10*/; at: number /*0.45–0.7*/; width: number /*0.12–0.25*/ };
  crown?: { reduction: number /*≤0.20*/; start: number /*0.75–0.9*/ };
  lean?:  { dx: number; dz: number /*≤0.12·H total*/; sCurve?: boolean };
  setbacks?: { at: number; depth: number /*0.04–0.12*/ }[];   // ≤4
  facetedNormals?: boolean;  // crisp polygon facets (preset D)
}
```

Presets: **A Spiral** superellipse n=3.5, twist 65°, taper 0.22 · **B Sculpted** superellipse n=4, waist 6% @
0.6, crown 12% · **C Curved** ellipse (n=2), lean 6% S-curve, taper 0.20, twist 10° · **D Faceted** octagon,
twist 30°, taper 0.25, 2 setbacks, faceted normals + diagrid.

---

# 8. Visual-state precedence model

Channel ownership — highest listed wins per channel; unlisted states inherit:

| Priority | State | baseColor | emissive | opacity | outline | scale | anim | label |
|---|---|---|---|---|---|---|---|---|
| 1 | Move mode | – | max bright | – | bright | – | none | always |
| 2 | Selected | – | +boost | 1.0 | bright, white-shifted | 1.04 | gentle | always |
| 3 | Hovered | – | +boost | 1.0 | +boost | – | none | always |
| 4 | Conflict (agents) | – | red channel via glitch=0.4 | – | red | – | fast pulse | always |
| 5 | Warning high (merge conflict / blocked / agent failed) | – | – | – | – | – | glitch/pulse (existing) | always |
| 6 | Trace: origin/upstream/downstream | tint overlay | – | 1.0 | tinted | – | – | always |
| 7 | Connected (to selected/hovered) | – | +small | 0.85→1.0 | +small | – | – | normal |
| 8 | Search/filter excluded | (hidden entirely — PERF-002 visibility, not a dim state) | | | | | | |
| 9 | Dimmed (focus/trace active, unrelated) | – | ×0.3 | 0.35 | ×0.3 | – | suppressed | hidden |
| 10 | Lens color (git/tasks/recency/stack/attention) | **owns baseColor** | per lens | – | – | – | weather anims | normal |
| 11 | Weather (churn/stale/decay) | – | warm shift / decay | – | – | – | overheat pulse | normal |
| 12 | Status (default) | **owns baseColor when no lens** | status baseline | 1.0 | status opacity | 1.0 | status pulse | normal |

Notes: quest gems and resolution bursts are *satellite objects*, not building channels — they persist through
all states except `hidden`. Agent orbs never dim (they are the point of the scene). Warning severity uses the
already-distinct channels (glitch, beacon, pulse) so it composes with lens colors rather than fighting them.

Resolver pseudocode:

```ts
function resolve(path): VisualState {
  let s = statusBaseline(project);                       // 12
  if (activeLens !== 'status') s = applyLens(s, lensColor(path));   // 10 (owns baseColor)
  s = applyWeather(s, weather(path));                    // 11 (emissive/glitch/decay channels)
  if (focusActive || traceActive) {
    if (isOrigin(path))        s = applySelected(s);     // 2/6
    else if (inTrace(path))    s = applyTraceTint(s, dir(path));    // 6
    else if (isConnected(path))s = applyConnected(s);    // 7
    else                       s = applyDimmed(s);       // 9
  }
  if (hasConflict(path))       s = applyConflict(s);     // 4 (after dim: conflicts pierce dimming)
  if (hovered === path)        s = applyHover(s);        // 3
  if (selected === path)       s = applySelected(s);     // 2
  if (moveMode === path)       s = applyMoveMode(s);     // 1
  s.labelTier = labelTier(path, s);
  return s;
}
// applied on state change only; animate() modulates emissive around s.emissiveBase
```

---

# 9. Interaction specification

| Action | Behavior |
|---|---|
| Hover building/foundation | Tooltip (existing content) + hover visual state; if edges visible, connected edges brighten and neighbor labels appear. No camera or layout change. Cleared on hover-out. |
| Hover moves A→B | A's hover state fully restored (via resolver re-resolve), B applied — no residue. |
| Hover agent orb | Agent tooltip (name/type/state/project/action/file/age). Building tooltip suppressed while orb hovered. |
| Single-click building | `select(path)`: selected visual, dim-unrelated, inspector shows project, camera unchanged. Idempotent on re-click. |
| Double-click building | Opens the note (`openLinkText`) in another leaf. Selection remains (city stays focused when you come back). |
| Right-click building | Menu: Launch <agent> · Inspect · Move building · Trace impact (P5) · Open folder · Open terminal · Copy path · Add quest · Open note · Focus camera. |
| Click empty ground | Clear selection + trace; exit move mode if active. Block-drag handles, orbs, Neural Core: not "empty." |
| Escape | Priority: exit move mode → clear trace → clear selection → nothing. (Canvas-focus-gated.) |
| Enter move mode | Context menu only. Indicator "MOVE — drag to reposition · Esc to exit." Selection preserved. |
| Select while filters active | Only visible buildings are clickable (hidden have no meshes/visible=false excluded from raycast targets). |
| Change lens while selected | Lens recolors base; selection/dim overlay persists on top (resolver order). |
| Select project with active agents | Inspector shows Agents section; orbs stay bright while rest dims. |
| Click warning row | Executes its action (focus = select + `focusOnPosition`). |
| Click a dependency edge | Out of scope (edges not raycast targets this initiative — hover/selection reach them through endpoints). |
| Trace impact | From context menu on selected/right-clicked building; overlays trace tints; inspector lists results; Esc or new selection exits. |
| Return from opened note | City leaf state untouched (selection, camera, lens persist — all view-local). |
| Zoomed out | Label policy (INT-006): only selected/hovered/warning labels beyond distance threshold. Overlapping labels: accepted at MVP; density policy is the mitigation (no collision solver — non-goal). |

---

# 10. Agent lifecycle specification

States: `starting, planning, reading, editing, running, testing, reviewing, waiting, blocked, complete,
failed, stale, disconnected`.

**Derivation (in order):**
1. Explicit `state` field in a fresh snapshot wins (fresh = lastPing ≤ 10s, the existing idleTimeout).
2. Else inferred from `tool`/`action` keywords on fresh pings: Edit/Write/NotebookEdit → `editing`; Read/Grep/
   Glob → `reading`; Bash/PowerShell → `running`; keyword "test" in action → `testing`; else `editing`-agnostic
   `running`.
3. Ping age 10s–120s → `waiting` (agent alive but not tooling — thinking or awaiting user input; visually
   amber). *Assumption to validate: Claude Code hooks fire on tool use only, so long thinking looks like
   waiting. Acceptable ambiguity; documented.*
4. Ping age 120s–15min → `stale` (grey, no orbit). 15min+ → `disconnected` → session removed from scene
   (file remains until writer-side prune at 24h; registry drops it).
5. `--stop` → `complete` (green, fades 60s, row persists in inspector 24h). `--state failed` or
   `--state blocked` → red until stale.
6. Legacy single-file agents: id `legacy`, name from settings' agent or "Agent", no state field → rules 2–4
   only; rendered like today plus tooltip with what's known.

**Overlap detection:** `filesTouched` accumulates every distinct `file` value per (session, project),
normalized project-relative. Conflicts per §7.6; a conflict clears automatically when one session goes
stale/complete (recompute on registry emit). Manual dismissal: not in MVP (records are recomputed, not
persisted; dismissal would need a suppression list — deferred).

---

# 11. Warning and triage model (v1 catalog)

Severity ramp: **high** (red, glitch/beacon channels) → **medium** (amber) → **low** (slate note, never
animated). Overview shows each project's top warning only; caps: 8 rows + "+N more." All recomputed (not
persisted); no dismissal state in v1 except `stale-project` snooze (see row).

| Warning | Trigger | Sev | Visual | Inspector message | Action |
|---|---|---|---|---|---|
| Merge conflict | `hasMergeConflicts` | High | existing glitch + attention red | "Merge in progress / conflicted" | Open terminal |
| Agents same file | ConflictRecord same-file | High | red orb arc + building pulse | "Claude and Codex both touched src/x.ts" | Show conflict (focus both) |
| Agent failed | state failed | High | red orb | "<name> reported failure" | Open note / terminal |
| Blocked project | status blocked (+ blocked_by edge later) | High | existing red + edge | "Blocked" / "Blocked by <X>" | Focus blocker (if known) |
| Agent waiting | state waiting >2min | Med | amber orb pulse | "<name> may be waiting on input" | Focus |
| Overlapping file sets | ConflictRecord overlapping-files | Med | amber arc | "Sessions overlap on N files" | Show conflict |
| Uncommitted changes | `hasUncommittedChanges` ∧ no fresh agent on project (an agent mid-work legitimately has a dirty tree) | Med | attention amber | "Uncommitted changes" | Open terminal |
| Behind upstream | `behind > 0` (TRI-004) | Med | attention amber | "Branch N behind upstream" | Open terminal |
| Stale project | status active ∧ untouched >30d | Low | existing decay | "No activity for N days" | Open note. Snooze: none in v1 — mitigated by Low severity never outranking. |
| Stale agent heartbeat | state stale | Low | grey orb | "<name> heartbeat stale" | — |
| Broken blocked_by link | EDG-003 resolution failure | Low | — | "blocked_by target not found: X" | Open note |
| Degraded data | skipped agent/manifest files >0 | Low | — | "N unreadable data files (see console)" | — |
| Missing project instructions | *Excluded from v1* — vault-level AGENTS.md already solves this; per-project nag judged low-value noise for this audience. | | | | |

Anti-overwhelm rules: Low never contributes to the ⚠ badge count (badge = high+medium only); attention lens
colors by top severity; per-project single-row rule at overview.

---

# 12. Dependency-scanning design

**Sources (v1):**
1. `package.json` at `resolveProjectPath(project)` root: `dependencies` + `devDependencies` matched against
   sibling projects by (a) sibling's own manifest `name`, (b) `file:`/`link:` paths resolving into a sibling's
   `projectDir`, (c) `workspace:*` within a shared workspace root.
2. Workspace metadata: root `package.json` `workspaces` globs / `pnpm-workspace.yaml` when a project dir is
   itself a workspace root — members that are also Hypernovum projects get `contains`-like `depends-on` edges
   from root project to members (modeled as depends-on; no new type).
3. Explicit frontmatter `depends_on: ["[[Other Project]]"]` — covers Python/Blender/art/anything (this vault's
   reality: many non-npm projects — per project inventory, frontmatter is the primary cross-language answer;
   `requirements.txt`/`pyproject.toml` parsing is **deferred** unless U-review says otherwise).

**Matching:** build an index {manifestName → projectPath, normalizedProjectDir → projectPath} once per scan;
match against it; externals (react, three, …) are simply absent from the index → ignored (never rendered).
**Cache:** per-project `DependencyScanResult` keyed by manifest path + mtime; scan runs during `rebuildCity()`
alongside GitActivityCollector; no file watching beyond the existing rebuild triggers.
**Failure handling:** malformed JSON/missing files → `errors[]` → single degraded-data warning; never throw.
**Cycles:** allowed in data (A↔B renders two directed edges); traversal handles cycles (IMP-001).
**Limits:** one manifest read per project per rebuild; index build O(N); no recursive directory scans.
**User overrides:** frontmatter `depends_on` adds edges; explicit `no_deps: true` frontmatter suppresses
manifest scanning for a project (escape hatch, documented in SCHEMA.md).

---

# 13. Performance plan

Benchmark scenes (via PREP-003 generator): **S25** (25 projects, 5 categories), **M100** (100 projects, 10
categories, 30 with git repos, backlinks ~80 edges), **L250** (250 projects, deps ~150 edges, 4 synthetic
agents pinging at 1Hz).

| Operation | Current behavior | Target |
|---|---|---|
| Search keystroke | full rebuild per key | ≤1 refresh per 200ms pause; refresh <50ms @ M100 (PERF-001+002) |
| Lens/filter switch | full rebuild | <50ms @ M100, <150ms @ L250, zero geometry disposal (PERF-002) |
| Hover update | material writes, tooltip DOM | <2ms, zero allocation in raycast path (reuse arrays) |
| Focus/selection change | n/a today | resolver + apply <10ms @ L250 |
| Label visibility tick | none (all visible) | 4Hz tick <1ms @ L250 |
| Heartbeat poll | 1 file read / 500ms | ≤33 file reads / 500ms @ 32-session cap; parse <2ms total |
| Dependency scan | n/a | <300ms @ L250 cold, <20ms warm (mtime cache) |
| Edge rebuild | n/a (links: full tube rebuild) | <80ms @ 250 edges; hard cap 400 rendered edges + "N hidden" note |
| City init (rebuildCity) | measured in PREP-003 | ≤ baseline +10% after all phases (classic mode) |
| TowerLoft generation | n/a | <150ms @ L250 cold (with or without cache per BLD-006 measurements) |
| Steady-state FPS | ~60 (small city) | ≥50 @ M100, ≥30 @ L250, bloom on |

Full-scene-reconstruction elimination: PERF-002 is the structural fix; remaining full rebuilds only on vault
metadata change (already debounced 2s) — acceptable.

---

# 14. Testing strategy

Current state: **zero tests, no runner.** Smallest sufficient infrastructure: vitest (PREP-002), node
environment, two test projects; no Obsidian mocking (plugin UI stays manual via checklist); no visual
regression tooling (screenshot comparison stays manual against `docs/qa-baseline/`).

| Layer | What | Tasks |
|---|---|---|
| Unit (pure) | click state machine, store transitions, resolver precedence matrix (§8 as table-driven test), state derivation (§10), conflict matrix, warning matrix (§11), lens preset round-trip, dependency matching, traversal (cycles/depth), TowerLoft invariants, git output parsers, heartbeat arg parsing | INT-003, INT-001/002, AGT-003/007, TRI-001, LENS-001, EDG-004, IMP-001, BLD-002, TRI-004, AGT-001 |
| Integration (process) | concurrent heartbeat writers (4 procs × 25 pings, torn-JSON check), JSONL append integrity, prune behavior | AGT-001, SES-001 |
| Schema/migration | settings default-merge with old data.json fixtures; v2+legacy monitor merge | PREP-004, AGT-002, HRD-003 |
| Corrupt data | fuzz fixtures per HRD-002 | HRD-002 |
| Performance | scripted scenario timings recorded to PERF-BASELINE.md (manual run, committed numbers) | PREP-003, HRD-001 |
| Manual/visual | QA checklist + baseline screenshots per phase gate | PREP-001, every phase end |

Known limitation (accepted): `SceneManager`/`HypernovumView` integration paths are exercised manually only;
mitigation is keeping new logic in pure modules those classes merely call.

---

# 15. Migration and backwards compatibility

| Asset | Guarantee |
|---|---|
| Saved layouts (`blockPositions`) | untouched; PERF-002 keeps layout from allProjects so offsets still apply |
| Project frontmatter | purely additive (`blocked_by`, `depends_on`, `no_deps`); existing notes need nothing |
| Building silhouettes | classic default; parametric opt-in; classic path code-frozen during Phase 6 |
| Heartbeat | legacy file read forever *this release*; existing hook configs work unchanged (as the anonymous agent, same as today); v2 opt-in via updated SETUP.md; legacy read removal earliest next release (HRD-004) |
| Backlink arcs | identical render via EdgeManager (EDG-002 parity screenshot) |
| Lens/settings | additive keys with defaults; old data.json loads clean (tested) |
| Click/move expectations | **intentional break**: click no longer opens; double-click no longer moves. One-time notice on first view open post-update ("Click selects · Double-click opens · Move via right-click"), `interactionHintShown` flag; controls hint overlay updated; release notes lead with it. Rollback: none (no legacy-interaction setting — maintaining two interaction models is worse than the one-time relearn; flagged in U1 for approval). |
| Status color unification | classic non-shader buildings get the (brighter) shader palette — release-notes line item |

---

# 16. Risks and mitigations

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R1 | HighlightManager refactor regresses weather/glitch/pulse visuals | M | H | §8 test matrix; per-behavior QA screenshots before/after; migrate in two commits (skeleton → weather) |
| R2 | Shared-material mutation bugs (materials are per-building today — keep it that way; cache clones in BLD-006 clone geometry, never materials) | M | M | invariant: one material instance per mesh; review checklist item |
| R3 | Label clutter at 100+ projects | M | M | INT-006 policy + L250 manual review in HRD-001 |
| R4 | Raycast overhead growth (orbs + hit pads + buildings) | L | M | explicit target arrays (already the pattern), no recursive scene raycasts |
| R5 | PERF-002 visibility refactor breaks block-drag/save-layout coupling | M | H | BuildingParts registry first (own commit), drag paths re-verified via checklist before visibility change |
| R6 | Concurrent heartbeat writes still collide on exotic filesystems (cloud-synced vaults: Dropbox/OneDrive) | M | M | atomic rename + tolerate ENOENT; reader skips unparseable; document "cloud-sync may delay presence" |
| R7 | Stale sessions linger (crashed agents) | H | L | age-based state ladder (§10) + writer-side prune + reader cap |
| R8 | Corrupt JSON/JSONL crashes poll loop | M | H | try/catch per file (pattern already in monitor), HRD-002 fuzz suite |
| R9 | Dependency false positives (name collisions between local projects) | L | M | exact manifest-name match only; `no_deps` escape hatch; edges are visual, never destructive |
| R10 | Cyclic graphs hang traversal | L | H | visited set + depth/node caps (IMP-001 tests) |
| R11 | Edge soup at dense graphs | M | M | 400-edge cap, type toggles default mostly-off, weight-based pruning note |
| R12 | Agent privacy — heartbeat/file paths land in vault files that could be committed | M | M | `.hypernovum/.gitignore` written by heartbeat (vault root) — verify; SETUP.md warns; only basenames in tooltips (full path in inspector only) |
| R13 | TowerLoft breaks silhouette identity for existing users | L (gated) | M | classic default; screenshots in release notes; per-category presets reviewed by Randall (U2) |
| R14 | Shader/UV regressions from uFloors/uDimFactor/uDiagrid | M | M | `testCompilation` updated; uFloors=0 legacy path bit-exact; QA shader-mode screenshots |
| R15 | Dead-code removal breaks Pro (vendored core tarball) | M | H | Phase 7 deprecation-only; removal next release after Pro sync check (U3) |
| R16 | Interaction change alienates existing users | L | M | one-time hint, docs, release notes; no toggle (see U1) |
| R17 | Two agents editing SceneManager/HypernovumView in parallel | H | M | workstream serialization rule (§4); land INT before AGT-004+/TRI/EDG scene work |

---

# 17. Implementation order and critical path

**Critical path (serial):**
PREP-002 → INT-001 → INT-002 → INT-003 → INT-004 → INT-005 → INT-007 → *(release 0.4.0-beta1)* →
PERF-002 → TRI-001 → TRI-002 → TRI-003 → *(release beta2)* → EDG-001 → EDG-002 → EDG-004(wiring) →
EDG-006/007/008 → IMP-001 → IMP-002 → *(release beta3)* → HRD-001..004 → DOC-001/002 → **0.4.0**.

**Parallel track A (agents — independent until scene wiring):**
AGT-001 ∥ anything → AGT-002 → AGT-003 → [AGT-007 pure ∥ AGT-006 docs] → AGT-004/005/008/009 (needs INT-002
landed; serialize with whatever else is inside SceneManager at the time) → SES-001 → SES-002 → SES-003.

**Parallel track B (buildings — fully independent files):**
BLD-001 → BLD-002 → BLD-003 (all new-file work, start any time after PREP-002) → BLD-004/005/006 after INT-002.

**Parallel small items (any time):** PREP-001/003/004/005/006, PERF-001/003/004, TRI-004/006/007/008,
LENS-001 (after PREP-004), EDG-003 parser half, EDG-004 scanner half.

**Must wait for real-world validation before building on top:**
- AGT v2 field conventions (run real Claude Code hooks for a few days before finalizing AGT-006 docs + SES-003 flags).
- TowerLoft preset↔category mapping (U2 review of BLD-003 screenshots before default-shipping `parametric` anywhere).
- Warning catalog tuning (TRI thresholds) — ship, then adjust from Randall's own vault before release notes freeze.

**Safe incremental release points:** after Phase 1 (beta1 — the interaction milestone), after Phase 2+3
(beta2 — fleet + triage), after Phase 4+5 (beta3 — typed graph), 0.4.0 after Phase 7. Phase 6 attaches to any
beta once BLD-004 lands (it's opt-in).

**First milestone to implement and validate before continuing: Phase 1** (detail in §19).

---

# 18. Definition of done (initiative-level)

- Single-clicking a building never opens a note; it visibly and persistently focuses it; double-click opens;
  Esc/empty-space reliably clears; move mode is reachable only via explicit action.
- A selected project remains visually focused across lens changes and hovers; inspector always matches it.
- Unrelated buildings dim during focus; connected neighbors and their labels stay readable; non-color cues
  (outline/scale/label) distinguish selection.
- Two concurrent agents produce two orbs with correct names, states, tools, and files — zero clobbering
  (verified by the 4-writer concurrency test and a live 2-session manual check).
- Two agents touching the same file produce a visible high-severity conflict within ~2 poll cycles, with a
  working "show conflict" action.
- The Needs-Attention lens + ⚠ badge surface merge conflicts, blocked projects, dirty/behind repos, waiting/
  failed agents — each row actionable in one click; a healthy vault shows a calm "city is healthy" state.
- Search typing causes no full rebuild; filter/lens switches complete within §13 targets; L250 ≥30 FPS.
- `depends-on` and `blocked-by` edges render with visible direction, are filterable by type, appear in the
  inspector, and drive a bounded, cycle-safe Trace Impact with agent-overlap flags.
- Legacy heartbeat users see today's behavior unchanged; v2 SETUP.md instructions produce a named stateful orb
  on a fresh session.
- `buildingStyle: classic` renders pixel-equivalent to the pre-initiative city; `parametric` renders four
  stable, clamped, deterministic tower families whose window rows equal their floor counts in shader mode.
- All new pure logic is unit-tested; `npm test` green; QA checklist pass recorded; settings from any prior
  version load cleanly.

---

# 19. Immediate first implementation batch

**Scope: Phase 0 essentials + Phase 1 core = the interaction foundation.** One coherent, reviewable change
that establishes the store + resolver every later phase depends on.

**Included task IDs:** PREP-002, PREP-004, PREP-006 · INT-001, INT-002, INT-003, INT-004, INT-005, INT-007.
(PREP-001/003/005 run alongside as docs-only commits; INT-006 and INT-008 deliberately deferred to a fast-follow
so this batch stays reviewable.)

**Explicitly excluded:** all AGT/TRI/EDG/IMP/SES/BLD work; label policy (INT-006); hover-neighborhood
(INT-008); PERF-002 (the rebuild-vs-visibility refactor is its own batch); any settings-UI rows beyond schema.

**Files expected to change:**
- `packages/core/src/stores/projectStore.ts` (→ interaction store; deprecated alias kept)
- `packages/core/src/scene/HighlightManager.ts` (new)
- `packages/core/src/scene/SceneManager.ts` (hover/move/weather/layer/animate material writes → resolver;
  double-click move-mode removal; empty-space clear; store wiring)
- `packages/core/src/interactions/Raycaster.ts` (click/dblclick state machine; select/open callbacks)
- `packages/core/src/interactions/KeyboardNav.ts` (Escape)
- `packages/core/src/types.ts` (`STATUS_COLORS`, `buildingStyle` + settings keys, `VisualState` type)
- `packages/core/src/index.ts` (exports)
- `packages/core/src/shaders/building.frag` + `renderers/BuildingShader.ts` (`uDimFactor` uniform)
- `packages/obsidian-plugin/src/views/HypernovumView.ts` (store wiring, dblclick open, context-menu "Move
  building", inspector-via-store, controls hint text, one-time interaction notice)
- `packages/obsidian-plugin/src/settings/SettingsTab.ts` (schema keys only)
- `package.json` / `vitest.config.ts` / new test files

**Tests to add:** store transition tests; click-timing state machine; resolver precedence matrix (§8 rows:
default, lens, weather+lens, hover, selected, selected+hover, dimmed, move-mode, conflict-placeholder);
`STATUS_COLORS` single-source check; settings default-merge round-trip; the three PREP-002 smoke tests.

**Manual validation (against PREP-001 checklist):**
1. Hover: tooltip + highlight identical to baseline; A→B hover leaves no residue.
2. Click: selects (visible), dims others, inspector fills, camera still, note does NOT open.
3. Double-click: note opens once; selection persists; move mode does NOT engage.
4. Right-click → Move building: drag works, grid snap works, Esc exits, cursor states correct.
5. Esc / empty-ground click: full visual restore (screenshot-compare against baseline).
6. Weather lens + git glitch + blocked pulse: visuals match baseline (resolver parity).
7. Block drag + Save Layout: unchanged.
8. Vault mode: unchanged (no agent UI, focus model still applies).
9. One-time hint appears exactly once; controls overlay shows new bindings.

**Acceptance criteria:** all manual checks pass; `npm test` green; grep shows no `emissiveIntensity`/
`material.color`/`material.opacity` writes outside `HighlightManager.ts` + the documented `animate()`
modulation block; no `console.log` in normal operation.

**Suggested commit sequence:**
1. `test: vitest harness + smoke tests` (PREP-002)
2. `feat: settings schema for feature flags` (PREP-004)
3. `chore: gated dev logging + escapeHtml consolidation` (PREP-006)
4. `refactor: central interaction store` (INT-001 — wiring only, zero behavior change)
5. `feat: HighlightManager skeleton — status/hover/status-colors migration` (INT-002a)
6. `refactor: weather, layer colors, move-mode visuals through HighlightManager` (INT-002b)
7. `feat: click-focus / double-click-open interaction model` (INT-003 + INT-007)
8. `feat: explicit move mode, Escape, empty-space deselect` (INT-004)
9. `feat: focus dim/emphasis pass (+uDimFactor)` (INT-005)
10. `docs: controls + release-note draft for interaction change`

---

## Unresolved product decisions requiring Randall's input

- **U1 — Interaction change without a legacy toggle.** Plan ships click-focus default-on with a one-time hint
  and NO "legacy click" setting (two interaction models = permanent test burden). Confirm you're comfortable
  breaking the current single-click-opens habit outright.
- **U2 — TowerLoft preset ↔ category mapping is an art call.** BLD-003 produces a reviewable screenshot set
  before anything defaults; per your workflow (you hand-tune hero visuals), the plan treats the mapping and
  parameter feel as your review gate, not an agent decision. Confirm this gate, and whether `parametric`
  should ever become the default for *new* installs (plan says: stays opt-in this release).
- **U3 — Dead exports vs the published `@hypernovum/core` + Pro's vendored tarball.** Plan deprecates now,
  removes next release. Confirm Pro doesn't consume `FacetFilter`/`QueryEngine`/`VisualEncoder`/`DecayEffect`/
  `GlowManager`/`CityLayoutEngine` from the vendored core before the removal release (a grep in the pro
  monorepo settles it).
- **U4 — Heartbeat v2 location & Claude hook stability.** `.hypernovum/agents/` at the vault root, per-session
  files, `--id "$CLAUDE_SESSION_ID"`. If the Pro app also reads/writes heartbeat state, confirm the OSS format
  choice doesn't need to match a Pro convention first.
- **U5 — "Add quest" action (TRI-008) in or out?** It's the only task that *writes* to note frontmatter from
  the city. Cheap, but confirm you want the city mutating notes at all.
- **U6 — Status-palette unification direction.** Plan adopts the brighter shader palette everywhere (classic
  non-shader buildings get slightly brighter greens/reds). Alternative is the dimmer SceneManager palette.
  Pure aesthetics — your call; default stands unless overridden.
