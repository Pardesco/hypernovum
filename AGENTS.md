# Hypernovum contributor instructions

The source of truth is TypeScript under `packages/core/src` and `packages/obsidian-plugin/src`. Never edit compiled `dist`, bundled `main.js`, or installed `node_modules` files. A historical data-loss incident is preserved in [docs/ARCHITECTURE-HISTORY.md](docs/ARCHITECTURE-HISTORY.md).

## Architecture

- `@hypernovum/core`: shared city engine. Both BuildingFactory and GeometryFactory are used; neither is obsolete.
- Obsidian consumes core source through the workspace/build alias.
- Sibling `hypernovum-pro` consumes a committed, source-stamped tarball under `vendor`. Run `npm run sync:core` there after committing core changes. Do not copy compiled files by hand or delete dependency locks to refresh core.
- The source `CORE_BUILD_VERSION` stays `dev`. The build script stamps the compiled copy with package version, Git commit, and date.
- `scripts/heartbeat.js` is the source for embedded heartbeat content. Run `npm run gen:heartbeat`; never edit its generated copy by hand.
- Bundled Obsidian skill data is refreshed only by `scripts/vendor-obsidian-skills.mjs` at an explicitly reviewed commit. Preserve MIT attribution and every referenced file. Runtime installation is offline and must preserve existing user skills.

## Verification and data preservation

1. Commit source changes before running builds or TypeScript commands that emit output. This keeps the build stamp tied to recoverable source.
2. Run relevant behavioral tests, `npm test`, lint, build, and typecheck. Tests resolve core source, not stale compiled output.
3. Set `HYPERNOVUM_SKIP_VAULT_COPY=1` when building for verification so the dev-vault plugin is not replaced. Perform Obsidian QA in a separate fresh vault.
4. Check the compiled core stamp after rebuilding or syncing. Verify city geometry if shared rendering changes.
5. Never commit generated vault inventories, absolute personal project paths, screenshots, or briefings. Remove any `hypernovum:start` / `hypernovum:end` generated section from this file before committing.
6. Preserve notes, custom agent instructions, installed skills, branches, and worktrees. A stopped agent is not evidence of successful or accepted work.

No release or publication is implied by a local build.
