# Obsidian Scorecard: "Caution" → clean — fix plan (2026-08-03)

Context: the community-directory scorecard for the latest release shows **Caution — 302 issues**,
of which **294 are lint warnings** from the scanner's ESLint pass. Health is already Excellent.
The scanner re-scans **the latest release**, so nothing improves until the next tagged release
ships these fixes.

Verified facts before planning:
- Root `eslint.config.mts` already extends `obsidianmd.configs.recommended` and enables the
  same `@typescript-eslint/no-unsafe-*` rules the scanner uses — **`npm run lint` reproduces
  the scanner locally.** Drive the local warning count down and the scorecard follows.
- Releases already pass artifact attestation (main.js + styles.css). The failing item is the
  separate **build verification** step, which rebuilds from source and "did not find a built
  main.js file".
- `getSettingDefinitions()` is the real Obsidian 1.13 declarative settings API (1.13 desktop
  is public as of 2026-07-30); `display()` remains supported, so adopting it is additive.

**Sequencing: run this AFTER the Tier A/B bloat cuts (`docs/FEATURE-BLOAT-REVIEW-0.4.4-2026-08-03.md`)
land.** The cuts delete several of the noisiest files outright — don't type-fix code that's
about to be deleted.

---

## 0. Freebies from the bloat cuts (no extra work)

| Cut | Warnings that vanish |
|---|---:|
| SkillsScanner + ABILITIES tab | ~35 (the single noisiest file in the report) |
| FacetFilter, MapController deletion | ~5 |
| Deprecated exports (`loftTopCenter`, `getFocusedProject`, `setFocusedProject` after migrating the one caller at `HypernovumView.ts:2473`) | ~6 self-inflicted deprecation warnings |
| Install pills (clipboard writes) | a few unsafe + shrinks the clipboard surface (flag itself stays — Copy Path uses clipboard) |

Estimated: **~45 of 294 disappear as a side effect.** Re-run `npm run lint` after the cuts to
get the true remaining baseline.

## 1. The `no-unsafe-*` family (~269 warnings) — five root causes, not 269 problems

Fix by cluster, not by line:

1. **`JSON.parse` returns `any`** — DependencyScanner (~20), SessionReader/sessionDigest (~10),
   `main.ts:288` settings load, AgentContext, heartbeat-adjacent readers.
   Pattern: parse to `unknown`, narrow through a small guard (`isRecord(v)`, `asString(v)`).
   One shared `utils/json.ts` with 3–4 guards clears all of these. The fuzz tests already
   prove these parsers tolerate garbage — the guards just make the types tell the truth.
2. **Frontmatter access is `any`** — ProjectParser (~10), VaultAgentSetup:190–198,
   HypernovumView:698–701. Type the frontmatter as `Record<string, unknown>` at the boundary
   and reuse the existing normalizers.
3. **`catch (e)` member access** — TerminalLauncher (~30), GitActivityCollector (~8).
   Pattern: `const msg = e instanceof Error ? e.message : String(e)`. One helper
   (`errorMessage(e)`), mechanical sweep.
4. **three.js `userData` is `any`** — SceneManager drag-handle/label/district code (~25 across
   856–2115), DataArtery:165. Add a typed accessor (`getUserData<BuildingUserData>(obj)`) or
   declare per-object userData interfaces; SceneManager already has the type shapes informally.
5. **Electron/`require` typing** — HypernovumView:3007–3111, 3231 (`getElectronDialog`),
   :157/185. `electron.d.ts` exists but the call sites bypass it — route them through it.

Estimated result: **~269 → under ~20** residuals.

## 2. Trivial singles (one commit)

- `floorHeight` assigned but never used.
- 7 unnecessary type assertions (`EdgeManager.ts:167`, `SceneManager.ts:334/511/1294/2690`,
  `DataArtery.ts:86`, `HypernovumView.ts:842`, `MapController.ts:25` — last one dies with the file).
- The 1 remaining `Unexpected any`.

## 3. `prefer-create-el` (13) — accept, with a floor note

All 13 are in **core**, which is platform-agnostic and cannot use Obsidian's `createEl`
augmentations without taking a dependency on Obsidian (core also feeds Pro/Electron).
`core/utils/dom.ts` already centralizes creation. Options:
- Accept these 13 as the permanent floor (recommended), or
- Move tooltip/label DOM assembly into the plugin package (real work, low value).

## 4. Declarative settings API — implement `getSettingDefinitions()`

Scanner flags that `SettingsTab` doesn't implement it, so Hypernovum's settings are invisible
to settings search on Obsidian 1.13+. Our settings are almost all toggles/dropdowns/sliders —
they map cleanly onto a declarative schema. Keep `display()` as the pre-1.13 fallback (the
API is additive). This also removes one scorecard warning and is a genuine UX win.
Note: minAppVersion stays 1.6.0 — guard the method so older clients ignore it.

## 5. Build verification — make the scanner's rebuild find main.js

The scanner rebuilds from source and looks for the built `main.js` — in this monorepo,
`npm run build` emits it at `packages/obsidian-plugin/main.js` while the root (where the
directory's `manifest.json` lives) has none. Fix: have the plugin build (esbuild.config.mjs or
a post-build step in the root `build` script) **also copy `main.js` + `styles.css` to the repo
root**, matching the sample-plugin layout the scanner expects. Gitignore the root copies if we
don't want built artifacts committed — verify whether the scanner builds-then-checks (likely)
or reads HEAD. If uncertain, committing the built root `main.js` per release (sample-plugin
convention) is the safe route. Converting "Build verification not available" into a pass is a
top-of-scorecard trust signal, likely worth more than any warning-count reduction.

## 6. Hygiene row: add CONTRIBUTING.md

The only hygiene item missing. A short one: dev setup (`npm i && npm run dev`), the
repo-is-the-dev-vault quirk, test/lint/typecheck gates, release flow pointer, and "open an
issue before large PRs". Also: **`Untitled 2.md` and `Untitled 3.md` are sitting in the repo
root** (the repo is the dev vault — stray notes). Delete them before more eyes arrive.

## 7. Not fixable / accept deliberately

- **Direct Filesystem Access / Shell Execution / Vault Enumeration / Clipboard** capability
  flags: inherent to the product (agent launch, git signals, graph parsing, Copy Path). They
  are consent-gated and disclosed in the README's developer-policy section — that section is
  the mitigation. Do not gut features to clear flags.
- **AGPL-3.0 copyleft disclosure**: deliberate licensing choice; leave it.
- **Malware scan / build verification "not available"**: the second we can fix (§5); the first
  is on Obsidian's side.

## Definition of done

1. `npm run lint` after all fixes: **< 25 warnings** (target floor: 13 create-el + a few hard
   userData cases), 0 errors.
2. `rm -rf packages/core/dist && npm test` green (the CI-parity invocation), `tsc --build`
   clean after deleting tsbuildinfo.
3. Next release tagged with these + the bloat cuts; scorecard re-check ~a day after the
   release goes live. Expected: warning count drops from 294 to low dozens, build verification
   passes, hygiene complete — "Caution" should clear.
