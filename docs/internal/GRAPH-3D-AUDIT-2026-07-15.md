# Hypernovum 3D Graph & Building-Model Audit — 2026-07-15

Scope: the OSS Obsidian plugin in this repo (`packages/core` + `packages/obsidian-plugin`), audited against a
long list of potential graph/agent/building improvements. Recommendations target solo developers, small teams,
and multi-agent "vibe coders" — not enterprise platform teams.

---

## 1. Current feature inventory

Architecture in one paragraph: project notes with frontmatter (`ProjectParser.ts`) become `ProjectData`
(`core/src/types.ts`), `BinPacker.ts` lays them out into category blocks, `SceneManager.ts` (2,481 lines)
renders buildings with category silhouettes (`GeometryFactory.ts`) or status shapes (`BuildingFactory.ts`),
procedural window shaders (`shaders/building.frag`), rooftop greebles (`RooftopFactory.ts`), a Neural Core +
data arteries for live agent activity (`NeuralCore.ts`, `ArteryManager.ts`), and agent presence orbs fed by a
heartbeat status file (`ActivityMonitor.ts`, `scripts/heartbeat.js`). `HypernovumView.ts` (1,713 lines) owns
all HUD/UI: search, filters, 6 scan layers, legend, inspector, agent panel, context menus.

| Feature | Status | Location | Notes |
|---|---|---|---|
| Spatial navigation (pan/zoom, no rotate) | Fully implemented | `SceneManager.initControls` (MapControls), pan clamped in `animate()` | Polar angle locked; right-drag pan, scroll zoom |
| Node selection | Partially implemented | `Raycaster.ts` click → `HypernovumView.selectProject` | Click both selects AND opens the note; **no visual selected state on the building itself** — selection only visible in the inspector panel |
| Node hover | Fully implemented (single node) | `SceneManager.onMouseMove` + `showTooltip` | Emissive bump + rich tooltip (status, git, stack, quests) with leader line. No neighbor/edge highlighting |
| Node labels | Fully implemented | `createSmartLabels` (CSS2D) | Always-on, one per building; no zoom/density culling; `showLabels` setting exists but is not consulted by SceneManager |
| Connections / edges | Partially implemented | `showLinkArcs` + `computeLinkEdges` (backlinks), `ArteryManager` (activity) | Two edge kinds only: undirected backlink arcs (opt-in "NEURAL LINKS" toggle, weight = link count) and transient core→building activity arteries. No types, no direction, no code-level dependencies |
| Project/repo representation | Fully implemented | frontmatter → `ProjectData`; `projectDir` links note → repo on disk | Category = district block, priority = height, scope = footprint, status = color |
| Status indicators | Fully implemented | status color, blocked glitch shader, merge-conflict glitch, critical-priority roof beacon, quest gems, decay/stale dimming | Rich, but several encodings share the red/glow channel |
| Search & filtering | Fully implemented | `HypernovumView.applyFiltersAndRebuild` | Text search + status/priority/category selects; **every keystroke fully rebuilds the city** (dispose + recreate all geometry) |
| Visual lenses ("scan layers") | Fully implemented | `VisualLayer` = status / git / memory / tasks / recency / stack; adaptive legend `renderLegend` | Hard-coded set; not combinable with each other; not persisted as presets |
| Camera controls | Fully implemented | fit-to-city, `focusOnPosition`, animated reset, keyboard `Space` | `focusOnPosition` snaps (not animated) |
| Context menus | Fully implemented | `showBuildingContextMenu`: Launch agent, Inspect, Open folder, Open note, Focus camera; orb menu; vault-mode "create project" | Good foundation for graph-to-action |
| Inspector panel | Fully implemented | `updateInspector` + `renderCityOverview` | Project: status/priority/category/memory, git signals, quests, actions (note/folder/agent/context/focus). City overview: district analytics. No recent-commit list, no changed files, no dependencies |
| Task management | Partially implemented | checkbox/frontmatter task counts → lit-window %, tasks lens | Read-only aggregation; no task creation or listing |
| Notes/documentation | Fully implemented (by design) | Obsidian *is* the notes layer; quests via `questions:` frontmatter | Quest markers + resolution shockwave `flashBuilding` |
| Git status & recent changes | Partially implemented | `GitActivityCollector.ts`: branch, last commit, 7/30d counts, dirty tree, MERGE_HEAD, stale | No commit messages, no changed-file list, no ahead/behind vs main; `staleBranchCount` is a proxy (whole-repo age), not real branch analysis |
| AI-agent visualization | Partially implemented | orbs per agent (`updateAgentPresence`), streaming artery, activity indicator HUD, Neural Core state | Orbs are anonymous — not hoverable, no name/status/tooltip; no per-agent state (planning/waiting/blocked) |
| Agent session management | Partially implemented | `TerminalLauncher` launch per project, agent switcher panel (Claude/Codex/Antigravity/custom), `AgentContext.ts` writes `.hypernovum/SETUP.md` | Launch-only; no session tracking, continuation, or history |
| Agent logs / transcripts | Missing | — | Heartbeat pings are fire-and-forget; nothing persisted |
| Agent-to-project association | Fully implemented | heartbeat `project` field → `findProjectByName` fuzzy match → orb/stream | Fuzzy name matching can mismatch similarly-named projects |
| Multi-agent workflows | Partially implemented | `ActivityMonitor.extractAgents` parses an `agents[]` array | **But `scripts/heartbeat.js` only writes the single-agent format and overwrites the whole file** — two concurrent agents clobber each other's pings. The reader supports fleets; the writer doesn't |
| Notifications / alerts | Present but minimal | Obsidian `Notice` toasts; visual warnings (beacon/glitch) | No actionable warning list |
| Saved layouts / views | Fully implemented | block drag + `blockPositions` in settings, Save Layout button, per-building move mode | Layout only — no saved filter/lens views |
| Performance considerations | Fully implemented (for current scale) | tracked animation arrays (comments note past per-frame-traverse fixes), pixel-ratio clamp, `maxBuildings` setting (not actually enforced anywhere) | Full-rebuild-on-filter is the main scaling cliff |
| Persistence of graph state | Partially implemented | layout offsets persisted; filters/layer/links toggle/selection are session-only | |
| Metadata on nodes | Fully implemented | frontmatter schema (SCHEMA.md, AGENTS.md generator) | stack, health, quests, tasks, projectDir |
| Dead/placeholder code | — | `stores/projectStore.ts` (zustand store — never used), `QueryEngine.ts`, `FacetFilter.ts`, `DecayEffect.ts`, `GlowManager.ts`, `CityLayoutEngine.ts` | Six placeholder modules duplicating logic that lives elsewhere; either wire them up or delete |

---

## 2. Gap analysis (Part 2 items A–O)

| Item | Exists? | User value | Difficulty | Dependencies | Recommendation |
|---|---|---|---|---|---|
| A. Hover neighborhood reveal | Hover highlight + tooltip yes; neighbor reveal no | Medium (only ~dozens of nodes; neighborhoods are small) | Small–Medium | Needs edges visible (currently opt-in backlinks only) | **Near term, scoped**: when links are ON, hovering brightens that building's arcs + endpoint labels, dims others. Skip relationship labels/collision systems |
| B. Persistent click focus mode | Partial: inspector selection exists, no scene focus state | **High** — current model is confused (single-click opens the note, which yanks you out of the city; double-click = move mode) | Small | None | **Near term, top priority.** Click = select/focus (highlight + dim unrelated + inspector), double-click = open note, Esc/empty-click = clear. Move building via context menu instead of double-click |
| C. Typed & labeled connections | No — one undirected type (backlink count) | High for a small set | Medium | Edge data model | **Near term (model), phased (sources).** Minimal set: `links-to` (have), `agent-working-on` (have, implicit), `depends-on` (new: scan `package.json` / manifests across projectDirs — deterministic), `blocked-by` (new: frontmatter `blocked_by: [[Note]]`). Nothing else. Direction + type + source(deterministic/inferred) fields; skip confidence/timestamps for now |
| D. Stronger visual selection states | Weak — hover=emissive, selection=nothing, warnings share red | High | Small–Medium | B | **Near term.** Selected: bright edge glow + slight scale; connected: mid; unrelated: opacity drop. Keep warnings on non-color channels you already have (glitch, beacon) |
| E. Project inspector panel | Yes, good glanceable core | Medium (incremental) | Small | Git collector additions | **Near term additions only**: last 3 commit subjects (`git log -3 --format=%s`), changed-file count, ahead/behind vs default branch, "Open terminal" and "Copy path" actions. Stop before it becomes analytics |
| F. Saved graph lenses | Scan layers = hard-coded lenses; no presets | Medium–High | Small | Settings persistence (exists) | **Near term.** Persist named presets = {layer, filters, links on/off} in plugin settings (per vault). Ship 3 defaults: Active Work, Needs Attention, Agents. Derived-from-current-filters "Save view" button |
| G. Agent activity visualization | Orbs + stream + HUD; anonymous and stateless | **High** — this is the product's differentiator | Small–Medium | Heartbeat schema extension | **Near term.** (1) Fix heartbeat.js to merge into `agents[]` keyed by id instead of overwriting. (2) Orb hover tooltip: name, project, action, file (fields already exist in `ActivityStatus` but are unused). (3) `state` field (working/waiting/blocked/done) → orb color/pulse |
| H. Agent conflict detection | Missing | High for multi-agent users | Small–Medium (deterministic checks only) | G's heartbeat fix; per-agent `file`/`filesTouched` | **Phase 2.** MVP: two fresh agents on same project → red pairing arc + inspector warning; agent active + `hasUncommittedChanges` predating session → "stale context" hint. File-overlap once heartbeat carries `filesTouched[]`. No AI analysis |
| I. Plan-versus-action view | Missing; no telemetry captured | Medium | Medium | Session log (new) | **Phase 3, lite version.** Have heartbeat append JSONL events (`.hypernovum/session-log.jsonl`); inspector shows last-session digest (duration, files touched, commits made during window via git). Do NOT build plan parsing/diffing |
| J. Agent context lineage | Partial — `SETUP.md` records what Hypernovum handed the agent | Low–Medium | Small | None | **Phase 3.** Timestamp/archive SETUP.md per launch (`SETUP-<ts>.md`, keep last N). Full provenance: skip |
| K. Agent handoffs / review chains | Missing; no orchestration exists | Low for this product | Large | Would need real session infra | **Skip** in OSS plugin. Natural fit for HYPERNOVUM Pro if ever |
| L. Blast-radius / trace impact | Missing; no dependency data | Medium–High later | Medium | C's `depends-on` edges | **Phase 3.** Once manifest-scan edges exist, "Trace impact" context-menu action = highlight upstream/downstream + list in inspector. Deterministic only |
| M. Recent activity / timeline | Recency lens exists; no feed/slider | Medium | Small (feed) | Git data (exists) | **Phase 2.** Add "Recent activity" list to city-overview inspector (top commits/modified projects, last 24h/7d). Time slider / replay: skip |
| N. Structural & project warnings | Partial (beacon, glitch, decay, blocked) | High | Small–Medium | Mostly existing data | **Phase 2.** Derived warning list: uncommitted changes (data exists, currently inspector-only), merge conflict, blocked, stale >30d, agent waiting, missing projectDir. Surface as ⚠ count in command panel + "Needs Attention" lens. Every warning must have a click-through action |
| O. AI-inferred relationships | Missing | Low now | Large | Everything else | **Skip for now.** Reserve the convention: solid = deterministic, dashed = inferred, so it can be added without repainting |

---

## 3. Graph-to-action workflows (Part 3)

Already available from the graph: launch agent (building + orb + inspector), open note, open folder, inspect,
focus camera, copy agent-context path, create project (vault mode background right-click).

Add (all fit `showBuildingContextMenu` / inspector actions):
- **Open terminal here** (without launching an agent) — `TerminalLauncher` already knows how; just don't pass the agent command.
- **Copy path** — one-liner, disproportionately useful.
- **Add quest** — modal → append to `questions:` frontmatter; completes the quest loop from inside the city.
- **Ask agent about project** — launch agent with a pre-seeded prompt referencing SETUP.md (small extension of `launchAgentForProject`).
- **Trace impact** — Phase 3, after dependency edges.

Skip: commit-from-graph, run-tests-from-graph (terminal is one action away; test-runner config per project is a rabbit hole for an Obsidian plugin).

---

## 4. The 3D building metaphor (Part 4)

### What's already encoded (a lot)

| Channel | Meaning | Verdict |
|---|---|---|
| Color | Status (or active lens) | Clear, legend-backed |
| Height | Priority | Clear but **arguably wasted** — priority is 4 discrete values; height is the most legible continuous channel |
| Footprint | Scope | Subtle, fine |
| Silhouette | Category (6 mapped shapes) + status fallback | Reads well; helix/ziggurat/shard are distinguishable |
| Lit windows (shader) | Task completion, fill-from-bottom | **Best mapping in the app** — immediately understandable |
| Window grid density | Task/scope count | Currently cosmetic-ish |
| Decay dither / desaturation | Staleness | Good |
| Glitch | Blocked / merge conflict | Good, but two meanings share one effect |
| Roof beacon | Critical priority | Good |
| Quest gem | Open questions | Good |
| Orb | Active agent | Good concept, anonymous today |
| Arcs | Backlinks (violet) vs activity (cyan) | Good color separation |

Verdict: the *encoding vocabulary* is already rich — the geometry carrying it is the weak part, exactly as you
suspected. Do not add more independent channels; upgrade the fidelity of the existing ones.

### Evaluation of the four parametric tower families

The proposed floor-plate lofting approach (superellipse/polygon profile × vertical fields for taper/twist/
waist/lean/setbacks, discrete floors joined by quads) is the right architecture for this codebase, for three
reasons specific to the existing code:

1. **It subsumes what's there.** `createHelixTower` is family 1 done crudely (vertex-twisting a 10-segment
   box — corners shear, no taper); `createZiggurat`/BuildingFactory ziggurat are family 4's setbacks done as
   cylinder hacks / merged boxes. One `TowerLoft` generator replaces both with strictly better output.
2. **UVs fall out for free and make the shader honest.** The loft's parameter grid (u = position around the
   profile, v = floor index / N) is exactly the `vUv` the window shader consumes. Today window rows are an
   arbitrary count clamped 4–20; with a loft, **window rows = actual floor plates**, so "lit floors = completed
   tasks" becomes literally true in the geometry. This is the single biggest realism win.
3. **Floors can be data.** `N = f(scope or totalTasks)`, twist/waist/lean assigned per preset, preset per
   category. Geometry becomes information-bearing instead of decorative — which is the stated product goal.

Recommended implementation (smallest useful version, in `core/src/renderers/TowerLoft.ts`):

- One function: `loftTower(params) → BufferGeometry` where params = `{ profile: {type: 'superellipse'|'polygon', a, b, n|sides}, floors, floorHeight, taper, bulge, twistDeg, waist?: {depth, at, width}, crown?: {reduction, start}, lean?: {dx, dz, curve}, setbacks?: [{at, depth}] }`.
- Discrete floor rings (M profile samples × N floors), quad strips between consecutive rings, cap top. Keep
  floor plates horizontal under lean (offset centerline only) — per the proposal, and it keeps raycasting/
  bounding boxes sane.
- Generate `uv = (j/M, i/(N-1))` — plug-compatible with `building.frag`.
- Four presets mapped to categories: A spiral (web-apps), B sculpted waist (content/desktop), C leaning S-curve
  (visualization or art), D faceted octagon + setbacks (infrastructure/trading). Keep `createDataShard` /
  `createHive` if you like their reads; they're cheap and distinctive.
- Respect the parameter ranges in the proposal (twist ≤ ~110°, waist ≤ 10%, lean 3–12% of height, 6–12 polygon
  sides) — the constraint table is good; encode it as clamps inside the generator so data-driven parameters
  can't produce blob geometry.
- Budget: M=20–28, N=8–24 → ~500–1,300 verts/building. At the realistic 20–100 project scale this is nothing;
  even the `maxBuildings=300` ceiling is fine. Skip LOD.
- Diagrid: do it in the shader (two `fract(u ± k·v)` line families gated by a uniform), not geometry.
- Anchor bottom at y=0 (note: `createBuildingGeometry` in SceneManager already re-anchors via bounding box, so
  either convention works — but emitting bottom-anchored avoids the extra pass).

What NOT to do: per-floor meshes, real mullion geometry, physically separate façade panels, or randomizing all
parameters per building (keep silhouette = category identity; let *data* modulate only floors/lit%/decay).
Also don't drop the BuildingFactory fallback for unmapped categories — the code comment at
`SceneManager.createBuildingGeometry` records that flattening the city to boxes was already reverted once.

---

## 5. Top recommended improvements (prioritized)

1. **Interaction model fix: click = focus, double-click = open** — *Small.*
   UX: click a building → it highlights, unrelated dims, inspector updates, camera stays; double-click opens
   the note; Esc/empty click clears; "Move building" moves to the context menu.
   Why: today single-click navigates away (context switch — the thing the graph exists to reduce) and
   double-click is a hidden move mode. Files: `Raycaster.ts`, `HypernovumView.onOpen` click handler,
   `SceneManager` (new focus/dim pass). Risk: muscle-memory change; mitigate via controls hint update.

2. **Visual selection/focus states** — *Small–Medium.*
   Selected: boosted edge glow + subtle scale; connected (when links on): mid highlight; unrelated: fade
   materials to ~35% opacity. One `HighlightManager` owning all emissive/opacity mutations (today hover, move
   mode, weather, and animate() all fight over `emissiveIntensity` — centralizing prevents state leaks).

3. **Agent presence you can read: fleet-safe heartbeat + orb identity** — *Small.*
   Fix `scripts/heartbeat.js` to read-merge-write an `agents[]` entry keyed by `--id` (the reader already
   supports it; the writer clobbers). Add orb hover tooltip (name, action, file) and a `state` field →
   orb color (working=hue, waiting=amber pulse, blocked=red). This is the "which agent is doing what" feature
   and it's mostly plumbing you already half-built.

4. **Needs-Attention system (warnings lens + feed)** — *Medium.*
   Derive deterministic warnings from data you already collect: blocked, merge conflict, uncommitted changes,
   stale >30d, agent waiting, quest count. ⚠ badge in command panel; "Needs Attention" lens; warning rows in
   city-overview inspector, each with a click-through (focus building / open note / launch agent). This turns
   the city from ambient art into a triage tool.

5. **TowerLoft parametric buildings (the four families)** — *Medium–Large, self-contained.*
   As specified in §4: one loft generator, four category presets, floors = scope/tasks, UV-true window grid.
   Files: new `core/src/renderers/TowerLoft.ts`, wire in `SceneManager.createBuildingGeometry`, keep fallbacks.
   Risk: silhouette changes user-visible identity of the city — ship behind a setting first
   (`buildingStyle: 'classic' | 'parametric'`), consistent with how shaders/bloom/atmosphere are gated.

6. **Saved lenses** — *Small.*
   Named presets = {layer, status/priority/category filters, links toggle} persisted in settings; "Save current
   view" button; 3 shipped defaults. Reuses the existing settings persistence path (`blockPositions` pattern).

7. **Agent conflict detection MVP** — *Small–Medium.*
   With #3 landed: two fresh agents mapped to the same project → red arc between orbs + inspector warning;
   agent active while tree was already dirty at session start → "stale context" note. Deterministic only.

8. **Dependency edges (deterministic) + neighborhood highlight** — *Medium.*
   Scan `projectDir` manifests (package.json deps ∩ other projects' names, workspace configs) on the same cycle
   as `GitActivityCollector`. New `GraphEdge {from, to, type, direction, source}` supersedes `LinkEdge`.
   Render directed `depends-on` visually distinct from violet backlink arcs. Enables hover-neighborhood (A),
   dependents/dependencies in inspector (E), and later blast radius (L).

9. **Inspector: recent commits + open terminal + copy path** — *Small.*
   `git log -3 --format=%s` in the collector; two context-menu/inspector actions.

10. **Recent-activity feed in city overview** — *Small.*
    Top-5 by last commit/modified, with relative times — data already in memory.

---

## 6. Features to avoid or postpone

- **Agent orchestration / handoff chains (K)** — no session infrastructure exists; enterprise-shaped. Pro-tier
  territory if ever.
- **AI-inferred relationships (O)** — cost/noise before deterministic edges exist. Reserve dashed-line styling.
- **Time slider / replay (M)** — high effort, low solo-dev value vs. a recency lens + activity feed.
- **Full plan-vs-action diffing (I)** — telemetry isn't captured; do the JSONL session log first, evaluate later.
- **In-scene CSS3D terminal** (Future Dev.md idea) — postpone; the "Hybrid Shell" recommendation in that same
  doc (city as visual monitor commanding external terminals) is the right call and is what's built.
- **Test/build status collection** — no runner integration exists; don't reinvent CI. Git signals are enough.
- **Complex edge ontology** — the 4-type set above; resist "reads from/writes to/tested by/configured by".
- **More independent geometry channels** — the encoding table in §4 is already at capacity; upgrade fidelity,
  don't add axes.

---

## 7. Recommended implementation order

**Phase 1 — interaction & legibility (items 1, 2, 3, 9):**
click-focus model, selection states via HighlightManager, fleet-safe heartbeat + orb tooltips/states,
inspector commit list + terminal/copy-path actions. Everything here works from existing data.

**Phase 2 — operational graph (items 4, 6, 7, 10):**
Needs-Attention warnings + lens, saved lenses, agent conflict MVP, activity feed. Also: debounce the search
input (currently rebuilds the city per keystroke) before lenses make rebuilds more frequent.

**Phase 3 — structure & intelligence (items 5, 8, then L/I/J lite):**
TowerLoft parametric buildings (can start anytime — it's self-contained in core/renderers and behind a
setting), manifest-scan dependency edges + typed `GraphEdge`, then Trace Impact, session-log digest, SETUP.md
archiving.

---

## 8. Technical recommendations

- **Data model:** add `GraphEdge {from, to, type: 'backlink'|'depends-on'|'blocked-by'|'agent', direction: 'directed'|'undirected', weight?, source: 'deterministic'|'inferred'}` to `core/src/types.ts`; keep `LinkEdge` as a constructor input or migrate `showLinkArcs` to consume `GraphEdge`.
- **Centralize interaction state:** `stores/projectStore.ts` (zustand) exists but is dead code — either make it
  the single owner of {selected, hovered, lens, filters, edges} that both `HypernovumView` and `SceneManager`
  subscribe to, or delete it. Today selection lives in two places (`selectedProject` in the view,
  `focusedProject` in the scene) and hover in a third.
- **SceneManager is a 2,481-line god class** (same failure mode as the polytope viewer.js). Before adding focus
  mode and highlights, extract: `HighlightManager` (all emissive/opacity/scale mutations), and later
  `BlockDragController`. Don't refactor further than the features require.
- **Avoid rebuild-the-world:** `applyFiltersAndRebuild` disposes and recreates every mesh on each filter/search
  change. Short term: debounce search 150–250ms. Medium term: for filter/lens changes keep geometry and toggle
  `visible` + retint; full rebuilds only on vault data changes.
- **Label visibility:** cheap distance culling in `animate()` — hide CSS2D labels beyond a camera-distance
  threshold, always show for selected/hovered/warning buildings. Also actually honor the `showLabels` setting.
- **Heartbeat schema v2:** `{agents: [{id, name, project, action, tool, file, state, filesTouched?, lastPing}]}`,
  writer merges by id, prunes entries stale >60s, `--stop` removes only its own id. `ActivityMonitor` needs no
  changes for the merge; add `state`/`filesTouched` passthrough for #3/#7.
- **Lens persistence:** extend `HypernovumSettings` with `savedLenses: {name, layer, statusFilter, priorityFilter, categoryFilter, showLinks}[]` — same save path as `blockPositions`.
- **Scene readability:** one rule — at most one animated warning channel per building at a time (priority:
  conflict glitch > blocked pulse > overheat > decay). The animate() loop already approximates this; make the
  precedence explicit in one function instead of scattered ifs.
- **Deterministic vs inferred:** solid/additive arcs for deterministic, dashed (or lower-opacity dotted tube)
  reserved for future inferred edges. Document it in the legend.
- **Building geometry:** keep silhouettes deterministic per project path (RooftopFactory's seeded-PRNG pattern
  is the model); clamp all TowerLoft parameters to the realism ranges so no data combination produces
  implausible geometry.

---

## 9. Final product recommendation

**Strongest direction:** the *mission-control room for AI-assisted solo development* — the place you glance to
know which of your 30 projects is hot, blocked, stale, or currently being rebuilt by an agent, and from which
you launch/steer those agents. The city metaphor is the delivery mechanism, not the product.

**Most defensible differentiator:** live multi-agent presence rendered spatially over *your real local repos*
(heartbeat → orbs → arteries → conflicts). Nobody else in the Obsidian or vibe-coding tool space has this, and
the plumbing is 70% built — it needs identity, state, and the fleet-writer fix, not a rethink.

**Most important missing feature:** click-focus with real visual selection states (item 1+2). Every other
improvement renders through this interaction layer; today the graph navigates you *away* on click.

**Most important feature not to overbuild:** agent intelligence (plan-vs-action, lineage, orchestration).
Capture cheap telemetry now, ship deterministic conflict checks, and let the transcript-analysis features stay
in the Pro tier or the future.

**What the IDE should become:** *"Open the city, know in five seconds what needs you, and act without leaving."*
Buildings whose geometry tells the truth (floors = work, lit windows = progress — the TowerLoft upgrade),
orbs that name their agents, a warning lens that triages your week, and one-click paths from any building to
its note, folder, terminal, or agent.
