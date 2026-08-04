# Contributing to Hypernovum

Thanks for taking a look. Issues and pull requests are welcome.

**Open an issue before starting anything large.** Hypernovum has a deliberately
narrow scope — an agent-ops view of a project vault — and the fastest way to
have work rejected is to build a feature that doesn't fit it. A short issue
first saves you the effort.

## Setup

```bash
npm install
npm run dev        # watch build (also regenerates the embedded heartbeat source)
```

To try your build in Obsidian, copy `packages/obsidian-plugin/main.js`,
`packages/obsidian-plugin/manifest.json`, and `packages/obsidian-plugin/styles.css`
into `<vault>/.obsidian/plugins/hypernovum/`, then reload the plugin.

### This repository is also a vault

The repo root doubles as the development vault, which is convenient and also a
trap: it already contains `.hypernovum/`, `AGENTS.md`, and project notes, so
**it cannot reveal bugs that only appear on a fresh install.** Anything touching
first-run behaviour, the heartbeat installer, or the whole-vault fallback has to
be tested in a brand-new vault. `.gitignore` covers the artifacts the plugin
writes here; if you see stray `Untitled*.md` or snapshot PNGs, they're yours and
already ignored.

## Before you open a PR

All three must pass:

```bash
npm run typecheck  # tsc across core + plugin — esbuild does NOT typecheck
npm test           # vitest
npm run lint       # same ruleset the Obsidian community scanner runs
```

`npm run lint` is worth calling out: the root `eslint.config.mts` extends
`obsidianmd/recommended`, so the local warning count is the one the community
directory reports. Please don't add to it.

Conventions that matter here:

- **Match the surrounding code.** Comment density in this repo is higher than
  typical, and comments explain *why* a non-obvious thing is the way it is —
  not what the line does.
- **Build DOM with `createEl`/`createDiv`, not `innerHTML`**, anywhere user or
  frontmatter data is involved. This has bitten the project before.
- **`packages/core` must not import `obsidian`.** It is platform-agnostic and is
  also consumed outside this plugin. That's why core keeps its own DOM helpers
  in `utils/dom.ts` and why the `prefer-create-el` warnings there are accepted.
- **Don't hand-edit generated files:** `src/generated/heartbeatSource.ts` comes
  from `scripts/heartbeat.js` via `npm run gen:heartbeat`, and
  `CORE_BUILD_VERSION` is stamped by `scripts/stamp-build.mjs`.
- Pure logic goes in a testable module with a unit test. The god classes
  (`SceneManager`, `HypernovumView`) are hard to test — please don't grow them.

## Reporting bugs

Include your Obsidian version, your OS, and whether **vault mode** is on. If it
involves agents, say which CLI and whether the heartbeat hooks are installed. A
fresh-vault reproduction is the single most useful thing you can attach.

## Releases (maintainers)

The root `manifest.json` is the single source of truth:

1. Bump `version` (and `minAppVersion` if it changed) in the **root** `manifest.json`.
2. `node scripts/check-versions.mjs --fix` — mirrors it into the plugin manifest,
   both `package.json` files, and `versions.json`.
3. Tag with the bare version, no `v` prefix: `git tag 0.5.0 && git push origin 0.5.0`.

CI builds and attaches `main.js`, `manifest.json`, and `styles.css`. A tag that
doesn't exactly match the manifest version will fail, and a published tag can't
be reused — a fix needs a new version.

## License

Contributions are accepted under [AGPL-3.0-only](LICENSE), the license this
project ships under.
