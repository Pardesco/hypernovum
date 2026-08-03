import {
  loftRoofDeckY,
  stackFloors,
  stackRoofDeckY,
  type TowerLoftParams,
  type TowerSegment,
  type TowerStackParams,
} from './TowerLoft';

/**
 * Category → building families.
 *
 * DESIGN NOTE (2026-08-03). The families are built against the dimensions the
 * layout actually produces, which is narrower than the generator's clamps
 * suggest: `BinPacker` gives every building a 2–4 unit square footprint and one
 * of four heights (3.75 / 7.5 / 12.5 / 17.5), so `floors` is only ever 4, 5 or
 * 7. Any silhouette move smaller than ~20% of the plan radius is invisible at
 * that scale, which is why the previous vocabulary — one profile modulated by
 * ±12% — read as five identical tubes.
 *
 * The camera is fixed (pan and zoom, no orbit), so distinctness comes from
 * three things only: PLAN SHAPE, MASSING RHYTHM, and ROOFLINE. Each family
 * below differs from every other in at least two of them.
 *
 * Per-project determinism: jitter is seeded from the project path, so a note
 * always renders the same building. No Math.random.
 */

export interface TowerBuildInput {
  path: string;            // seeds deterministic jitter
  category: string;
  width: number;
  height: number;
  depth: number;
  detailScale?: number;    // optional density multiplier (default 1)
}

interface TowerBuildBase {
  floors: number;          // → shader uFloors (floor-true windows)
  diagrid: boolean;        // → shader uDiagrid
  /** Polygon facet count, or null for smooth profiles — window columns snap to it. */
  sides: number | null;
  /** Deck height — below the parapet lip, which is the bounding-box top. */
  roofDeckY: number;
}

export type TowerBuildResult =
  | (TowerBuildBase & { kind: 'loft'; params: TowerLoftParams })
  | (TowerBuildBase & { kind: 'stack'; params: TowerStackParams });

type Family = 'HELIX' | 'LEDGER' | 'BASTION' | 'HIVE' | 'BLOCK';

const CATEGORY_FAMILY: Record<string, Family> = {
  'web-apps': 'HELIX',
  content: 'LEDGER',
  'desktop-apps': 'LEDGER',
  infrastructure: 'BASTION',
  trading: 'BASTION',
  'obsidian-plugins': 'HIVE',
  // visualization/art previously leaned; they are quiet blocks until OBELISK lands
  visualization: 'BLOCK',
  art: 'BLOCK',
};

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// --- Deterministic per-path PRNG (FNV-1a hash → mulberry32) ---
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Split `total` floors across `parts` masses by weight, giving every mass at
 * least one floor and putting any remainder in the lowest (widest) mass, which
 * is where extra bulk reads as a plinth rather than a stub.
 */
function splitFloors(total: number, weights: number[]): number[] {
  const t = Math.max(1, Math.round(total));
  // Never ask for more masses than there are floors — the split must sum to
  // `total` exactly, or the building stops being its encoded height.
  const w = weights.slice(0, Math.min(weights.length, t));
  const parts = Math.max(1, w.length);
  const sum = w.reduce((acc, x) => acc + x, 0) || parts;
  const out = w.map((x) => Math.max(1, Math.floor((t * x) / sum)));
  let used = out.reduce((acc, x) => acc + x, 0);
  let i = 0;
  while (used < t) { out[i % parts] += 1; used += 1; i += 1; }
  while (used > t) {
    const k = out.findIndex((v, idx) => v > 1 && idx > 0);
    if (k === -1) break;
    out[k] -= 1; used -= 1;
  }
  return out;
}

/** Every category renders parametrically; unmapped ones get the quiet BLOCK. */
export function isParametricCategory(_category: string): boolean {
  return true;
}

export function presetForProject(input: TowerBuildInput): TowerBuildResult {
  const family = CATEGORY_FAMILY[input.category] ?? 'BLOCK';
  const rng = mulberry32(hashStr(input.path));
  const jitter = (amount: number) => (rng() * 2 - 1) * amount;

  const detailScale = input.detailScale ?? 1;
  const floors = Math.round(clamp((input.height / 2.5) * detailScale, 4, 28));
  const floorHeight = input.height / floors; // total height == the encoded height
  const a = input.width / 2;
  const b = input.depth / 2;

  const loft = (params: TowerLoftParams, diagrid = false): TowerBuildResult => ({
    kind: 'loft',
    params,
    floors,
    diagrid,
    sides: params.profile.kind === 'polygon' ? params.profile.sides : null,
    roofDeckY: loftRoofDeckY(params),
  });
  const stack = (params: TowerStackParams, diagrid = false): TowerBuildResult => ({
    kind: 'stack',
    params,
    floors: stackFloors(params),
    diagrid,
    sides: params.profile.kind === 'polygon' ? params.profile.sides : null,
    roofDeckY: stackRoofDeckY(params),
  });

  switch (family) {
    case 'HELIX':
      // web-apps. A single mass wrung about its axis — the only building whose
      // vertical edges are curves. Twist is this family's alone.
      return loft({
        profile: { kind: 'superellipse', a, b, n: 3.5, samples: 20 },
        floors, floorHeight, taper: 0.22, twistDeg: 78 + jitter(12),
        parapet: true,
      });

    case 'LEDGER': {
      // content, desktop-apps. Rectangular slabs stacked like books, each
      // rotated 90° from the last — the only alternating cross-plan in the city.
      // Aspect has to be IMPOSED: the layout always hands us width === depth.
      const slabs = clamp(Math.round(floors / 2), 2, 4);
      const spans = splitFloors(floors, new Array(slabs).fill(1));
      const chunky = input.category === 'desktop-apps';
      const segments: TowerSegment[] = spans.map((f, i) => ({
        floors: f,
        scale: (chunky ? 0.95 : 0.88) + rng() * (chunky ? 0.05 : 0.12),
        rotationDeg: (i % 2 === 0 ? 0 : 90) + jitter(6),
        taper: 0.03,
      }));
      return stack({
        profile: { kind: 'polygon', sides: 4, a, b: b * 0.62 },
        segments, floorHeight, facetedNormals: true, parapet: true,
      });
    }

    case 'BASTION': {
      // infrastructure, trading. Concentric masses telescoping in hard steps —
      // a staircase silhouette with a triple dark terrace. The steps are 26%
      // and 22%, roughly 3x what the old `setbacks` clamp could express.
      const tiers = floors >= 6 ? 3 : 2;
      const weights = tiers === 3 ? [0.45, 0.32, 0.23] : [0.6, 0.4];
      const spans = splitFloors(floors, weights);
      const scales = tiers === 3
        ? [1.0, 0.74 + jitter(0.05), 0.52 + jitter(0.05)]
        : [1.0, 0.68 + jitter(0.05)];
      const segments: TowerSegment[] = spans.map((f, i) => ({
        floors: f,
        scale: scales[i],
        rotationDeg: 0,
        taper: 0.05,
      }));
      return stack({
        profile: { kind: 'polygon', sides: 4, a, b },
        segments, floorHeight, facetedNormals: true, parapet: true,
      }, true);
    }

    case 'HIVE':
      // obsidian-plugins. Clean faceted hexagonal column. Straight: a twisted
      // hex prism reads like the facets are sliding off.
      return loft({
        profile: { kind: 'polygon', sides: 6, a, b },
        floors, floorHeight, taper: 0.14,
        facetedNormals: true, parapet: true,
      });

    case 'BLOCK':
    default:
      // Everything unmapped, plus visualization/art until OBELISK lands. A
      // deliberately ordinary near-straight tower — the foil that lets the
      // exotic silhouettes register as exotic.
      return stack({
        profile: { kind: 'superellipse', a, b, n: 3 + rng() * 5, samples: 20 },
        segments: [{ floors, scale: 1, rotationDeg: 0, taper: 0.04 + rng() * 0.06 }],
        floorHeight, parapet: true,
      });
  }
}
