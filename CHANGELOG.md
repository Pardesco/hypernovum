# Changelog

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
