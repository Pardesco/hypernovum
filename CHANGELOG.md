# Changelog

## 0.5.0 — removal release (unreleased)

A deliberate subtraction pass. Nothing here makes the city do more; it makes
Hypernovum smaller, quieter about your filesystem, and honest about what it
actually ships. Roughly 1,300 lines of source, 250 of CSS, two lenses, one
panel and two command-palette entries are gone.

### Removed — features

- **ABILITIES panel.** It scanned `~/.claude/skills/` — a read of your whole
  home directory, performed by an Obsidian plugin, to populate a list whose
  only action was copying a sentence to the clipboard. **Hypernovum no longer
  reads anything under your home directory.** Skills are still discovered, but
  only inside the vault (`<vault>/.claude/skills/`), and only to tell a
  launched agent what it already has via AGENTS.md.
- **"Available to Install" section.** Copying `npm i -g` one-liners for other
  vendors' CLIs was an advertisement, not a feature. Detection is unchanged:
  agents you don't have still appear in the roster, dimmed.
- **Memory-ready scan lens.** A whole lens keyed to a file
  (`.hypernovum/MEMORY_CONTEXT.md`) essentially nobody creates. The Memory row
  in the project inspector and the tooltip line both stay.
- **"Save view" and "Delete" for lens presets**, and the built-in **"Agents"**
  preset — which set every filter to "all" and was therefore identical to
  *Clear filters*, and had been since it shipped. Presets you saved earlier are
  still listed and still work.
- **Plan-vs-action row.** It rendered only for agents passing
  `--objective`/`--planned-files`, which nothing does. The heartbeat flags, the
  event-log fields and the digest fields are gone with it; the session digest
  line is unchanged.
- **`T`**, an undocumented debug key that triggered a random data-flow
  animation, and the unwired `1`/`2`/`3` keys.

### Removed — internals

- The legacy `.hypernovum-status.json` heartbeat path. Nothing has written that
  file since 0.4.0, but every install still paid a file-existence check and
  parse **twice a second** looking for it.
- Eight unused `@hypernovum/core` modules (`FacetFilter`, `QueryEngine`,
  `DecayEffect`, `GlowManager`, `VisualEncoder`, `projectStore`,
  `CityLayoutEngine`, `MapController`) and the deprecated exports
  `loftTopCenter`, `isParametricCategory`, `setClickHandler`,
  `get`/`setFocusedProject`, `escapeHtml`. **This is a breaking change for
  anything importing core directly**; the plugin itself used none of them.
- `ActivityMonitor.simulateActivity`/`simulateStop` — test hooks with no
  callers that were nonetheless shipping in `main.js`.
- The `NeuralCore` `ERROR` state and the `GraphEdge` `'inferred'` source: both
  declared, neither reachable.

### Fixed

- README and SCHEMA.md corrections: the "Neural Links toggle" is really the
  **Backlinks** chip in the EDGES row (off by default); conflicts surface as
  Attention warnings, not an inspector row; the right-click menu list was
  missing **Set project folder**; and `projectDir` has not fallen back to the
  vault directory since 0.4.0.
- SCHEMA.md now documents the frontmatter aliases the parser has always
  accepted — `quests`/`quests_done`, `blockedBy`/`dependsOn`/`noDeps`,
  `domain` — and that `stage` falls back to `status`.
- The nine settings that only take effect in city views opened afterwards now
  say so.


## 0.4.4 — two rendering fixes (2026-08-03)

### Fixed

- **The city overview never showed the agent fleet.** Orbs, arteries and the
  per-project inspector all tracked live sessions, but the overview panel —
  the one shown when nothing is selected — kept its first, fleet-less render
  forever, because the refresh was gated on having a project selected.
- **Shader compilation is now actually checked.** `renderer.compile()` does not
  throw on a GLSL error, so the guard around it never tested anything and a
  broken shader would have fallen back to plain materials in silence. The
  program's link status is now read directly, which also clears the 12
  `GL_INVALID_VALUE` errors every session logged on its first city build.


## 0.4.3 — whole-vault fallback (2026-08-03)

### Added

- **A vault with no project notes now renders as itself** instead of as an empty
  plane: folders become districts, notes become buildings, height is incoming
  links, and window rows are real checkbox tasks. A banner says what is being
  shown and how to switch. The moment one note is tagged, the city rebuilds in
  project mode on its own — the fallback only ever applies at zero.


## 0.4.2 — parametric buildings by default (2026-08-03)

### Changed

- **Parametric buildings are now the default silhouette set.** Seven families —
  spiral, stacked slabs, telescoping tiers, spire, sheared blade, hex cluster and
  a quiet block — replace the previous set, which was one profile modulated by
  ±12% and therefore invisible at the footprints and floor counts the layout
  actually produces. Existing installs are migrated once; the setting still
  offers **Classic**, whose code path is unchanged, and switching back sticks.
- Buildings gained real lighting, parapets with recessed dark roof decks, and
  perimeter-aware window columns.
- The edge glow no longer overwhelms the buildings it outlines at city zoom.
- The ground grid fades out radially instead of stopping at a drawn circle.

### Removed

- The leaning building family, and the `lean`, `waist`, `bulge` and `crown`
  shape parameters — each was sub-visible at real building sizes.


## 0.4.0 — 3D-IDE overhaul + publish readiness (2026-07-25)

### Fixed — agent presence actually works when installed

- **The heartbeat script now ships with the plugin.** `AGENTS.md`, per-project
  `.hypernovum/SETUP.md`, and the Claude Code hook JSON used to point at
  `<vault>/scripts/heartbeat.js` — a path that only exists in a git checkout of this
  repo, never in an installed plugin. Every agent-presence feature (orbs, fleet
  summary, conflict rings, streaming arteries, session digest, plan-vs-action) was
  therefore inert for anyone who installed Hypernovum normally. The script is now
  embedded in the bundle and written to `<vault>/.hypernovum/heartbeat.js`, and all
  generated docs carry fully-resolved absolute paths. New command:
  **Install agent heartbeat hooks**.
- **The generated Claude Code hook JSON now actually works.** Two long-standing
  bugs in it: `matcher` was an object (`{ "tool_name": ".*" }`) where the hook
  schema requires a string, so the `PreToolUse` entry was silently ignored; and the
  command interpolated `$CLAUDE_SESSION_ID` and `$TOOL_NAME`, which hooks do not
  provide (Claude Code passes `session_id`/`tool_name`/`cwd` as JSON on **stdin**).
  They expanded empty, so the script fell back to a pid-derived id and every ping
  spawned a *new* orb while `Stop` could never close the real session. The script
  gained a `--hook` mode that reads the stdin payload, and the emitted JSON uses
  `matcher: "*"`.
- **Vault mode now genuinely means "no local processes, no reads outside the
  vault".** The first-run consent prompt runs *before* the view opens (it previously
  appeared after `onOpen()` had already started Git scans, the agent-binary probe,
  and the activity monitor). Everything that spawns a process or touches disk
  outside the vault is gated on consent being *granted* — which also covers a leaf
  Obsidian restores at startup without going through the normal open path. In vault
  mode the launch/terminal/folder/context actions are not rendered at all, the
  memory-context probe is skipped, and dependency detection falls back to
  frontmatter `depends_on` instead of reading `package.json` from project folders.
  Turning vault mode off is an explicit opt-in and grants consent, so declining at
  first run is reversible.
- **A project with no `projectDir` no longer resolves to the vault root — or to a
  shared notes folder.** It used to fall back to the vault, so such projects
  reported the *vault's* Git branch/commits/dirty state, opened terminals in the
  vault, and had agent context written into the vault itself. The parent-folder rule
  also meant `Projects/A.md` and `Projects/B.md` both claimed `Projects/`, sharing
  one repo's data between unrelated projects. A folder is now only accepted when it
  carries a project marker (`.git`, `package.json`, `Cargo.toml`, …). Resolution can
  fail, and the inspector says so and offers to fix it. New right-click action and
  command: **Set project folder**.
- **Building tooltips no longer interpolate frontmatter into HTML.** `status`,
  `priority`, and `category` were injected unescaped, so crafted frontmatter could
  execute script in the tooltip. All tooltip and inspector content is now built with
  DOM APIs.
- **The inspector no longer rebuilds itself twice a second.** The fleet poller called
  a full re-render unconditionally, so buttons dropped clicks, text could not be
  selected, and scroll position reset constantly. Renders are now gated on a content
  fingerprint.
- **The render loop pauses when the view isn't on screen.** A collapsed sidebar or
  background tab previously kept a 60fps WebGL scene running until Obsidian
  restarted.
- **Git scanning is per directory, cached, and de-duplicated.** Each scan forks 8
  `git` processes and many notes resolve to the same repo; a large vault previously
  spawned hundreds of redundant processes per rebuild.
- Binary probing uses `execFile`, not a shell, and is skipped entirely unless the
  agent layer is enabled.
- Briefings and snapshots go through the Vault API into a configurable folder, and no
  longer silently overwrite the previous file.
- WebGL being unavailable now shows an explanation instead of a black panel.

### Changed

- **Procedural shaders, bloom, and atmospheric fog are ON by default.** They are the
  product's look, and shipping them off meant a first run resembled nothing in the
  screenshots. Existing installs keep their stored settings. New **Performance mode**
  toggle turns all three off together.
- **The city opens in a main workspace tab** rather than the right sidebar
  (configurable).
- `minAppVersion` is now **1.6.0** — 1.0.0 was never tested against, and the plugin now uses `Vault.process` (1.6+).
- First run asks whether to enable the agent layer; declining starts in vault mode.
- Every HUD action (Save layout, Snapshot, each scan lens, Clear filters, Reset
  camera, Trace impact, Set project folder, cycle blocked/paused) is now a command,
  so it can take a hotkey.
- The WebGL scene honours `prefers-reduced-motion`, not just the stylesheet.
- Command names use sentence case; `Open Code City Dashboard` → `Open code city`.

- **Agent sessions now match their building by working directory**, falling back to
  name matching. Name matching alone required a project's title to equal its folder
  basename, so a project titled "My App" in `my-app/` never got an orb and never
  participated in conflict detection. The heartbeat records `cwd`, and the plugin
  matches it against each project's resolved directory.
- A `Stop` hook no longer wipes a session's identity. It runs with no flags and its
  payload has no tool name, so the final write used to replace the session with a
  nameless "Agent" and null activity, discarding what earlier pings recorded.
- In vault mode, right-clicking a building no longer opens the "create project"
  background menu *as well as* the building menu — that listener was registered
  before the raycaster, so its `defaultPrevented` guard never saw the hit.

### Internal

- `scripts/check-versions.mjs` makes the root `manifest.json` the single source of
  truth for the version and fails the release on drift — the 0.4.0 release commit had
  left the plugin manifest on 0.3.0, which would have failed the release job and the
  Obsidian submission bot.
- CI now typechecks and tests before building; `npm run build:plugin` (esbuild) does
  no type checking, so the plugin package had effectively never been typechecked in CI.
- Internal planning docs moved under `docs/internal/`.
- `AGENTS.md` Rule 3 corrected: `CORE_BUILD_VERSION` is stamped automatically by
  `stamp-build.mjs` and must NOT be hand-edited (doing so breaks the build). The old
  text still described the pre-automation manual constant.

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
