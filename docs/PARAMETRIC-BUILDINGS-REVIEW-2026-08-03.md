# Parametric building review — 0.4.1

> **Status: items 1–5 of the shortest path are IMPLEMENTED.** See §Implemented at the
> bottom for what landed, what was verified live, and what is still open. The U2 sheet is
> at `docs/u2-signoff/` — the sign-off call is still yours.


Art-direction + geometry review of `buildingStyle: 'parametric'` (opt-in; default is still
`classic`, pending the U2 aesthetic sign-off). Produced by a Fable 5 review agent; every
claim below marked ✅ was independently verified against the code afterwards.

**Constraint that shapes every recommendation:** Obsidian ships only `main.js`,
`manifest.json`, `styles.css`. No `.glb`, no textures, no HDRIs, ever. Everything is
generated in code. Closing the gap with Pro's realistic models is not an option — and
shouldn't be the goal.

---

## Verdict

The substrate is right; the material is what's failing it. `TowerLoft.ts` is a good
machine — pure, deterministic, hard-clamped, param-grid UVs, bottom-anchored, cached. The
floor-true window contract (`uFloors` → `windowRows`) is the best idea in the system: the
window grid *is* the data, and it survives twist and taper for free because windows live in
param space.

**Not ready to be the default today. It is about a day's work away, and the direction is
correct — finish it rather than reverse it.**

---

## Root cause: the shader has no lighting term ✅

This one finding explains most of "the parametric towers look flat."

- `building.vert` does `vNormal = normal;` — the raw **object-space** normal, never
  multiplied by `normalMatrix`.
- `building.frag:123` is the only consumer:
  `rim = 1.0 - max(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 0.0)`
  — a dot against a **constant object-space +Z**. It does not respond to the camera or to
  any light. It bakes a fixed bright/dark stripe onto whichever facets happen to face
  world +Z.
- There is no N·L term anywhere. Wall color is `uColor * 0.6` times a vertical `vUv.y`
  gradient.

Consequences that follow directly:

- Superellipse profiles (presets A, B, C) are indistinguishable from boxes except at the
  silhouette. Waist, bulge, entasis — all invisible on the surface.
- `facetedNormals: true` (presets D and E) forces `toNonIndexed()`, roughly tripling vertex
  count, to produce crisp per-facet normals **that no shading term consumes**. You are
  paying 3× geometry for a feature the material cannot display.
- The towers genuinely look *better* in the non-shader fallback (`MeshStandardMaterial` +
  scene lights) than in the flagship shader path.

---

## Three defects worth fixing regardless of the sign-off decision

### 1. Rooftop kit, beacon and quest gem float beside leaning towers ✅ — bug-tier

- Preset C leans: `lean.dx = input.height * 0.06` (`TowerPresets.ts:108`), capped at
  `leanFrac = 0.12·H`. A 30-unit tower's top centerline moves **1.8 units**.
- `RooftopFactory` places masts/HVAC within `safeR = min(width, depth) * 0.18` — roughly
  0.5 units — around local origin, and the beacon at `(0, topY + 0.3, 0)`.
- `SceneManager.ts:1025` puts the quest gem at `gem.position.set(0, baseY, 0)`.

So the roof furniture sits on the *base* centerline while the actual roof has moved 3×
the safe radius away. Every leaning tower renders its antenna, HVAC blocks, beacon and
quest gem hovering in mid-air next to the roof.

**Fix is trivial:** `TowerLoft.ts:174` already computes `topOff = leanAt(1)`. Return it as
`topCenter` on `TowerBuildResult` and offset the three call sites. ~15 lines, zero runtime
cost. BLD-006's acceptance criterion ("safe radius sits inside every preset's top
footprint") was never actually true once lean shipped.

### 2. Edge glow turns smooth lofts into a wireframe hairball ✅

`SceneManager.ts:951` — `new THREE.EdgesGeometry(geometry)` with **no threshold**, so it
defaults to 1°. On a 20-sample superellipse, adjacent wall columns differ by ~18°, so every
vertical grid line draws. Twist makes each quad non-planar, so the two triangles of each
quad diverge past 1° and the internal diagonals draw as well — preset A becomes a fully
triangulated glowing cage at 0.5 opacity. Noisy, and a real line-segment cost at a few
hundred buildings.

**Fix:** pass a threshold on the parametric path — `new THREE.EdgesGeometry(geometry, 20)`.
Setback ledges, waist creases and polygon facet edges all survive; grid noise disappears.
One argument.

### 3. Window density collapses in parametric mode ⚠️ *mechanism verified, magnitude not measured*

In classic mode each box face carries `u ∈ [0,1]`, so `windowCols` (3–10) means 3–10
columns *per face*. The loft's `u` spans the **entire perimeter**, so the same building
gets 3–10 columns around all 360° — far fewer, much wider panes. The task-count → density
encoding measurably weakens versus classic. On polygon profiles (D: 8 sides, E: 6),
`windowCols` is generally not a multiple of `sides`, so panes straddle sharp corners and
read as broken decals.

**Fix:** compute the column count CPU-side in `BuildingShader.createMaterial` and pass it
as a uniform — scale up for the perimeter case, snap to a multiple of `sides` for polygons.
Two lines in the shader; the `uFloors == 0` classic path stays untouched.

---

## Ranked improvements

### P1 — Give the shader a lighting response, gated on `uFloors > 0.5`
The highest-leverage change by a wide margin, because it is what makes every geometry
investment visible. Output `vNormalW = normalize(normalMatrix * normal)` in the vertex
shader; in the fragment shader add a fixed key direction driving
`wallColor *= 0.55 + 0.45 * max(dot(N, L), 0)` plus a hemisphere fill, and fix the rim to
use the transformed normal so it becomes a real camera-relative fresnel. Presets D and E go
from "gray tube" to "cut gemstone" — which is the entire point of the `facetedNormals` cost
already being paid. ~15 lines of GLSL, 0 KB, one dot product. Strictly gated on `uFloors`
so the classic path stays pixel-identical.

### P2 — Parapet lip + dark roof deck
The camera looks *down* at roofs constantly, and the loft currently terminates in a
knife-edge triangle fan whose cap inherits `v = 1` — the **brightest** wall value, in pure
status color. It's the cheapest-looking real estate in the city. Add an optional two-ring
parapet (step up and **inward**, ~40 extra verts) and darken up-facing caps to ~0.4 in the
shader. Rooftop greebles and beacons then pop against a dark deck instead of drowning.
Must step inward to keep the footprint invariant (hit-pad safety) intact; fold the lip
inside `H` so "height encodes priority" stays exact.

### P3 — Preset detune and real per-instance variation
All constants in `TowerPresets.ts`, which BLD-003 explicitly marked "retune freely":

- **Everything twists, so nothing reads as "the twisted one."** ✅ A=65°, C=10°, D=30°,
  E=15°; only B is untwisted. Give A the twist outright (70–90°) and take it to 0 on C, D
  and E. A straight diagrid octagon reads structural; a twisted one reads like the diagrid
  is sliding off.
- **`bulge` is implemented, clamped, tested — and used by zero presets.** ✅ It's the one
  parameter that would give a swelling organic family. Also worth adding a near-straight
  "ordinary skyscraper" as a foil, so the exotic silhouettes register as exotic.
- **Jitter is timid and single-axis.** Widen it: superellipse `n ± 0.7` (squarish ↔ rounded
  is strong and free), taper ±0.05, crown on/off. Biggest single win: **preset D's setbacks
  are hardcoded at 0.4 / 0.7 for every infrastructure and trading building in every vault**
  ✅ — jitter their positions and count. Setback placement is the classic skyline-variety
  generator.

Net bundle cost ≈ 0. No cache-hit-rate impact; path-seeded jitter already makes keys unique.

### P4 — Diagrid: align it, and make it neon rather than grime
`building.frag:77–83` draws the diagrid as *darkening* at a fixed density of 9.0 — dark-on-
dark at night reads as dirt, and 9 diagonals over an 8-facet perimeter aligns with nothing.
Tie density to facet count (pass `sides` through the already-float `uDiagrid` uniform) and
render members as a subtle **additive** accent so the bloom pass picks them up. ~6 lines.

### P5 — Mechanical-floor banding + `fwidth` pane antialiasing
Every Nth floor as an unlit dark spandrel band — the mullion rhythm that makes a tower read
as inhabited rather than as a UV-checkered tube. Plus `fwidth`-scaled pane edges to kill
the distance moiré that hundreds of window grids produce without MSAA. ~10 lines.

### Explicitly not recommended
Procedural normal maps or generated textures (per-pixel cost across hundreds of towers for
detail the camera distance can't resolve — P1 delivers ~90% of it per-vertex, free);
greeble-encrusted facades (fights the readout contract); and any attempt to imitate Pro's
GLB look. The free plugin's winning direction is **crisp data-glyph architecture** — sharper
and more legible than Pro, not a worse copy of it.

---

## Shortest path to flipping the default

1. Rooftop / beacon / quest-marker lean offset — visible bug, would draw reports.
2. `EdgesGeometry` threshold on the parametric path.
3. Perimeter-aware, facet-snapped window columns — restores data-readability parity.
4. **P1 lighting gate** — without it the silhouettes objectively don't render.
5. The five-minute subset of P3 — de-twist D/E, jitter D's setbacks.

Roughly a day, confined to `TowerLoft.ts`, `TowerPresets.ts`, `building.frag|vert`, and two
`SceneManager` call sites. Well under 5 KB of bundle delta. No test breakage except the
deliberate, flag-gated vertex-count update if P2's parapet lands (P2 is the first
post-default follow-up, not a blocker).

Then regenerate the U2 screenshot set — 5 families × 3 priorities. **That set, not this
document, is what the aesthetic sign-off should be made against.**

---

## Implemented (2026-08-03)

All five items landed. `npm run typecheck` clean, **263 tests** (was 261), build clean.
`buildingStyle` default is **still `classic`** — nothing changed for existing users.

| # | Change | Where |
|---|---|---|
| 1 | `loftTopCenter()` exported; `TowerBuildResult.topCenter` threaded to the rooftop kit, beacon and quest gem | `TowerLoft.ts`, `TowerPresets.ts`, `RooftopFactory.ts`, `SceneManager.ts` |
| 2 | `EdgesGeometry(geometry, 20)` on the parametric path; classic passes `1` explicitly | `SceneManager.ts` |
| 3 | `uWindowCols` uniform — perimeter-scaled, snapped to facet count | `BuildingShader.ts`, `building.frag` |
| 4 | `vNormalV` view-space varying; key + hemisphere lighting and a true fresnel, both gated on `uFloors > 0.5` | `building.vert`, `building.frag` |
| 5 | A owns twist (78°±12); C/D/E de-twisted to 0; D's setbacks jittered with an occasional third step | `TowerPresets.ts` |

Two regression tests added in `rooftop.test.ts` pinning the kit to the roof centerline —
the existing `tower-cache-rooftop.test.ts` already measured the top ring against its own
centroid, so it encoded the correct contract while the code ignored it.

### Verified live, not just compiled

The test suite does not compile GLSL, and `BuildingShader.testCompilation` falls back
**silently**, so "tests pass" would not have caught a broken shader. Driven in a real
Obsidian instance against a 27-project vault:

- Shaders compile; buildings use the shader path, not the fallback.
- Directional shading is visibly present — see `docs/u2-signoff/facet-shading-bloom-off.png`,
  captured with bloom off, where light and dark faces are unambiguous.
- The leaning family's beacon now sits on its roof.
- `GL_INVALID_VALUE: Program object expected` ×12 appears in the console — **pre-existing**,
  identical count in classic and parametric, unrelated to these changes. Worth its own look.

### Open — the honest caveat on the sign-off

At default settings (bloom 0.8, full-saturation status emissive) **bloom washes out most of
the new shading**, and at city zoom the five families still read more alike than they
should. The lighting is doing its job; the post chain is eating it. Before flipping the
default, the useful next experiments are P2 (parapet + dark roof deck, which gives the
top-down camera something to read) and lowering emissive saturation or bloom for the
parametric path specifically. P2 remains the first post-default follow-up.
