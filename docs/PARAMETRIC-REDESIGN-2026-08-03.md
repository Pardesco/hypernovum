# Parametric building redesign — proposal

Art-direction commission (Fable agent), triggered by "the leaning tower doesn't look good…
needs several distinct building models that look visually appealing, even if totally
different from what we currently have."

**Status: SLICE 1 IMPLEMENTED** — `loftStack`, BASTION, LEDGER, BLOCK, and the deletion of
`lean`/`waist`/`bulge`/`crown`. See §Slice 1 at the bottom. OBELISK, BLADE, HIVE-as-cluster
and the HELIX polish are still design only.

**Original status: DESIGN ONLY.** Supersedes the incremental P3/P5
items in [PARAMETRIC-BUILDINGS-REVIEW-2026-08-03.md](PARAMETRIC-BUILDINGS-REVIEW-2026-08-03.md);
the P1/P2 work already committed (lighting, roof deck, edge threshold, window columns) is
kept and is what makes this redesign pay off.

---

## The finding that reframes everything — verified

Every preset is designed against a parameter space that **does not exist at runtime**.

`layout/BinPacker.ts:96` sets footprint as `clamp(sqrt(scope) * 0.4, 2, 4)` — so every
building is **2–4 world units square**, half-extents of 1–2. `calculateHeight` returns
`stories × 2.5` for `{critical: 7, high: 5, medium: 3, low: 1.5}`, so height is one of
exactly four values: **3.75 / 7.5 / 12.5 / 17.5**. `TowerPresets.ts:87` then does
`floors = clamp(height / 2.5, 4, 28)`, which yields **4, 4, 5, or 7**.

The 28-floor ceiling is unreachable. Width always equals depth. So every "silhouette move"
in the current set is sampled across **5–8 rings** and applied to a **1–2 unit radius**:

| Move | Clamp | Actual size on screen |
|---|---|---|
| B's waist | `waistDepth ≤ 0.10` | a **0.09–0.16 unit** dent |
| D's setbacks | `setbackDepth ≤ 0.12` | **0.10–0.16 unit** ledges |
| A's twist | 78° on `n: 3.5` | a near-circle is rotationally near-symmetric — almost no silhouette change |

The clamps *guarantee* invisibility. The recently-landed setback jitter varies the position
of steps nobody can see. **Any future preset must be designed against floors 4–7 and a
2–4 unit footprint, not against the clamp ranges.**

## Why the lean specifically reads as broken

Five compounding causes, worth recording because they are a checklist for anything similar:

1. It uses the **roundest profile in the set** (`n: 2`, a literal ellipse) — no rigid edge to
   sell an engineered cantilever, so a bent tube reads as *wilting*.
2. `sCurve` smootherstep puts maximum curvature at mid-height and zero at the ends. That is a
   banana. Real leaning architecture is a straight shear with crisp arrises.
3. At 5–8 rings the banana is a visibly kinked polyline.
4. The camera is **fixed** — a lean along the view axis reads as nothing, a lateral lean reads
   as falling over, and the sign is random per project, so half a district looks like a
   rendering error.
5. It fights the readout: a tilted bar corrupts height-as-priority, and it forced the whole
   `loftTopCenter`/`topCenter` plumbing just to stop beacons floating.

## Structural conclusion

From a fixed high camera with no orbit, distinctness comes from exactly three things:
**plan silhouette**, **massing rhythm** (one mass vs stacked vs clustered), and **roofline**.
The current set varies none of them — five variants of one extruded mass with mid-range
taper. Under bloom they converge to five green tubes.

The `TowerLoft` ring loop is a good primitive and stays. The *vocabulary* — one continuous
profile modulated by ±12% — is the wrong substrate and goes.

---

## Proposed: `TowerStack`, then six families as config

**New primitive** on top of the existing ring loop: an ordered list of loft **segments**
(`{ profile, floorSpan, scale, rotationDeg, taper }`) welded by up-facing annulus caps,
sharing one floor-true `v` axis pinned at segment boundaries so windows never smear across a
ledge — plus an optional **crown** (`spire | shear | parapet`) folded inside the encoded
height exactly as the parapet already is. ~150 lines. Two things come free: the shader's
`roofMask` darkens every ledge into a readable deck, and the 20° edge threshold outlines
every step, because they are true 90° creases.

| Family | Concept | Plan / massing / roofline | Verts |
|---|---|---|---|
| **HELIX** | Square monolith wrung 90°, corners rising as glowing helical ribbons | chamfered square / single / parapet | ~580 |
| **LEDGER** | 2–4 rectangular slabs stacked like books, each rotated 90° | rectangle / stacked / stepped decks | ~300 |
| **OBELISK** | Diamond-plan shaft resolving into a pyramidal spike | diamond / single / **the only point** | ~200 |
| **BASTION** | Three concentric masses telescoping in hard 25% steps | square / telescoped / triple terrace | ~250 |
| **BLADE** | Thin knife-slab, roof cut at a hard diagonal | thin rectangle / single / **the only asymmetric roof** | ~60 |
| **HIVE** | Tall hex column with 2–3 shorter hex satellites fused to its faces | hex cluster / **the only cluster** / parapet | ~250 |
| **BLOCK** | Deliberately ordinary near-straight tower — the foil | superellipse / single / parapet | ~170 |

Worst case 300 buildings × ~350 verts ≈ 105k verts — comfortable, and *cheaper in edge-line
segments* than today's 20-sample superellipse grids.

BASTION's steps are 0.26/0.22 — **3× the current setback clamp**. That is what `setbacks`
always wanted to be.

### Category mapping

| Category | Family |
|---|---|
| web-apps | HELIX |
| content | LEDGER |
| desktop-apps | LEDGER (fewer, chunkier slabs) |
| visualization | OBELISK — heir of the classic Data Shard |
| art | OBELISK (taller crown fraction) |
| infrastructure | BASTION — heir of the classic Ziggurat |
| trading | BLADE — heir of the classic Quant Blade |
| obsidian-plugins | HIVE — "modular" finally means modular |
| unmapped | BLOCK (replaces mixing classic silhouettes into parametric mode) |

### Delete

`lean` entirely (param, `sCurve`, `leanFrac`, preset C, and the `loftTopCenter`/`topCenter`
plumbing); `waist` and `bulge` (invisible at their own clamps / used by zero presets);
`crown`-as-scale-reduction (superseded by real crown segments); `setbacks`-as-surface-dents
(superseded by BASTION's true tiers); blob profiles as defaults; the A/B/C presets wholesale.
E survives as HIVE's core, D's intent as BASTION.

### Order

1. `TowerStack` primitive + tests — everything else is config. **0.5–1 day**
2. BASTION + LEDGER + BLOCK, delete lean/waist/bulge, regenerate U2 sheet — biggest single
   visible delta. **~0.5 day**
3. OBELISK (spire crown, beacon at tip) — 2 hrs
4. BLADE (`shear` crown, ~20 lines) — 1 hr
5. HIVE (multi-column merge) — 3 hrs
6. HELIX polish (`minRings`, `n: 5`) — 1 hr
7. Shader garnish: diagrid density as a multiple of `sides`, dark spandrel band — 1 hr

Total ≈ 2–3 working days, < 4 KB bundle delta, no new uniforms.

---

## Implementation caveats found while checking the proposal

- **Width always equals depth** (`baseSize` is used for both). LEDGER's 1:0.62 and BLADE's
  1:0.32 aspect ratios therefore cannot be read from `dimensions` — the preset has to impose
  them. Harmless for the footprint invariant (it only narrows), but the foundation plinth
  stays square under a thin slab; check that reads acceptably before committing to BLADE.
- `minRings` decouples geometric rings from floors. The shader's `uFloors` must keep
  receiving the **floor** count, not the ring count, or the floor-true window contract breaks.
- Deleting `lean` reverts part of the just-committed `f666ab0`. That is fine and intended —
  but the rooftop-anchor plumbing added there is still needed by parapet decks (`roofAnchor.y`),
  so remove the XZ lean handling only, not the anchor itself.

---

## Slice 1 — implemented 2026-08-03

`npm run typecheck` clean, **277 tests** (was 268), build clean. `buildingStyle` default is
still `classic`; all of this is inside the opt-in parametric path.

### `loftStack` — the new primitive

An ordered list of masses (`{ floors, scale, rotationDeg, taper }`) over one shared plan
profile. Each mass is emitted as a **closed prism** — bottom cap, walls, top cap — rather
than welded to the one below. That is the load-bearing decision: masses rotate in plan, and
welding ring *j* of a 0° square to ring *j* of a 90° square produces a folded,
self-intersecting surface at zero height. Closing each mass also lets an upper mass legally
overhang a lower one (the stacked-slab look) without leaving a hole.

`v` is floor-true across the whole stack and pinned at every mass boundary, so window rows
stay aligned to real floors and never smear across a ledge. Up-facing ledges are picked up
by the shader's roof mask automatically, and their 90° creases by the edge-glow threshold —
both were built in P1/P2 for exactly this geometry.

### Families now shipping

| Family | Categories | What it is |
|---|---|---|
| **BASTION** | infrastructure, trading | 2–3 concentric masses telescoping in **26% / 22% steps** — ~3× what the old `setbacks` clamp could express |
| **LEDGER** | content, desktop-apps | 2–4 rectangular slabs, each rotated 90° from the last; aspect **imposed** by the preset, since the layout always hands over width == depth |
| **BLOCK** | visualization, art, **and every unmapped category** | A deliberately quiet near-straight tower — the foil, and the end of mixing classic silhouettes into parametric mode |
| HELIX | web-apps | unchanged this slice (twist retune pending) |
| HIVE | obsidian-plugins | unchanged this slice (cluster form pending) |

Renders per family: `docs/u2-signoff/families/*.png` (bloom off, so the massing is
readable), and the full sheet at `docs/u2-signoff/parametric.png`.

### Deleted

`lean` (+ `sCurve`, `leanFrac` and the C preset), `waist`, `bulge`, and `crown`-as-scale-
reduction. `loftTopCenter` is kept as a deprecated export returning the origin — core is a
published package, so removing an export is a semver event (`docs/DEAD-CODE.md`). The
rooftop anchor it was introduced for is retained: the parapet deck still needs `roofAnchor.y`.

### Tests reworked, not just repaired

- `tower-presets.test.ts` rewritten around the new contract: family mapping, and a
  readout-contract block that asserts total height equals the encoded height, stacked masses
  sum to the floor count the shader is told about, the deck is at or just below the bbox top,
  and the footprint never exceeds the base plan — **across all nine categories at all four
  heights BinPacker actually emits**, rather than at one invented height.
- `tower-cache-rooftop.test.ts`'s safe-radius check no longer indexes into the loft's vertex
  grid (which the stack generator does not share). It now measures the deck inradius off the
  built geometry, so it works for either generator and survives a preset switching between
  them.

### Known gaps

- At **default settings bloom still flattens the massing** at city zoom. The families are
  clearly distinct with bloom off; that is a post-processing problem, not a geometry one, and
  it is the next thing worth fixing.
- HELIX's twist is still sampled over 5–8 rings, so it reads as wrung rather than helical.
  `minRings` (decoupling geometric rings from floors — safe, since the shader takes its row
  count from `uFloors`, not from `v`) is the fix, in the pending HELIX step.
