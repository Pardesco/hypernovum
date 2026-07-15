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
  bulge?: number;            // β 0–0.08
  twistDeg?: number;         // Θ 0–120, cubic-smoothstep distribution
  waist?: { depth: number; at: number; width: number };
  crown?: { reduction: number; start: number };
  lean?: { dx: number; dz: number; sCurve?: boolean };
  setbacks?: { at: number; depth: number }[];
  facetedNormals?: boolean;  // crisp per-facet normals (polygon / preset D)
}

// --- Clamp ranges (§7.11) ---
const CLAMP = {
  floors: [3, 40] as const,
  samples: [8, 32] as const,
  sides: [3, 12] as const,
  taper: [0, 0.35] as const,
  bulge: [0, 0.08] as const,
  twistDeg: [0, 120] as const,
  waistDepth: [0, 0.10] as const,
  crownReduction: [0, 0.20] as const,
  setbackDepth: [0.04, 0.12] as const,
  maxSetbacks: 4,
  minScale: 0.08,          // floor scale never collapses to a degenerate ring
  leanFrac: 0.12,          // |lean| ≤ 0.12·H total
};

function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

function smootherstep(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

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
  const bulge = clamp(params.bulge ?? 0, CLAMP.bulge[0], CLAMP.bulge[1]);
  const twist = (clamp(params.twistDeg ?? 0, CLAMP.twistDeg[0], CLAMP.twistDeg[1]) * Math.PI) / 180;
  const H = floors * floorHeight;

  if (!Number.isFinite(params.floors) || params.floors < CLAMP.floors[0]) {
    debugLog('[TowerLoft] floors out of range, clamped', params.floors, '→', floors);
  }

  const waist = params.waist
    ? { depth: clamp(params.waist.depth, CLAMP.waistDepth[0], CLAMP.waistDepth[1]), at: clamp(params.waist.at, 0.45, 0.7), width: clamp(params.waist.width, 0.12, 0.25) }
    : null;
  const crown = params.crown
    ? { reduction: clamp(params.crown.reduction, CLAMP.crownReduction[0], CLAMP.crownReduction[1]), start: clamp(params.crown.start, 0.75, 0.9) }
    : null;
  const setbacks = (params.setbacks ?? []).slice(0, CLAMP.maxSetbacks).map((s) => ({
    at: clamp(s.at, 0.05, 0.95),
    depth: clamp(s.depth, CLAMP.setbackDepth[0], CLAMP.setbackDepth[1]),
  }));

  // Lean offsets are clamped to a fraction of total height.
  const leanCap = CLAMP.leanFrac * H;
  const lean = params.lean
    ? { dx: clamp(params.lean.dx, -leanCap, leanCap), dz: clamp(params.lean.dz, -leanCap, leanCap), sCurve: !!params.lean.sCurve }
    : null;

  const { pts: profile, m } = sampleProfile(params.profile);

  // Per-ring scale, twist and centerline.
  const scaleAt = (v: number): number => {
    let s = 1 - taper * v + bulge * Math.sin(Math.PI * v);
    if (waist) s -= waist.depth * Math.exp(-Math.pow((v - waist.at) / waist.width, 2));
    if (crown) s -= crown.reduction * smoothstep(crown.start, 1.0, v);
    for (const sb of setbacks) s -= sb.depth * smoothstep(sb.at - 0.02, sb.at + 0.02, v);
    return Math.max(s, CLAMP.minScale);
  };
  const twistAt = (v: number): number => twist * smoothstep(0, 1, v);
  const leanAt = (v: number): { x: number; z: number } => {
    if (!lean) return { x: 0, z: 0 };
    const c = lean.sCurve ? smootherstep(v) : smoothstep(0, 1, v);
    return { x: lean.dx * c, z: lean.dz * c };
  };

  const cols = m + 1;          // duplicate seam column so u reaches 1
  const rings = floors + 1;
  const gridVerts = cols * rings;
  const totalVerts = gridVerts + 1; // + roof-cap center

  const positions = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);

  for (let i = 0; i < rings; i++) {
    const v = i / floors;
    const s = scaleAt(v);
    const th = twistAt(v);
    const cth = Math.cos(th), sth = Math.sin(th);
    const off = leanAt(v);
    const y = i * floorHeight;
    for (let j = 0; j < cols; j++) {
      const p = profile[j % m];
      const sx = p.x * s, sz = p.z * s;
      const x = sx * cth - sz * sth + off.x;
      const z = sx * sth + sz * cth + off.z;
      const idx = i * cols + j;
      positions[idx * 3] = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = z;
      uvs[idx * 2] = j / m;
      uvs[idx * 2 + 1] = v;
    }
  }

  // Roof-cap center at the top ring's centerline.
  const topOff = leanAt(1);
  const capIdx = gridVerts;
  positions[capIdx * 3] = topOff.x;
  positions[capIdx * 3 + 1] = H;
  positions[capIdx * 3 + 2] = topOff.z;
  uvs[capIdx * 2] = 0.5;
  uvs[capIdx * 2 + 1] = 1;

  // Indices — wall quads (2 tris each) + roof-cap fan.
  const indices: number[] = [];
  for (let i = 0; i < floors; i++) {
    for (let j = 0; j < m; j++) {
      const a = i * cols + j;
      const b = i * cols + j + 1;
      const c = (i + 1) * cols + j + 1;
      const d = (i + 1) * cols + j;
      indices.push(a, b, d, b, c, d); // outward-facing winding
    }
  }
  const topBase = floors * cols;
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

/** Vertex count of the INDEXED grid (before any toNonIndexed) — for tests. */
export function loftVertexCount(params: TowerLoftParams): number {
  const floors = Math.round(clamp(params.floors, CLAMP.floors[0], CLAMP.floors[1]));
  const m = params.profile.kind === 'polygon'
    ? Math.round(clamp(params.profile.sides, CLAMP.sides[0], CLAMP.sides[1]))
    : Math.round(clamp(params.profile.samples, CLAMP.samples[0], CLAMP.samples[1]));
  return (m + 1) * (floors + 1) + 1;
}
