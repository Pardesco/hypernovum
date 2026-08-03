# Hypernovum 0.4.4 — Feature Bloat Review (2026-08-03)

Scope: the shipped Obsidian community plugin at 0.4.4 (`b721408`+). Two exploration passes fed
this: a complete user-facing feature inventory and a LOC/test footprint map. Numbers below are
from those passes; file:line refs verified against current master.

**Repo under review: ~15,100 source LOC (core 7,181 + plugin 7,947) + 3,200 test LOC + 1,698 CSS.**

---

## TL;DR verdict

The plugin is **not feature-bloated at the product level** — the four big-ticket areas (agent
fleet 26%, buildings/shaders 11%, core city 13%, edges/trace 5%) are all on-positioning and
earning their keep. The bloat is concentrated in three places:

1. **~700 LOC of confirmed dead/unreachable code** that costs maintenance and reads badly in a
   newly-listed community repo (Tier A — delete in 0.5).
2. **A handful of speculative features with near-zero probable usage**: ABILITIES tab, the
   install-pills ad section, memory + stack lenses, saved lens presets, plan-vs-action
   (Tier B — cut or demote, ~600 LOC + real surface reduction).
3. **Surface sprawl**: the quest system alone touches 7 UI surfaces; vault-mode has two
   toggles; post-processing has 5 settings controls; 7 lens commands (Tier C — consolidate,
   don't cut).

Estimated total reduction if Tiers A+B land in 0.5: **~1,300–1,500 source LOC, ~350 CSS lines,
2 commands, 2 lenses, 3 UI panels/sections** — with no loss to the core value proposition.

---

## 1. What is NOT bloat (defended)

These are the expensive areas someone might flag by LOC alone. They stay.

| Area | LOC | Why it stays |
|---|---:|---|
| Agent fleet (heartbeat→orbs→conflicts→digest→launch) | ~3,900 (26%) | This IS the positioning ("Agent Ops for Your Second Brain") and the moat vs every other vault-graph plugin. Also the best-tested area (84 tests). Fully inert behind consent for non-agent users, so it costs them nothing at runtime. |
| Parametric buildings + shaders | ~1,680 (11%) | Just became the default (0.4.2 flip + migration); it's the visual identity in every listing screenshot. 43 tests — largest test cluster. |
| Whole-vault fallback (0.4.3) | ~320 | The single biggest adoption lever — closed the "fresh install shows an empty city" gap. |
| Neural Core + data arteries | ~800 | Pure spectacle, zero tests — but it's the brand look that sells the listing. Keep; add the missing tests someday, not now. |
| Snapshot PNG | ~73 | Cheap, isolated, and every snapshot a user posts is free marketing. |
| Trace impact + typed edges | ~800 | Differentiated, tested (27), on-positioning. One efficiency note in Tier C. |

---

## 2. Tier A — Dead code. Delete in 0.5, no user-facing change.

All verified zero-consumer in this repo. **⚠ One caveat before deleting anything from core:
core is a published npm package vendored into HYPERNOVUM Pro, and Pro was last known to still
use DecayEffect / GlowManager / FacetFilter / QueryEngine / VisualEncoder / createProjectStore.
Grep the Pro monorepo first — `docs/DEAD-CODE.md` already says this.** Deletion from core is a
semver event (0.5 is the scheduled window per CHANGELOG).

| Item | Location | LOC | Notes |
|---|---|---:|---|
| 8 dead core modules (FacetFilter, QueryEngine, DecayEffect, GlowManager, VisualEncoder, projectStore, CityLayoutEngine, MapController) | `docs/DEAD-CODE.md` list; `core/src/index.ts:30–61` | 235 | Tree-shaken from main.js already; cost is repo + npm-package weight. MapController isn't even exported — delete unconditionally. |
| `simulateActivity` / `simulateStop` | `monitors/ActivityMonitor.ts:223,237` | ~20 | "For testing", zero callers in src **and tests**, and they SHIP in main.js. |
| Legacy heartbeat read path | `ActivityMonitor.ts:49,102–104,196–210`; `fleetMerge.ts:105–148`; flag propagation in AgentRegistry/ConflictDetector/WarningAggregator | ~60 | Nothing in 0.4.4 can write `.hypernovum-status.json`; every fresh install pays an `exists()`+parse per 500ms poll for a file that will never exist. Already scheduled for 0.5. |
| Unwired `1`/`2`/`3` jump keys | `core/interactions/KeyboardNav.ts:65–70` | ~10 | `onJumpToProject` never assigned by the view. Dead. |
| `T` = debug random data flow | `KeyboardNav.ts:75–79` → `HypernovumView.ts:2637` | ~8 | A shipped debug key, absent from the controls hint and all docs. Remove (or keep deliberately and document — but remove is right for a listed plugin). |
| Deprecated/no-op exports: `loftTopCenter` (returns constant), `setClickHandler`, `getFocusedProject`, `escapeHtml` (zero refs anywhere), `setDebugLogging`/`setDebugSink`, `isParametricCategory` (always true, 0 prod callers), `severityRank` export | various; `core/src/index.ts` | ~90 | `setFocusedProject` is still called at `HypernovumView.ts:2473` — migrate that one call to the store, then deprecate it too. |
| Orphaned CSS: `.links-toggle` block, the entire `.conflict-row/.conflict-msg/.conflict-dot/.conflict-focus` set, and 6 of 13 `.agent-state-*` chips unstyled | `styles.css:910–934, 1366–1412` | ~160 | The conflict-row CSS is for an inspector section that doesn't exist (README claims it does — see Tier D). Either build the section or delete the CSS; delete. |
| `GraphEdge.source: 'inferred'` | `core/types.ts:87` | 2 | Reserved enum no producer emits. Cheap to keep, but it's a promise the code doesn't keep. |

**Tier A total: ~585 LOC + 160 CSS.** Zero user impact; pure repo hygiene ahead of more eyes
from the community listing.

---

## 3. Tier B — Features not earning their value. Cut or demote.

Ranked by confidence that cutting is right.

### B1. ABILITIES tab — CUT (high confidence)
`utils/SkillsScanner.ts` (69) + `renderAbilities` (40) + CSS (76). Zero tests.

- Reads `~/.claude/skills/` — a **global home-directory scan** from an Obsidian plugin. This
  already bit us once (the screenshot leak of the private skill name) and it's exactly the kind
  of outside-the-vault read that draws scrutiny on a listed plugin. The developer-policy
  disclosure has to carry this feature forever.
- Claude-specific in a roster that advertises three agents.
- The entire payoff is: click → copies `Use the "<name>" skill` to clipboard. That's a
  convenience for a user who already knows their own skills.
- Verdict: **delete the tab and the scanner.** Keep the skills roster in AGENTS.md generation
  if desired (agents benefit from it; humans don't need a 3D-view panel for it) — though note
  that also does the home-dir read, so consider making it vault-skills-only.

### B2. "Available to Install (N)" section with install pills — CUT (high confidence)
`HypernovumView.ts:1012–1050, 1110–1143`, ~80 LOC.

Copying `npm install -g` one-liners for third-party CLIs to the clipboard is an ad surface, not
a feature. A user who wants Codex knows how to install Codex. The roster's greyed-out state
already communicates "not installed". Delete the collapsible section; keep detection + roster.

### B3. Memory lens + `hasMemoryContext` plumbing — CUT the lens, keep the flag (medium-high)
Lens command, legend branch, summary-line count, inspector cell, tooltip line — all keyed off
the existence of `<projectDir>/.hypernovum/MEMORY_CONTEXT.md`, a file only Hypernovum's own
SETUP.md flow ever mentions. Realistic population with this file: approximately Randall.

A whole scan **lens** (1 of 7) dedicated to a binary flag almost nobody has is the definition
of a feature not earning its slot. Keep the inspector Memory cell (cheap, contextual); delete
the lens, its command, its legend branch, and the summary-line count. If memory-context ever
becomes a real workflow, re-add it.

### B4. Tech-stack lens — DEMOTE or cut (medium)
Requires `stack:` frontmatter nobody writes by default; the foundation tooltip already shows
stack on hover. The lens + top-6 legend roster (~60 LOC of the legend's 158) serves the empty
state "No stack declared" most of the time. Weaker cut case than B3 because the data is at
least user-authorable and visible in demo vaults — but if trimming lenses, this is #2. Seven
lenses is a lot of dropdown; five (status / attention / git / tasks / recency) covers real use.

### B5. Saved lens presets (LENS-001) — SIMPLIFY (medium)
`lensPresets.ts` (65) + view plumbing (114) + preset row UI. Save/Delete named view presets is
power-user furniture for a v0.4 plugin whose entire lens state is ~4 dropdowns. And the shipped
evidence argues nobody's using it: **the built-in "Agents" preset is a no-op** (`lensPresets.ts:28–31`
sets layer=status, all filters=all, edgeTypes=[] — functionally identical to Clear filters)
and it shipped that way through four releases without a report.

Minimum action: fix or delete the "Agents" preset (it's advertised in the README). Better:
keep the 2–3 built-ins as plain dropdown entries and delete user save/delete entirely (~150
LOC + UI row). Revisit when someone asks for it.

### B6. Plan-vs-action lite (SES-003) — CUT (medium)
`HypernovumView.ts:2152–2159` + digest fields. Renders only when an agent declared
`--objective`/`--planned-files` to the heartbeat — flags essentially no real agent invocation
passes. ~30 LOC in the view but it holds schema surface in the heartbeat + digest parser that
must be maintained and documented. The session digest line itself (name · duration · files ·
commits) is good — keep that, drop the planned/touched comparison until the heartbeat flow
actually feeds it.

### B7. Daily briefing — KEEP, with a reason attached (leaning keep)
~200 LOC, generator untested, duplicates the overview panel. The one real defense: the 3D view
is **desktop-only**, but the briefing is a plain markdown note that syncs to mobile — it's the
only Hypernovum artifact a phone user can see. That's a genuine niche. Keep it, but it's on
notice: if 0.5 needs room, this is the first Tier B survivor to reconsider. (At minimum give
`BriefingGenerator` a test — it writes files into user vaults with zero coverage.)

**Tier B total if B1–B6 land: ~600 LOC + ~150 CSS, minus 2 lens commands, 2 lenses, the
ABILITIES panel, the install section, and the preset save/delete UI.**

---

## 4. Tier C — Not bloat, but sprawl. Consolidate.

1. **Quest system: 7 surfaces for one small feature (~172 LOC total).** Frontmatter fields →
   gems → shockwave → inspector section → summary count → overview cell → district `◆N` →
   AGENTS.md board → briefing board. The core loop (leave a question, agent answers it,
   emerald shockwave on resolve) is on-brand and cheap — keep it. But the *count* appears in
   four places; the summary line and district `◆N` could go with zero loss. Zero tests on the
   write path (`persistQuest` edits user frontmatter) — that's the real risk, add one test.
2. **Vault mode has two toggles** (settings + a button in the command panel) and the command-
   panel one reloads the whole view. One owner: keep the settings toggle + the command
   palette entry; drop the panel button (`HypernovumView.ts:1630–1635`).
3. **Post-processing = 5 controls** (Performance mode derived toggle + shaders + bloom + bloom
   intensity + fog). The derived "Performance mode" toggle that silently flips three others is
   clever but confusing. Either it's THE control (hide the three behind an "Advanced"
   disclosure) or it goes. Also `bloomIntensity` is the one visual setting that doesn't apply
   live — inconsistent with its siblings.
4. **Structural edges computed eagerly for an off-by-default display.** `computeLinkEdges` +
   `computeStructuralEdges` + DependencyScanner (~258 LOC of work incl. package.json reads
   across all projectDirs) run on every rebuild while `backlink`/`depends-on`/`blocked-by`
   default hidden (`HypernovumView.ts:233`). Compute lazily on first chip activation.
5. **7 lens commands in the palette** (`main.ts:85–91`). If B3/B4 land this drops to 5; fine.
   Not worth a "cycle lens" redesign.
6. **`scripts/heartbeat.js` duplicated into `generated/heartbeatSource.ts`.** This is by
   design (generator input → embedded string) and correct; just make sure the generated file
   stays out of hand-edit reach. No action.

---

## 5. Tier D — Doc/code drift (cheap fixes, listing-facing)

The README **is** the plugin detail page, so these are storefront defects:

1. README claims a "Neural Links toggle" — the actual UI is the EDGES Backlinks chip, off by
   default. Reword.
2. README claims a conflict **inspector row** — doesn't exist (conflicts surface as Attention
   warnings). Reword or build; rewording is free (and delete the orphaned CSS, Tier A).
3. "Agents" built-in preset advertised but is a no-op (see B5).
4. SCHEMA.md: stale "launch opens in the vault directory" fallback (removed in 0.4.0), stale
   action labels, and none of the accepted aliases are documented (`quests`/`quests_done`,
   `blockedBy`/`dependsOn`/`noDeps`, `domain`, `stage` defaulting to `status`). The alias
   support is genuinely good — document it.
5. README's context-menu list omits "Set project folder".
6. NeuralCore ERROR state is defined but unreachable from the plugin — undocumented and
   unused; either wire it (degraded-data → ERROR would be natural) or drop the state.
7. Nine settings apply only on view reopen but don't say so (Show labels, shadows, Max
   buildings, Project tag, Bloom intensity, Output folder, Git layer, view location, Agent).
   One line of setting-description each.

---

## 6. Suggested 0.5 sequencing

1. **Pre-work:** grep HYPERNOVUM Pro for the dead core exports (DecayEffect, GlowManager,
   FacetFilter, QueryEngine, VisualEncoder, createProjectStore) — Pro vendors core and was
   last known to use them. Whatever Pro still uses moves from "delete" to "deprecate + migrate
   Pro first".
2. **Tier A** in one hygiene commit (repo-only, no behavior change) + Tier D doc fixes.
3. **Tier B** as individual commits (each trivially revertible): B1 ABILITIES, B2 install
   pills, B3 memory lens, B5 preset simplification, B6 plan-vs-action. B4 stack lens optional.
4. **Tier C** items 2–4 opportunistically.
5. CHANGELOG 0.5: one honest "Removed" section. A newly-listed plugin shipping a
   removal-and-cleanup release reads as discipline, not churn.

Non-goals confirmed: do not touch the agent fleet, parametric buildings, whole-vault fallback,
Neural Core, or trace/edges — they are the product.

---

## Appendix: footprint snapshot (from the measurement pass)

| Feature area | LOC | % of source | Tests |
|---|---:|---:|---:|
| Agent fleet | ~3,883 | 25.7% | 84 |
| Core city render/layout/camera | ~1,900 | 12.6% | 6 |
| Buildings (parametric + classic + shaders) | ~1,683 | 11.1% | 43 |
| Neural Core + arteries | ~800 | 5.3% | 0 |
| Edges / dependency graph / trace | ~802 | 5.3% | 27 |
| Inspector rendering | ~730 | 4.8% | 4 |
| Drag / move / hover interaction | ~580 | 3.8% | 0 |
| Triage / warnings / lenses | ~565 | 3.7% | 26 |
| District chrome | ~328 | 2.2% | 0 |
| Scan modes + legend | ~320 | 2.1% | 0 |
| Vault parsing + fallback | ~319 | 2.1% | 0 |
| Dead/deprecated/no-op (Tier A) | ~300 | 2.0% | 0 |
| Briefing + snapshot | ~274 | 1.8% | 5 |
| Tooltips | ~199 | 1.3% | 0 |
| Quest system | ~172 | 1.1% | 0 |
| ABILITIES tab | ~109 | 0.7% | 0 |

65% of source LOC has no direct unit test; coverage is concentrated in pure modules (fleet,
towers, warnings) while the two god classes (SceneManager 2,928 / HypernovumView 3,435) are
effectively untested. Not a bloat issue, but it constrains how aggressively Tier C
consolidation inside those files should be batched.
