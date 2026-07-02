# HYPERNOVUM (OSS monorepo) — Code & Product Review

Generated: 2026-07-02 (Claude Code session; two deep exploration passes —
obsidian-plugin and packages/core — cross-referenced against the same-day pro-app
review in hypernovum-pro/docs/CODE-REVIEW-2026-07-01.md).

## What this repo actually is

The former `hypervault` monorepo, renamed (`040310f`). Two workspaces:
`packages/core` (**@hypernovum/core 0.2.0** — the 3D engine, AGPL) and
`packages/obsidian-plugin` (**0.3.0**, free product). The pro app consumes a
**hand-copied, stale dist** of core under the OLD name **@hypervault/core 0.1.0**
(built at `f7b5da1`, 2026-02-26) — no npm publish, no CI, no `.github/` at all.

## TL;DR

Three things matter most:

1. **Core drift is live again.** Pro's dist is 2 commits behind source: missing the
   drag-handle hitbox / unsaved-offset fix (`425adf1`) and the memory-context +
   git-activity data model (`b5c8b9b`: `hasMemoryContext`, `gitActivity`,
   `enableGitActivity`, `WeatherData.activeBranch`). The anti-drift constant
   `CORE_BUILD_VERSION` (index.ts:2) is a hand-edited literal that was never bumped
   for those commits — it defeats its own purpose.
2. **Command injection in the plugin's TerminalLauncher** — Windows launch uses
   `shell:true` and interpolates `command`/`normalizedPath` unescaped
   (TerminalLauncher.ts:92-119); Linux interpolates into `bash -c` (222-223).
   `projectDir` comes from vault **frontmatter**, so a malicious shared vault =
   arbitrary command execution. macOS escapes correctly. Same bug class was fixed
   in pro on 2026-07-01.
3. **Not submittable to the Obsidian community directory:** no `versions.json`, no
   release workflow (no `.github/`), `main.js` (623 KB) committed to git instead of
   attached to releases.

## Plugin findings (packages/obsidian-plugin)

**Healthy:** clean 60-line entry; proper metadata-cache vault parsing; read-only
git via execFile with timeouts; agent auto-detect + in-view switcher; SETUP.md
context injection; activity heartbeat; Vault Mode; view lifecycle cleanup mostly
correct. Fully ungated — Pro is a separate app, not an unlock (right call).

**Fix list (ordered):**
1. TerminalLauncher injection (above) — quote/escape or argv-only; consider
   allowlisting the four known agent commands + validating custom ones.
2. `versions.json` (`{"0.3.0": "1.0.0"}`) + GitHub Actions release workflow
   attaching `main.js`/`manifest.json`/`styles.css`; stop tracking `main.js`.
3. `innerHTML` with user-controlled `agentName` in the agent switcher
   (HypernovumView.ts:428, 451) — use `createEl`/`textContent`. Reviewers flag
   ALL innerHTML; the inspector already escapes, the switcher doesn't.
4. Swallowed error: `new Notice(\`Failed to create project: \`)` — dropped
   interpolation (HypernovumView.ts:138).
5. Injected `<style id="hypernovum-cursor-anim">` into document.head never
   removed on unload (1044-1049) — move to styles.css.
6. Delete orphan `src/styles.css` (9 lines, untracked, duplicated verbatim in the
   root styles.css which is what the build copies).
7. Duplicate `HypernovumSettings` type (core's vs SettingsTab's extended one) —
   ProjectParser imports the narrower core type; rename the plugin one.
8. Perf: `buildCity` does sync `existsSync` + N git spawns per rebuild (debounced
   2 s) — fine for small vaults, janky for large multi-repo ones; make the git
   fan-out concurrent-capped and async.
9. `console.log`s throughout the view — reviewers sometimes ask; gate or remove.
10. HypernovumView.ts is 1,203 lines (same god-class pattern as pro's App.tsx and
    the polytope viewer) — extract the agent switcher, inspector, and command
    panel when convenient.

## Core findings (packages/core)

- **Dead code confirmed at source:** `createBuildingGeometry` (SceneManager.ts:832)
  is the only caller of `GeometryFactory`'s six category silhouettes and has zero
  call sites — `createBuilding` (:720) uses status-based `BuildingFactory` (:776)
  instead. History shows `55edd2c` "Wire up category-specific building shapes" was
  orphaned by `5efc807` "Restore advanced Pro features". `BuildingObject.ts` is
  entirely dead (never imported); its "v0.2 InstancedMesh" plan never happened.
- **Per-frame full-scene `traverse`** in the animate loop (SceneManager.ts:1779)
  just to pulse blocked-building edge glow — replace with a tracked array.
- SceneManager.ts is 2,142 lines (53% of core). No tests anywhere. tsconfig has
  `noImplicitAny`+`strictNullChecks` but not `strict`/`noUnusedLocals` (which is
  why the dead code compiles silently).

## Core 0.3.0 release plan (unblocks both products)

1. Reconcile the package name: publish as `@hypernovum/core` and update pro's
   imports/dependency, or keep `@hypervault/core` as the artifact name for compat.
2. Ship `425adf1` + `b5c8b9b` so pro gets the hitbox fix and the
   memory/git-activity fields its discovery layer can populate.
3. Generate `CORE_BUILD_VERSION` at build time (git short hash + date via the
   existing inline-Node build step) instead of hand-editing.
4. Formalize the publish path (npm pack tarball or `file:` dep or GitHub Packages)
   + a CI workflow so hand-copied dist drift can't recur.
5. Decide the dead code: **wire `GeometryFactory` into `createBuilding`** (instant
   building variety for BOTH products — recommended) or delete it, plus delete
   `BuildingObject.ts`; turn on `noUnusedLocals`.
6. Cheap perf: kill the per-frame traverse (:1779).

## Funnel / marketing

- `site/index.html` (the OSS landing page) has **zero Pro mentions** — no link to
  studio.pardesco.com/hypernovum, no Engram/MCP/Tandem pitch. Pure GitHub CTAs.
  Add a Pro section; this is the cheapest funnel fix available.
- Conversely, every generated SETUP.md embeds a Pro upsell block
  (AgentContext.ts:93-105) **written into users' project directories on every
  agent launch**. Clever, but consider making it a one-liner or opt-out — OSS
  users may read persistent marketing files in their repos as spammy.
- Repo hygiene: root doubles as the dev Obsidian vault (intentional — esbuild
  copies the plugin into `.obsidian/plugins/`), but loose `Untitled*.md/.base`
  files and stale `tsconfig.tsbuildinfo` are committed/untracked noise.

## Status update (2026-07-02, same day)

**Done in commit `207a8cb` (marketplace readiness):**
- TerminalLauncher injection fixed (argv-only Windows/Linux, layered
  AppleScript+shell escaping on macOS) AND the fallback chain actually works now
  (spawn() errors are async; a spawn-event helper resolves each attempt).
- Agent switcher innerHTML → createEl/textContent; swallowed create-project
  error fixed; head-injected <style> replaced with the existing
  `.hypernovum-cursor` class; console.logs removed; orphan src/styles.css deleted.
- Release plumbing: `versions.json`, root `manifest.json`,
  `.github/workflows/release.yml` (tag-triggered, verifies tag == manifest
  version, attaches main.js/manifest.json/styles.css); main.js untracked.

## Marketplace submission path (remaining)

1. Push master, then bump to **0.3.1**: plugin `manifest.json` + `package.json`,
   mirror to root `manifest.json`, add `"0.3.1": "1.0.0"` to `versions.json`.
2. `git tag 0.3.1 && git push origin 0.3.1` — NO "v" prefix; the workflow builds
   and creates the release with the three required assets.
3. Submit a PR to `obsidianmd/obsidian-releases` adding the plugin to
   `community-plugins.json` (id `hypernovum`, repo `Pardesco/hypernovum`).
   Review queue is typically a few weeks.
4. Before submitting: drop "for Obsidian" from the manifest description
   (reviewers flag it as redundant).

## Suggested order of work

1. Plugin security + review-blockers (items 1–5) — small, high-stakes.
2. `versions.json` + release CI — makes the plugin actually distributable.
3. Core 0.3.0 with GeometryFactory wired — the variety win both products need;
   then refresh pro's consumed copy (hypernovum-pro repo).
4. Site Pro section + SETUP.md upsell softening.
5. God-class extractions + tests as ongoing hygiene.
