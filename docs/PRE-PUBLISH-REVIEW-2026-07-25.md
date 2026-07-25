# Hypernovum — Pre-Publish Review (Obsidian Community Plugin)

> **STATUS 2026-07-25: implemented on branch `feat/publish-readiness`.** All P0, P1,
> and P2 items below are done, plus features F2/F3/F5/F6/F7. Verified: `npm run
> typecheck` clean, `npm run build` clean, **261 tests passing** (was 215 — 46 new).
> Not done: **F1 (whole-vault rendering mode)** and **F4 (multi-step onboarding
> overlay)** — F1 is a new product surface rather than a fix, and F4 was partly
> absorbed by the first-run consent modal. See CHANGELOG.md for the user-facing
> summary.
>
> **Five rounds of independent Codex review** ran over the diff; everything it
> confirmed is fixed. Findings this review had missed, surfaced along the way:
>
> - The building tooltip interpolated `project.status`/`.priority`/`.category` into
>   `innerHTML` **unescaped** — a real injection path from crafted frontmatter, not
>   just a style issue.
> - The generated Claude Code hook JSON never worked: `matcher` was an object where
>   the schema requires a string, and it interpolated `$CLAUDE_SESSION_ID` /
>   `$TOOL_NAME`, which hooks don't provide (they get `session_id`/`tool_name`/`cwd`
>   on **stdin**). Both pre-existing; fixing P0-2 without this would have shipped a
>   still-dead feature.
> - Agent sessions matched buildings by *name*, so any project whose title differed
>   from its folder name never got an orb.
> - The parent-folder resolution rule collapsed sibling notes onto one shared
>   directory (`Projects/A.md` and `Projects/B.md` → `Projects/`).
> - `AGENTS.md` Rule 3 was stale, telling agents to hand-edit `CORE_BUILD_VERSION` —
>   which now breaks the build, since `stamp-build.mjs` stamps it automatically.


**Date:** 2026-07-25 · **Reviewed:** `master` @ d85c9c4 (0.4.0 release commit) ·
**Scope:** submission readiness for the Obsidian community plugin directory + feature gaps

**Verified during this review:** `npm test` → 215/215 pass (25 files). `npm run build` → clean.
`npx tsc --build` → clean **after** fixing stale workspace symlinks (see P0-3). Zero network
calls anywhere in `core/src` or `obsidian-plugin/src`.

---

## P0 — Blockers (submission fails, or the feature is dead on arrival)

### P0-1 · Version mismatch will fail the release job and the Obsidian bot

| File | Version |
|------|---------|
| `manifest.json` (repo root) | **0.4.0** |
| `packages/obsidian-plugin/manifest.json` | **0.3.0** ← stale |
| `packages/obsidian-plugin/package.json` | 0.4.0 |
| `packages/core/package.json` | 0.4.0 |
| `versions.json` | has 0.3.0 + 0.4.0 |

The 0.4.0 release commit bumped everything **except the plugin manifest** — which is the one
`.github/workflows/release.yml` validates:

```yaml
MANIFEST_VERSION=$(node -p "require('./packages/obsidian-plugin/manifest.json').version")
if [ "$MANIFEST_VERSION" != "${GITHUB_REF_NAME}" ]; then ... exit 1
```

So `git tag 0.4.0 && git push origin 0.4.0` **fails CI → no release → no assets**. And the
Obsidian validation bot reads the *root* manifest (0.4.0) and demands a GitHub release tagged
exactly `0.4.0` carrying `main.js` + `manifest.json` + `styles.css`.

**Fix:** bump `packages/obsidian-plugin/manifest.json` to 0.4.0, then add a CI guard so the three
version sources can never drift again:

```yaml
- name: Versions agree (root manifest == plugin manifest == package.json == tag)
  run: |
    ROOT=$(node -p "require('./manifest.json').version")
    PLUG=$(node -p "require('./packages/obsidian-plugin/manifest.json').version")
    PKG=$(node -p "require('./packages/obsidian-plugin/package.json').version")
    test "$ROOT" = "$PLUG" && test "$PLUG" = "$PKG" && test "$PKG" = "${GITHUB_REF_NAME}"
```

Better still: make the root manifest the single source and have the build copy it into the plugin
dir, the same way esbuild already copies it to the dev vault.

---

### P0-2 · `scripts/heartbeat.js` does not exist for anyone who installs the plugin

This is the big one. Obsidian's installer downloads **only** `main.js`, `manifest.json`, and
`styles.css` into `.obsidian/plugins/hypernovum/`. It does not clone the repo. But every generated
document tells the agent to run a repo file:

- `VaultAgentSetup.ts:111` → `node "<vault-root>/scripts/heartbeat.js" ...` (written into the
  user's `AGENTS.md`)
- `AgentContext.ts:101,111,132,136` → same path, in the per-project `.hypernovum/SETUP.md` **and**
  in the ready-to-paste `~/.claude/settings.json` hook JSON
- `README.md` → "Heartbeat script (`scripts/heartbeat.js`)"

It only works in your dev vault because your dev vault *is* the repo.

**Consequence:** for every real user, the entire agent-presence layer never fires — agent orbs,
fleet summary, conflict rings, activity indicator, streaming arteries, Neural Core state changes,
session digest, plan-vs-action. That's most of Phase 2/5 and the headline of the positioning
("Agent Ops for Your Second Brain"). Users will paste the hook JSON, see nothing, and uninstall.

**Fix:** embed the script in the bundle and materialise it into the vault.

1. Add an esbuild `text` loader entry for `.js` assets (or keep the script as a template string
   module) and have `prepareVaultForAgents()` write it to
   `<vault>/.hypernovum/heartbeat.js` — creating the dir, overwriting on version change.
2. Point `VaultAgentSetup` + `AgentContext` at that resolved absolute path.
3. Add a version stamp comment so a plugin upgrade refreshes a stale copy.
4. Keep `scripts/heartbeat.js` as the source of truth; add a build step (or a test) asserting the
   embedded copy matches it, so they can't diverge.

While you're there: the plugin already knows the vault path, so generate the hook JSON with the
**final absolute path** rather than a `<vault-root>` placeholder the user has to substitute.

---

### P0-3 · Your local workspace symlinks are dangling — the plugin package has been type-unchecked

```
node_modules/@hypernovum/core     -> /c/Users/Randall/Documents/hypernovum/packages/core        (gone)
node_modules/@hypernovum/obsidian -> /c/Users/Randall/Documents/hypernovum/packages/obsidian-plugin (gone)
```

Left over from the 2026-07-17 move into `hypernovum-suite`. Result: `npx tsc --build` failed with
~40 `TS2307 Cannot find module '@hypernovum/core'` + cascading `TS2339` errors. It went unnoticed
because `npm run build` uses esbuild with an explicit alias to `../core/src/index.ts`, and esbuild
does **zero** type checking.

I re-ran `npm install` — the links now resolve and `npx tsc --build` exits 0. **No real type errors
were hiding.** But the gap is structural:

- `npm run build` = `build:core` (tsc) + `build:plugin` (esbuild). The plugin's types are never
  checked, locally *or* in CI.
- Add `"typecheck": "tsc --build"` to the root scripts and run it in `release.yml` before the
  build, plus a `test` step (CI currently never runs the 215 tests either).
- Add `packages/obsidian-plugin/dist/` to `.gitignore` — `tsc --build` emits there and it currently
  shows up as untracked.

---

### P0-4 · No developer-policy disclosure in the README

Obsidian's developer policies require clear, up-front disclosure of anything that reaches outside
the vault. Hypernovum does a lot of that, and reviewers will find all of it:

| Behaviour | Where | Consent today |
|---|---|---|
| Spawns `git` (8 processes per project, per rebuild) | `GitActivityCollector` | automatic, `enableGitActivity: true` |
| Spawns `where`/`which` through a **shell** for 3 agent binaries | `HypernovumView.ts:767` | automatic on every view open |
| Spawns a terminal emulator + the configured agent CLI | `TerminalLauncher` | user action |
| Reads outside the vault: project dirs, `~/.claude/skills/` | `DependencyScanner`, `SessionReader`, `SkillsScanner` | automatic |
| **Writes** outside the vault: `.hypernovum/SETUP.md` + `.hypernovum/.gitignore` into project dirs | `AgentContext` | user action (Launch agent) |
| Clipboard writes | agents panel | user action |
| Network | — | **none at all** |

**Fix:** add a `## What this plugin does on your machine` section to the README stating exactly the
above, and lead with *"Hypernovum makes no network requests — no telemetry, no analytics, no remote
calls."* That's a genuine advantage; say it plainly and the review gets easier.

Two things to reconsider while writing it:

- The `where claude` / `which claude` probe runs `exec()` with a **shell** automatically whenever
  the view opens. The args are hardcoded so there's no injection, but replace it with
  `execFile('where', [cmd])` (no shell) and it stops being a talking point.
- `vaultMode: false` is the default, so process-spawning behaviour is on out of the box. A first-run
  consent modal ("Hypernovum can read Git metadata and launch terminals — enable, or start in vault
  mode?") turns the single most reviewable thing about the plugin into an explicit user choice.

---

## P1 — Fix before publishing (user-visible defects)

### P1-1 · The inspector rebuilds itself twice a second and drops clicks

`ActivityMonitor` polls every **500 ms** and calls `onFleetUpdate` unconditionally, even with zero
agents. `HypernovumView.ts:2091`:

```ts
// Keep the inspector's Agents section in sync when a project is selected.
if (this.selectedProject) this.updateInspector();
```

`updateInspector()` blows away `inspectorPanel.innerHTML` and re-attaches every listener. So with
any project selected, the panel is destroyed and rebuilt 2×/second, forever. Symptoms users will
report: buttons that "don't work sometimes" (mousedown and mouseup land on different DOM nodes),
text that can't be selected or copied, scroll position snapping back, constant GC churn.

**Fix:** compute a cheap content signature (selected path + fleet signature + warning count +
conflict count + trace id) and return early when unchanged. Or split the volatile Agents/Trace
sections into their own containers and refresh only those. This is item #5 from the 2026-07-15 deep
review — it's the one deferred item that's squarely user-facing.

---

### P1-2 · The render loop never stops, and the view defaults into the sidebar

`SceneManager.animate()` re-arms `requestAnimationFrame` unconditionally; the only stop is
`dispose()` on `onClose`. There's no `visibilitychange` hook, no leaf-visibility check, no
`IntersectionObserver`.

Combined with `main.ts:63` — `this.app.workspace.getRightLeaf(false)` — the default flow is: user
opens Hypernovum in the **right sidebar**, collapses the sidebar, and a 60 fps WebGL scene with
bloom keeps rendering invisibly until Obsidian is restarted. On a laptop that is a fan-spinning,
battery-draining one-star review.

**Fix (both halves):**
- Pause when not visible: `this.registerEvent(this.app.workspace.on('layout-change', ...))` plus a
  `containerEl.isShown()` / `IntersectionObserver` check; skip the rAF re-arm and resume on show.
  Also drop to a low tick rate when the city is idle (no agents, no animations in flight).
- Open in the main workspace instead: `getLeaf('tab')` (or at minimum make it a setting). A 3D city
  in a 300px sidebar is not the product in the screenshots.

---

### P1-3 · Without `projectDir`, every project silently resolves to the vault root

`resolveProjectPath()` falls through: explicit `projectDir` → same-named folder → parent folder →
**vault root**. For a project note sitting at the vault root with no `projectDir` — the default for
anyone who follows the README's "add `tags: [project]` to a note" — priority 3 resolves to the vault
root itself and is rejected, so priority 4 wins.

Downstream effects, all wrong and all silent:
- Every such project reports the **vault's** git branch, commits, and dirty state. If the user
  versions their vault (common), the whole city shows identical git heat.
- "Open terminal" / "Launch agent" / "Open folder" all land in the vault root.
- `generateAgentContext` writes `.hypernovum/SETUP.md` and a `.hypernovum/.gitignore` containing `*`
  into the vault root.
- `hasMemoryContext` becomes all-or-nothing across every project.
- `GitActivityCollector` re-runs its **8 git commands with no cache and no dedup by resolved path** —
  N projects pointing at the same directory means 8N process spawns per rebuild (100 projects → 800
  spawns), throttled only to 8 concurrent by `mapLimit`.

**Fix:**
1. Drop the vault-root fallback, or mark those projects `projectDir: unresolved` and skip git/agent
   features for them with a warning row ("No project folder set — set one to enable Git and agents").
   The `WarningAggregator` catalog is the natural home for this.
2. Dedupe git collection by resolved path and cache results with a short TTL (or key off the repo's
   `.git/HEAD` + index mtime). One scan per directory per rebuild, not one per project.

---

### P1-4 · First run doesn't look like the screenshots

`core/src/types.ts:193` defaults:

```ts
enableShaders: false,
enableBloom: false,
enableAtmosphere: false,
```

The procedural windows, neon bloom, and atmospheric fog — the entire visual identity in the README
images and on the landing page — are all **off** on install. A new user opens a flat grey city and
has no idea three settings away is the thing they installed the plugin for.

**Fix:** default all three on, with `maxBuildings` as the perf guard, and add a "Performance mode"
toggle that flips them off together. If you're worried about weak GPUs, detect once
(`renderer.capabilities` / frame-time sample over the first 2 s) and auto-downgrade with a Notice —
don't ship the good look disabled.

---

### P1-5 · `minAppVersion: "1.0.0"` is a version you have never tested

You develop against the `obsidian` API at **1.12.0** and use `Setting.setHeading()`,
`getRightLeaf()` returning nullable, `revealLeaf()` as async, and `debounce`. Claiming 1.0.0 means
users on 1.0–1.4 install it and get whatever breaks first — most likely a settings tab that throws.

**Fix:** set `minAppVersion` to the oldest version you'll actually smoke-test (1.5.0 is a reasonable
floor; 1.7.x is safer), and mirror it in `versions.json` for the 0.4.0 entry.

---

## P2 — Review friction and polish

**P2-1 · 22 `innerHTML` assignments.** Obsidian reviewers push back on these on principle. Your
escaping is genuinely thorough — `escapeHtml` wraps every interpolated project title, status, path,
commit subject, and quest string I checked, so this is *not* an XSS finding. But expect a review
comment. Convert the ones that interpolate vault content (`updateInspector`, `renderCityOverview`,
`renderDependencySections`, `renderWarningRows`) to `createDiv`/`createSpan`/`createEl`; leave the
static scaffold templates if you want to save time. Bonus: doing this to the inspector makes P1-1's
targeted-refresh fix natural instead of bolted on.

**P2-2 · `(this.app.vault.adapter as any).basePath` in 7 places.** Undocumented internal, and
casting through `any`. Use the public API:

```ts
import { FileSystemAdapter } from 'obsidian';
const adapter = this.app.vault.adapter;
const vaultPath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
```

Then handle `null` instead of getting `undefined` silently threaded into `path.join`.

**P2-3 · Adapter API for user-facing writes.** `BriefingGenerator` (`adapter.write`),
`captureSnapshot` (`adapter.writeBinary`), and `prepareVaultForAgents` (`adapter.write`) all bypass
the Vault API, so Obsidian's index and file events don't fire. Use `vault.create`/`createBinary`/
`modify` (adapter is only justified for the externally-written heartbeat files, where your comment
already explains why). Also: both the briefing and the snapshot hardcode the **vault root** with a
fixed filename — `Hypernovum Snapshot 2026-07-25.png`. Make the target folder a setting, run paths
through `normalizePath` (currently used zero times), and de-duplicate same-day filenames instead of
overwriting.

**P2-4 · Lifecycle registration.** `window.setInterval` in `ActivityMonitor` and ~30 raw
`addEventListener` calls. They're all cleaned up correctly today via `onClose`/`dispose`, so this is
a robustness nit, but `this.registerInterval()` / `this.registerDomEvent()` are what reviewers look
for and they're free.

**P2-5 · Command naming.** `"Open Code City Dashboard"` → sentence case: `"Open code city
dashboard"`. `"Toggle vault mode (pure visualization, no agent features)"` is a sentence, not a
command name — shorten to `"Toggle vault mode"` and let the settings description carry the
explanation. (Obsidian also strips the plugin name automatically, so never prefix it.)

**P2-6 · Inline styles.** `.style.display`, `.style.background`, `.style.borderColor`,
`settingEl.style.display` throughout. Prefer classes and `el.toggle(bool)` / `settingEl.toggle()`.
Same reviewer-checklist category as P2-1.

**P2-7 · Repo hygiene — reviewers browse the repo root.** Currently tracked there:
`GRAPH-3D-IMPLEMENTATION-PLAN-2026-07-15.md` (116 KB), `GRAPH-3D-AUDIT-2026-07-15.md` (28 KB),
`hypernovum-spec-v4-final.md` (37 KB), `CODE-REVIEW-2026-07-02.md`, `Future Dev.md`, plus untracked
`ENGRAM-MEMORY-INTEGRATION-BRIEF.md` and `Hypernovum Snapshot 2026-07-15.png`. Move the internal
planning docs under `docs/internal/` (or drop them), and delete the stray snapshot. Also: the
`*Keywords: agent ops, second brain, 3D IDE...*` SEO line at the bottom of the README reads as
keyword stuffing — cut it.

**P2-8 · Dead code from removed logging.** `onClaudeActivityStart` has an empty `else {}` block;
`onClaudeActivityUpdate` assigns `currentStreamPath` and never reads it.

**P2-9 · Known-deferred bugs from the 2026-07-15 review, still open.** Worth clearing before a
public audience, roughly in this order: move mode surviving a rebuild (drags a disposed mesh);
shader material path ignoring emissive channels (hover-brighten and medium-conflict amber are no-ops
when `enableShaders` is on — which P1-4 makes the default); completed-orb 60 s fade restarting on
every rebuild; identical 2-file conflict sets classified `overlapping/medium` while a 1-file overlap
gets `same-file/high` (inverted).

---

## Features worth adding before publishing

Ranked by effect on whether people keep the plugin installed.

### F1 · A vault mode that actually visualizes the vault (highest adoption lever)

Today the city renders only notes with `tags: [project]` / `type: project`. A brand-new user
installs Hypernovum and gets an **empty city** with a "Create sample project" button. Most Obsidian
users aren't developers with a folder of git repos — and the ones who are still have to hand-author
frontmatter before they see anything.

`vaultMode` currently only *disables* agent features; it doesn't change what's rendered. Make it
mean what its name promises: **folders become districts, notes become buildings**, size from note
length or backlink count, colour from folder or tag, height from link degree. Backlinks are already
wired as Neural Link arcs, so the graph layer works for free.

That turns "install → empty city" into "install → my whole brain, in 3D" for every Obsidian user,
and the project/agent layer becomes the power-user tier on top. This is the single change most likely
to move the plugin from "cool screenshots" to real install counts.

### F2 · Make `projectDir` easy (pairs with P1-3)

- Right-click → **"Set project folder…"** with a folder picker, writing `projectDir` via
  `processFrontMatter` (already used for Add Quest, so the plumbing exists).
- Auto-detect on parse: same-named sibling folder, or walk up from the note's folder looking for
  `.git`. Offer it as a one-click "3 projects can be linked to repos — link them?" Notice.
- Show the unresolved state honestly in the inspector instead of silently reporting vault-root git.

### F3 · One-click agent hookup (completes P0-2)

Command: **"Install agent heartbeat hooks"** → writes `<vault>/.hypernovum/heartbeat.js`, shows the
exact JSON it wants to merge into `~/.claude/settings.json`, and offers to merge it after a diff
preview and explicit confirm (never silently). Same for Codex/`agy` where equivalent hooks exist.
Right now users have to hand-paste hook JSON containing a path substitution — the drop-off there is
near total.

### F4 · First-run onboarding

The empty state is decent but reactive. A 3-step overlay on first open — (1) how a project note is
detected, with a "create one" button; (2) link a folder for Git; (3) optional: enable agent features
(this is also the natural home for the P0-4 consent prompt) — converts far better, and gives you a
place to explain the 0.4 click/double-click change to newcomers who never saw the old behaviour.

### F5 · Commands for every HUD action

Snapshot, Save Layout, Clear filters, each lens preset, Needs-Attention lens, Trace impact, Toggle
edge types, Focus next blocked/stale. Obsidian users bind hotkeys to everything and rate plugins on
it; each is a 3-line `addCommand` wrapper over a method you already have. Cheap, and it makes the
plugin feel native rather than like an embedded app.

### F6 · Fail visibly without WebGL

There's no `webglcontextlost` handler and no availability probe — a user on a machine with WebGL
blocked or a lost context gets a black rectangle and no explanation. Detect up front, render a
message with a link to Obsidian's hardware-acceleration setting, and re-init on
`webglcontextrestored`.

### F7 · Honour reduced motion in the scene, not just the CSS

`styles.css:1508` has a `prefers-reduced-motion` block, but the Three.js loop (orbit, pulse, bloom
breathing, artery flow, quest bob) ignores it. Read the media query in `SceneManager` and damp the
animated channels. Small change; matters to people who need it, and it reads well in review.

---

## Submission checklist

Confirmed good:

- [x] `id` has no "obsidian"/"plugin" prefix; `name` is clean
- [x] Description is 178 chars, doesn't start with "This plugin…"
- [x] `isDesktopOnly: true` — correct, Node APIs are used throughout
- [x] `authorUrl` points at a profile, not the plugin repo; `fundingUrl` valid
- [x] LICENSE present (AGPL-3.0 is acceptable)
- [x] `versions.json` present
- [x] `main.js` gitignored, attached by CI as a release asset
- [x] No `var`, no global `app`, no `sample-plugin` leftovers, no `onunload` leaf detaching
- [x] Zero network requests, zero telemetry
- [x] `styles.css` shipped, no `<style>` injection into `document.head`

Must do before opening the PR against `obsidianmd/obsidian-releases`:

- [ ] P0-1 version alignment + CI guard
- [ ] P0-2 ship heartbeat.js to the vault
- [ ] P0-3 add `typecheck` + `test` to CI; gitignore the plugin `dist/`
- [ ] P0-4 README disclosure section
- [ ] P1-5 realistic `minAppVersion`
- [ ] Tag `0.4.0` (no `v`), confirm the release carries all three assets
- [ ] Run `docs/QA-CHECKLIST.md` end-to-end in a **fresh vault** (not the dev repo — that's what
      hid P0-2), and fill in `docs/PERF-BASELINE.md` with the tooling in `scripts/`
