# HYPERNOVUM — Agent Instructions

> This file exists because a critical data loss incident occurred on 2026-02-26.
> Every agent working in this codebase **must** read and follow these rules.

---

## Project Architecture

HYPERNOVUM is a 3D cyberpunk city visualization of coding projects. It ships as two apps that share one core package:

```
hypervault/                          ← THIS MONOREPO
├── packages/core/                   ← @hypervault/core (shared engine)
│   ├── src/                         ← TypeScript SOURCE OF TRUTH
│   │   ├── scene/SceneManager.ts    ← City builder, camera, interactions
│   │   ├── renderers/
│   │   │   ├── BuildingFactory.ts   ← Procedural building shapes (NeonSpire, Monolith, Ziggurat)
│   │   │   ├── GeometryFactory.ts   ← Category shapes (DEAD CODE — not called anywhere)
│   │   │   └── BuildingShader.ts    ← Custom shader material
│   │   └── ...
│   └── dist/                        ← Compiled JS (tsc output) — NEVER edit directly
├── packages/obsidian-plugin/        ← Obsidian addon (consumes core via npm workspace)
└── .obsidian/plugins/obsidian-hypernovum/  ← Built plugin output (gitignored)

hypervault-pro/                      ← SEPARATE REPO (Electron desktop app)
├── node_modules/@hypervault/core/   ← Copy of core dist — NOT symlinked
├── scripts/sync-core.sh             ← Script to copy core dist from monorepo
└── src/main/index.ts                ← Logs CORE_BUILD_VERSION at startup
```

### How the apps consume core

| App | Mechanism | Build command |
|-----|-----------|---------------|
| Obsidian plugin | npm workspace link → `packages/core/dist/` | `npm run build` (root) |
| HYPERNOVUM Pro (Electron) | Manual copy in `node_modules/@hypervault/core/dist/` | `bash scripts/sync-core.sh` then `node esbuild.config.mjs` |

The Pro app does NOT use npm workspaces or symlinks. Its `node_modules/@hypervault/core/dist/` is a **plain file copy** of the monorepo's `packages/core/dist/`. This is the root cause of the incident.

---

## The Incident: What Happened

### Timeline (2026-02-25 to 2026-02-26)

1. The Pro app's `node_modules/@hypervault/core/dist/` had **advanced features** that were developed directly in compiled JS and never backported to TypeScript source in `packages/core/src/`.

2. During the HYPERNOVUM rebrand, a core rebuild was triggered (`tsc --build --force`) which compiled TypeScript source to `dist/`. Since the TypeScript source was **missing 17 features** that only existed in the old dist JS, the rebuild **wiped them all out**.

3. The rebuilt (incomplete) dist was then copied to Pro's `node_modules/`, breaking the Pro app.

### What was lost (17 features)

These features existed in the compiled `dist/` JS but NOT in the TypeScript `src/`:

| Feature | File | What it does |
|---------|------|-------------|
| `recalcBlockBounds()` | SceneManager.ts | Recalculates district bounds after drag |
| `centerSingleBuildings()` | SceneManager.ts | Centers lone buildings in their block |
| `animateCameraToDefault()` | SceneManager.ts | Smooth camera reset animation |
| Circular ground plane | SceneManager.ts | CircleGeometry ground instead of square |
| Square grid clipped to circle | SceneManager.ts | Grid lines within circular boundary |
| Flat L-bracket drag handles | SceneManager.ts | Visual handles for block dragging |
| Time-based decay coloring | SceneManager.ts | Building age visualization |
| Lit window modulation | SceneManager.ts | Animated window lights on buildings |
| `BuildingFactory` delegation | SceneManager.ts | Uses `BuildingFactory.createBuilding()` instead of inline geometry |
| `BuildingFactory` class | BuildingFactory.ts | Entire file was missing from source |
| `createNeonSpire()` | BuildingFactory.ts | Hexagonal column + 4 toroidal rings (active projects) |
| `createMonolith()` | BuildingFactory.ts | Box + datablock protrusions (tall/high-priority) |
| `createZiggurat()` | BuildingFactory.ts | Stepped pyramid + cooling fins (default) |
| `createFoundation()` | BuildingFactory.ts | Shape-matched foundations (hex for spire, box for others) |
| `BuildingObject` helper | BuildingObject.ts | Building mesh wrapper |
| Camera pan boundary | SceneManager.ts | Clamps `controls.target` to city radius |
| City origin centering | SceneManager.ts | Centers all positions on origin before layout |

### How it was fixed

1. Recovered the old compiled JS from a previous installer's ASAR archive (`tmp-extract/`)
2. Compared old dist JS against current TypeScript source line-by-line
3. Backported all 17 features to TypeScript source files
4. Committed to monorepo as `5efc807` ("Restore advanced Pro features to SceneManager")
5. Rebuilt core, plugin, and Pro app — all verified working

---

## Rules to Prevent This From Happening Again

### Rule 1: NEVER modify compiled output directly

```
FORBIDDEN:
  packages/core/dist/**          ← Never edit. This is tsc output.
  node_modules/@hypervault/core/ ← Never edit. This is a copy of dist.

ALLOWED:
  packages/core/src/**           ← Always edit TypeScript source here.
```

If you need to change any core behavior, edit the `.ts` files in `packages/core/src/`, then rebuild.

### Rule 2: ALWAYS commit source changes before rebuilding

```bash
# Correct workflow:
cd packages/core/src/
# ... make changes to .ts files ...
git add -A && git commit -m "description of changes"
npm run build:core        # Now safe to rebuild
```

Never run `npm run build` or `tsc` without first committing your source changes. If the build overwrites dist, uncommitted source changes are the only thing that protects against data loss.

### Rule 3: Check CORE_BUILD_VERSION after any rebuild

The core exports a version constant:

```typescript
// packages/core/src/index.ts
export const CORE_BUILD_VERSION = '2026-02-26-5efc807';
```

The Pro app logs it at startup:
```
[Hypernovum] Core version: 2026-02-26-5efc807
```

After rebuilding core, verify this version is what you expect. If it shows an old version, something went wrong with the sync.

**When you modify core, update this constant** with the current date and commit hash.

### Rule 4: Use the sync script for Pro app

```bash
# In hypervault-pro/:
bash scripts/sync-core.sh    # Copies dist from monorepo
node esbuild.config.mjs      # Rebuilds Pro app
```

Never manually `cp -r` the dist directory. The script includes safety checks.

### Rule 5: Verify building shapes after any core change

The "correct" procedural buildings use `BuildingFactory.createBuilding(project)`:

- **NeonSpire** (active projects) → hexagonal `CylinderGeometry(r, r, h, 6)` + 4 `TorusGeometry` rings
- **Monolith** (tall/high-priority) → `BoxGeometry` + datablock `BoxGeometry` protrusions
- **Ziggurat** (default) → 3-5 tiered `BoxGeometry` steps + cooling fin `BoxGeometry`

Quick verification after rebuild:
```bash
# Plugin (Obsidian):
grep -c "createNeonSpire" .obsidian/plugins/obsidian-hypernovum/main.js
# Should output: 1

grep -c "TorusGeometry" .obsidian/plugins/obsidian-hypernovum/main.js
# Should output: 1 (or more)

# Pro app:
grep -c "CORE_BUILD_VERSION" dist/main/index.js
# Should output: 1+
```

If any of these return 0, the build used stale or incomplete source.

### Rule 6: GeometryFactory is DEAD CODE — do not wire it up

`GeometryFactory.ts` and `SceneManager.createBuildingGeometry()` exist but are **never called**. Building creation is handled exclusively by `BuildingFactory.createBuilding()`. Do not re-enable the old geometry factory path unless explicitly asked to.

---

## Building Pipeline (for reference)

```
SceneManager.buildCity(projects)
  └── for each project:
        SceneManager.createBuilding(project)
          ├── BuildingFactory.createFoundation(project)  → foundation mesh
          └── BuildingFactory.createBuilding(project)    → building mesh
                ├── if status === 'active'  → createNeonSpire()
                ├── if height > 20          → createMonolith()
                └── else                    → createZiggurat()
```

Both the Obsidian plugin and Pro app call `SceneManager.buildCity()` — neither has its own building creation code. All building shapes come from `BuildingFactory` in the core package.

---

## Key File Paths

| What | Path |
|------|------|
| Core TypeScript source | `packages/core/src/` |
| Core compiled output | `packages/core/dist/` (gitignored in `.obsidian/`, tracked in git for `packages/`) |
| BuildingFactory | `packages/core/src/renderers/BuildingFactory.ts` |
| SceneManager | `packages/core/src/scene/SceneManager.ts` |
| Core version constant | `packages/core/src/index.ts` → `CORE_BUILD_VERSION` |
| Plugin bundle | `.obsidian/plugins/obsidian-hypernovum/main.js` (gitignored) |
| Pro app repo | `../hypervault-pro/` (separate git repo) |
| Pro sync script | `../hypervault-pro/scripts/sync-core.sh` |
