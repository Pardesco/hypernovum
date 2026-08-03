import * as THREE from 'three';
import { debugLog } from '../utils/log';

/**
 * TowerLoft (BLD-001) — a pure, deterministic loft generator for parametric
 * "data-true" towers. Given a profile and a stack of shape parameters it lofts
 * a bottom-anchored BufferGeometry with param-grid UVs and computed normals.
 *
 * All ranges are hard-clamped INSIDE the function (never throws): invalid input
 * is clamped and logged. Determinism is guaranteed — same params → identical
 * buffers (no Math.random / Date.now). See §7.11 for the parameter contract and
 * BLD-002 for the invariants this must satisfy.
 */

export type TowerProfile =
  | { kind: 'superellipse'; a: number; b: number; n: number; samples: number }
  | { kind: 'polygon'; sides: number; a: number; b: number };

export interface TowerLoftParams {
  profile: TowerProfile;
  floors: number;            // 3–40 discrete floor plates → floors+1 rings
  floorHeight: number;       // world units per floor (≈2.5)
  taper: number;             // τ 0–0.35
  twistDeg?: number;         // Θ 0–120, cubic-smoothstep distribution
  setbacks?: { at: number; depth: number }[];
  facetedNormals?: boolean;  // crisp per-facet normals (polygon profiles)
  parapet?: boolean;         // raised roof lip + recessed deck (BLD-P2)
  /**
   * Minimum geometric rings, independent of `floors`. A 90-degree twist across
   * the 5-8 rings the layout actually produces reads as wrung rather than
   * helical. Safe to decouple: the shader takes its window ROW count from
   * `uFloors`, not from `v`, so rows stay floor-true however finely we sample.
   */
  minRings?: number;
}

/*
 * REMOVED 2026-08-03: `lean`, `waist`, `bulge`, `crown`.
 *
 * BinPacker gives every building a 2–4 unit footprint and one of four heights,
 * so `floors` is only ever 4, 5 or 7 — every one of these knobs was sampled
 * across 5–8 rings on a 1–2 unit radius, and its own clamp guaranteed the
 * result was sub-visible (a `waist` of 0.10 is a 0.1-unit dent). `lean` was
 * worse than invisible: an ellipse bent on a smootherstep reads as wilting, the
 * fixed camera turns a lateral lean into "falling over", and it existed only to
 * be corrected for by the rooftop anchor plumbing.
 *
 * Massing is now expressed by `loftStack` below — real stacked volumes, which
 * is the frequency band this camera can actually resolve.
 */

// Parapet proportions. The lip is folded INSIDE the encoded height (the wall is
// shortened to make room) so total height still equals floors·floorHeight —
// "height encodes priority" stays exact — and it steps INWARD, never outward,
// so the footprint invariant and the foundation hit pad are unaffected.
const PARAPET = {
  lipFrac: 0.35,    // of one floor height
  maxFrac: 0.12,    // never more than this fraction of total height
  inset: 0.06,      // step inward at the top of the lip
  deckDrop: 0.6,    // deck sits this fraction of the lip below its top
};

function resolveParapet(params: TowerLoftParams): { lip: number; deckY: number; ringH: number; H: number } {
  const floors = Math.round(clamp(params.floors, CLAMP.floors[0], CLAMP.floors[1]));
  const floorHeight = params.floorHeight > 0 ? params.floorHeight : 2.5;
  const H = floors * floorHeight;
  // Exact passthrough when off: ringH must stay the literal floorHeight so the
  // no-parapet geometry is bit-for-bit what it was before this existed.
  if (!params.parapet) return { lip: 0, deckY: H, ringH: floorHeight, H };
  const lip = Math.min(PARAPET.lipFrac * floorHeight, H * PARAPET.maxFrac);
  return { lip, deckY: H - lip * PARAPET.deckDrop, ringH: (H - lip) / floors, H };
}

/** Height of the walkable roof deck — where rooftop props actually sit. */
export function loftRoofDeckY(params: TowerLoftParams): number {
  return resolveParapet(params).deckY;
}

// --- Clamp ranges (§7.11) ---
const CLAMP = {
  floors: [3, 40] as const,
  samples: [8, 32] as const,
  sides: [3, 12] as const,
  taper: [0, 0.35] as const,
  twistDeg: [0, 120] as const,
  setbackDepth: [0.04, 0.12] as const,
  maxSetbacks: 4,
  minScale: 0.08,          // floor scale never collapses to a degenerate ring
  // loftStack massing ranges
  segments: [1, 6] as const,
  segScale: [0.15, 1] as const,
  segTaper: [0, 0.3] as const,
};

function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

/** One horizontal ring of the loft: plan scale, plan rotation, height, and its v. */
interface Ring { y: number; s: number; th: number; v: number; shear?: number }

/** Sample the base (unit) profile ring: M points, x∈[-a,a], z∈[-b,b]. */
function sampleProfile(profile: TowerProfile): { pts: { x: number; z: number }[]; m: number } {
  if (profile.kind === 'polygon') {
    const sides = Math.round(clamp(profile.sides, CLAMP.sides[0], CLAMP.sides[1]));
    const a = profile.a, b = profile.b;
    const pts: { x: number; z: number }[] = [];
    for (let j = 0; j < sides; j++) {
      const t = (2 * Math.PI * j) / sides - Math.PI / 2; // start at +Z (front)
      pts.push({ x: a * Math.cos(t), z: b * Math.sin(t) });
    }
    return { pts, m: sides };
  }
  // superellipse
  const m = Math.round(clamp(profile.samples, CLAMP.samples[0], CLAMP.samples[1]));
  const n = clamp(profile.n, 2, 5);
  const a = profile.a, b = profile.b;
  const pts: { x: number; z: number }[] = [];
  const p = 2 / n;
  for (let j = 0; j < m; j++) {
    const t = (2 * Math.PI * j) / m;
    const ct = Math.cos(t), st = Math.sin(t);
    pts.push({
      x: a * Math.sign(ct) * Math.pow(Math.abs(ct), p),
      z: b * Math.sign(st) * Math.pow(Math.abs(st), p),
    });
  }
  return { pts, m };
}

/**
 * Generate the tower geometry. Bottom-anchored (base ring at y=0), UVs
 * (u = column/m, v = ring/floors), normals computed. Faceted profiles return a
 * non-indexed buffer for crisp per-triangle normals.
 */
export function loftTower(params: TowerLoftParams): THREE.BufferGeometry {
  const floors = Math.round(clamp(params.floors, CLAMP.floors[0], CLAMP.floors[1]));
  const floorHeight = params.floorHeight > 0 ? params.floorHeight : 2.5;
  const taper = clamp(params.taper, CLAMP.taper[0], CLAMP.taper[1]);
  const twist = (clamp(params.twistDeg ?? 0, CLAMP.twistDeg[0], CLAMP.twistDeg[1]) * Math.PI) / 180;
  const H = floors * floorHeight;

  if (!Number.isFinite(params.floors) || params.floors < CLAMP.floors[0]) {
    debugLog('[TowerLoft] floors out of range, clamped', params.floors, '→', floors);
  }

  const setbacks = (params.setbacks ?? []).slice(0, CLAMP.maxSetbacks).map((s) => ({
    at: clamp(s.at, 0.05, 0.95),
    depth: clamp(s.depth, CLAMP.setbackDepth[0], CLAMP.setbackDepth[1]),
  }));

  const { pts: profile, m } = sampleProfile(params.profile);

  // Per-ring scale and twist.
  const scaleAt = (v: number): number => {
    let s = 1 - taper * v;
    for (const sb of setbacks) s -= sb.depth * smoothstep(sb.at - 0.02, sb.at + 0.02, v);
    return Math.max(s, CLAMP.minScale);
  };
  const twistAt = (v: number): number => twist * smoothstep(0, 1, v);

  const cols = m + 1;          // duplicate seam column so u reaches 1
  const par = resolveParapet(params);

  // Ring stack: floors+1 wall rings, then optionally three parapet rings — the
  // outer lip, a step inward at the same height, and the inner face dropping to
  // the deck. The generic strip loop below gives each the correct outward
  // normal for free: the inward step at constant y resolves to up-facing, and
  // the constant-radius drop resolves to inward-facing.
  const ringCount = Math.max(floors, Math.round(clamp(params.minRings ?? 0, 0, 64)));
  const ringStack: Ring[] = [];
  for (let i = 0; i <= ringCount; i++) {
    const v = i / ringCount;
    ringStack.push({ y: v * (par.H - par.lip), s: scaleAt(v), th: twistAt(v), v });
  }
  if (par.lip > 0) {
    const sTop = scaleAt(1), thTop = twistAt(1);
    const sInner = sTop * (1 - PARAPET.inset);
    // v pinned to 1 so the window grid never runs onto the parapet.
    ringStack.push({ y: par.H, s: sTop, th: thTop, v: 1 });
    ringStack.push({ y: par.H, s: sInner, th: thTop, v: 1 });
    ringStack.push({ y: par.deckY, s: sInner, th: thTop, v: 1 });
  }

  const rings = ringStack.length;
  const gridVerts = cols * rings;
  const totalVerts = gridVerts + 1; // + roof-cap center

  const positions = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);

  for (let i = 0; i < rings; i++) {
    const r = ringStack[i];
    const cth = Math.cos(r.th), sth = Math.sin(r.th);
    for (let j = 0; j < cols; j++) {
      const p = profile[j % m];
      const sx = p.x * r.s, sz = p.z * r.s;
      const x = sx * cth - sz * sth;
      const z = sx * sth + sz * cth;
      const idx = i * cols + j;
      positions[idx * 3] = x;
      positions[idx * 3 + 1] = r.y;
      positions[idx * 3 + 2] = z;
      uvs[idx * 2] = j / m;
      uvs[idx * 2 + 1] = r.v;
    }
  }

  // Roof-cap center at deck level.
  const capIdx = gridVerts;
  positions[capIdx * 3] = 0;
  positions[capIdx * 3 + 1] = par.deckY;
  positions[capIdx * 3 + 2] = 0;
  uvs[capIdx * 2] = 0.5;
  uvs[capIdx * 2 + 1] = 1;

  // Indices — strip quads (2 tris each) + roof-cap fan.
  const indices: number[] = [];
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < m; j++) {
      const a = i * cols + j;
      const b = i * cols + j + 1;
      const c = (i + 1) * cols + j + 1;
      const d = (i + 1) * cols + j;
      indices.push(a, b, d, b, c, d); // outward-facing winding
    }
  }
  const topBase = (rings - 1) * cols;
  for (let j = 0; j < m; j++) {
    indices.push(topBase + j, capIdx, topBase + j + 1); // fan → upward normal
  }

  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  // Crisp facets: expand to non-indexed so each triangle gets its own normal.
  if (params.facetedNormals) {
    geometry = geometry.toNonIndexed();
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  return geometry;
}

// ---------------------------------------------------------------------------
// TowerStack — massing by stacked volumes
// ---------------------------------------------------------------------------

/** One mass in a stack. Plan shape is shared; scale and rotation are per-mass. */
export interface TowerSegment {
  floors: number;         // floors this mass occupies (≥1)
  scale: number;          // plan scale relative to the shared profile
  rotationDeg?: number;   // plan rotation of this mass
  taper?: number;         // taper within this mass
  /** Explicit end scale — overrides `taper`. Lets a mass close to a point. */
  scaleTop?: number;
}

/** A parallel column fused to the main stack — the cluster form. */
export interface TowerSatellite {
  dx: number;             // plan offset from the axis
  dz: number;
  floors: number;
  scale: number;
  rotationDeg?: number;
}

export interface TowerStackParams {
  /** Shared plan shape. Segments vary scale and rotation, never vertex count. */
  profile: TowerProfile;
  segments: TowerSegment[];
  floorHeight: number;
  facetedNormals?: boolean;
  parapet?: boolean;      // parapet on the topmost mass
  /** Extra columns fused alongside the stack, each a closed prism of its own. */
  satellites?: TowerSatellite[];
  /**
   * Cut the top ring on a diagonal, as a fraction of total height. The roof
   * plane tilts across the long plan axis — the only asymmetric roofline in
   * the city. Folded inside the encoded height, and mutually exclusive with
   * `parapet` (a slashed roof has no rail).
   */
  shear?: number;
}

/**
 * Loft a stack of discrete masses.
 *
 * Each segment is a CLOSED prism — bottom cap, walls, top cap — rather than a
 * welded continuation of the one below. That is deliberate: masses may rotate
 * in plan relative to each other, and welding ring j of a 0° square to ring j
 * of a 90° square produces a folded, self-intersecting surface at zero height.
 * Closing each mass also means an upper mass may legitimately overhang a lower
 * one (the stacked-slab look) without leaving a hole.
 *
 * The `v` axis is floor-true across the WHOLE stack and pinned at every mass
 * boundary, so the shader's window rows stay aligned with real floors and never
 * smear across a ledge. Up-facing ledges are picked up by the shader's roof mask
 * automatically, and their 90° creases by the edge-glow threshold — both were
 * built for exactly this geometry.
 */
export function loftStack(params: TowerStackParams): THREE.BufferGeometry {
  const floorHeight = params.floorHeight > 0 ? params.floorHeight : 2.5;
  const segs = (params.segments ?? [])
    .slice(0, CLAMP.segments[1])
    .map((s) => ({
      floors: Math.max(1, Math.round(Number.isFinite(s.floors) ? s.floors : 1)),
      scale: clamp(s.scale, CLAMP.segScale[0], CLAMP.segScale[1]),
      rot: ((Number.isFinite(s.rotationDeg) ? s.rotationDeg! : 0) * Math.PI) / 180,
      taper: clamp(s.taper ?? 0, CLAMP.segTaper[0], CLAMP.segTaper[1]),
      scaleTop: s.scaleTop === undefined ? undefined : clamp(s.scaleTop, 0.02, 1),
    }));
  if (segs.length === 0) {
    debugLog('[TowerStack] no segments; falling back to a single unit mass');
    segs.push({ floors: 4, scale: 1, rot: 0, taper: 0, scaleTop: undefined });
  }

  const totalFloors = segs.reduce((n, s) => n + s.floors, 0);
  const { pts: profile, m } = sampleProfile(params.profile);
  const cols = m + 1;
  const H = totalFloors * floorHeight;

  // Parapet is folded inside the encoded height exactly as in loftTower, and it
  // only shortens the TOP mass — total height still equals totalFloors·floorHeight.
  const lip = params.parapet ? Math.min(PARAPET.lipFrac * floorHeight, H * PARAPET.maxFrac) : 0;
  const deckY = H - lip * PARAPET.deckDrop;
  // Shear is folded inside H: the ring's mean stays put and the cut tilts about
  // it, so the tallest corner lands exactly at H. Never combined with a parapet.
  const shearFrac = lip > 0 ? 0 : clamp(params.shear ?? 0, 0, 0.35);
  const shear = shearFrac * H * 0.5;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const push = (x: number, y: number, z: number, u: number, v: number) => {
    positions.push(x, y, z);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };
  // Widest |x| in the plan — normalises the shear so the cut is a clean plane.
  let aMax = 1e-6;
  for (const p of profile) aMax = Math.max(aMax, Math.abs(p.x));

  const ringVerts = (r: Ring, ox = 0, oz = 0) => {
    const cth = Math.cos(r.th), sth = Math.sin(r.th);
    const first = positions.length / 3;
    for (let j = 0; j < cols; j++) {
      const p = profile[j % m];
      const sx = p.x * r.s, sz = p.z * r.s;
      // Shear tilts this ring across the plan's long axis, per vertex.
      const dy = (r.shear ?? 0) * (p.x / aMax);
      push(sx * cth - sz * sth + ox, r.y + dy, sx * sth + sz * cth + oz, j / m, r.v);
    }
    return first;
  };

  /** Emit one closed prism (bottom cap, walls, top cap) from a ring list. */
  const emitPrism = (rings: Ring[], ox = 0, oz = 0) => {
    const ringStart = rings.map((r) => ringVerts(r, ox, oz));
    const botCenter = push(ox, rings[0].y, oz, 0.5, rings[0].v);
    for (let j = 0; j < m; j++) {
      indices.push(ringStart[0] + j + 1, botCenter, ringStart[0] + j);
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < m; j++) {
        const a = ringStart[i] + j;
        const b = ringStart[i] + j + 1;
        const c = ringStart[i + 1] + j + 1;
        const d = ringStart[i + 1] + j;
        indices.push(a, b, d, b, c, d);
      }
    }
    const last = rings.length - 1;
    // A sheared top ring has no single height; anchor the cap at its mean.
    const topCenter = push(ox, rings[last].y, oz, 0.5, rings[last].v);
    for (let j = 0; j < m; j++) {
      indices.push(ringStart[last] + j, topCenter, ringStart[last] + j + 1);
    }
  };

  let floorCursor = 0;
  segs.forEach((seg, segIndex) => {
    const isTop = segIndex === segs.length - 1;
    const segBaseY = floorCursor * floorHeight;
    // The top mass gives up `lip` of its height so the parapet fits inside H.
    const segH = seg.floors * floorHeight - (isTop ? lip + shear : 0);
    const ringH = segH / seg.floors;

    const rings: Ring[] = [];
    for (let i = 0; i <= seg.floors; i++) {
      const t = i / seg.floors;
      // scaleTop wins over taper: it lets a mass close to a point (a spire).
      const s = seg.scaleTop !== undefined
        ? seg.scale + (seg.scaleTop - seg.scale) * t
        : seg.scale * (1 - seg.taper * t);
      rings.push({
        y: segBaseY + i * ringH,
        s: Math.max(s, 0.02),
        th: seg.rot,
        v: (floorCursor + i) / totalFloors,
        shear: isTop && i === seg.floors ? shear : 0,
      });
    }
    if (isTop && lip > 0) {
      const sTop = rings[rings.length - 1].s;
      const sInner = sTop * (1 - PARAPET.inset);
      rings.push({ y: H, s: sTop, th: seg.rot, v: 1 });
      rings.push({ y: H, s: sInner, th: seg.rot, v: 1 });
      rings.push({ y: deckY, s: sInner, th: seg.rot, v: 1 });
    }

    // Every mass is closed: a rotated or wider mass can overhang the one below,
    // and an open underside would show through.
    emitPrism(rings);
    floorCursor += seg.floors;
  });

  // Satellites — parallel columns fused alongside, sharing floorHeight so their
  // window rows line up with the main column's.
  for (const sat of params.satellites ?? []) {
    const sf = Math.max(1, Math.round(sat.floors));
    const rings: Ring[] = [];
    for (let i = 0; i <= sf; i++) {
      rings.push({
        y: i * floorHeight,
        s: clamp(sat.scale, CLAMP.segScale[0], CLAMP.segScale[1]),
        th: ((sat.rotationDeg ?? 0) * Math.PI) / 180,
        v: (i / sf) * (sf / totalFloors),
      });
    }
    emitPrism(rings, sat.dx, sat.dz);
  }

  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  if (params.facetedNormals) geometry = geometry.toNonIndexed();
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

/** Total floors across a stack — the shader's `uFloors` (rows stay floor-true). */
export function stackFloors(params: TowerStackParams): number {
  return (params.segments ?? []).reduce((n, s) => n + Math.max(1, Math.round(s.floors || 1)), 0) || 4;
}

/** Deck height for rooftop props — below the parapet lip, which is the bbox top. */
export function stackRoofDeckY(params: TowerStackParams): number {
  const floorHeight = params.floorHeight > 0 ? params.floorHeight : 2.5;
  const H = stackFloors(params) * floorHeight;
  if (params.parapet) {
    return H - Math.min(PARAPET.lipFrac * floorHeight, H * PARAPET.maxFrac) * PARAPET.deckDrop;
  }
  // A sheared roof's centre sits below its high corner; props go on the centre.
  return H - clamp(params.shear ?? 0, 0, 0.35) * H * 0.5;
}

/** Indexed vertex count — for tests. */
export function stackVertexCount(params: TowerStackParams): number {
  const m = params.profile.kind === 'polygon'
    ? Math.round(clamp(params.profile.sides, CLAMP.sides[0], CLAMP.sides[1]))
    : Math.round(clamp(params.profile.samples, CLAMP.samples[0], CLAMP.samples[1]));
  const segs = (params.segments ?? []).slice(0, CLAMP.segments[1]);
  const n = segs.length || 1;
  const ringTotal = segs.reduce((acc, s) => acc + Math.max(1, Math.round(s.floors || 1)) + 1, 0)
    + (params.parapet ? 3 : 0);
  const sats = params.satellites ?? [];
  const satRings = sats.reduce((acc, x) => acc + Math.max(1, Math.round(x.floors || 1)) + 1, 0);
  // + 2 cap centres per closed prism (segments and satellites alike)
  return (m + 1) * ((ringTotal || 5) + satRings) + 2 * (n + sats.length);
}

const stackCache = new Map<string, THREE.BufferGeometry>();

export function loftStackCached(params: TowerStackParams): THREE.BufferGeometry {
  const key = JSON.stringify(params);
  let geo = stackCache.get(key);
  if (!geo) {
    if (stackCache.size >= CACHE_LIMIT) clearStackCache();
    geo = loftStack(params);
    stackCache.set(key, geo);
  }
  return geo.clone();
}

export function clearStackCache(): void {
  for (const g of stackCache.values()) g.dispose();
  stackCache.clear();
}

// --- Geometry cache (BLD-006) ---
// Keyed by the full param set (deterministic → stable across rebuilds). Sharing
// attribute buffers across meshes is fragile in three, so we cache the built
// geometry and return a .clone() per building. Callers may mutate their clone.
const geometryCache = new Map<string, THREE.BufferGeometry>();
const CACHE_LIMIT = 512;

export function loftTowerCached(params: TowerLoftParams): THREE.BufferGeometry {
  const key = JSON.stringify(params);
  let geo = geometryCache.get(key);
  if (!geo) {
    if (geometryCache.size >= CACHE_LIMIT) clearLoftCache();
    geo = loftTower(params);
    geometryCache.set(key, geo);
  }
  return geo.clone();
}

export function clearLoftCache(): void {
  for (const g of geometryCache.values()) g.dispose();
  geometryCache.clear();
}

/**
 * Where the top ring's centerline actually sits, in the geometry's local XZ.
 *
 * Leaning presets translate the centerline by up to `leanFrac`·H — far outside
 * the rooftop safe radius — so anything mounted on the roof (greeble kit,
 * beacon, quest marker) has to be offset by this or it hangs in mid-air beside
 * the building. At v=1 both easings resolve to 1, so this is just the clamped
 * @deprecated Lean was removed on 2026-08-03 — always returns the origin.
 *   Kept as an export because `@hypernovum/core` is published (see docs/DEAD-CODE.md).
 */
export function loftTopCenter(_params: TowerLoftParams): { x: number; z: number } {
  return { x: 0, z: 0 };
}

/** Vertex count of the INDEXED grid (before any toNonIndexed) — for tests. */
export function loftVertexCount(params: TowerLoftParams): number {
  const floors = Math.round(clamp(params.floors, CLAMP.floors[0], CLAMP.floors[1]));
  const m = params.profile.kind === 'polygon'
    ? Math.round(clamp(params.profile.sides, CLAMP.sides[0], CLAMP.sides[1]))
    : Math.round(clamp(params.profile.samples, CLAMP.samples[0], CLAMP.samples[1]));
  const ringCount = Math.max(floors, Math.round(clamp(params.minRings ?? 0, 0, 64)));
  // Parapet adds three rings: outer lip, inward step, inner face.
  return (m + 1) * (ringCount + 1 + (params.parapet ? 3 : 0)) + 1;
}
