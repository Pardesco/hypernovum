import type { TowerLoftParams } from './TowerLoft';

/**
 * Category → TowerLoft preset families (BLD-003). Maps a project's category +
 * dimensions to concrete loft params, preserving the existing visual encoding
 * (priority → overall height) while giving each family a distinct silhouette.
 *
 * Per-project determinism: small jitter on twist/waist/lean seeded from the
 * project path, so a given note always renders the same tower (no Math.random).
 * Preset ↔ category assignment is an art call (U2) — retune the constants freely.
 *
 * Unmapped categories return null → the caller falls back to the classic
 * BuildingFactory silhouette, byte-for-byte as before.
 */

export interface TowerBuildInput {
  path: string;            // seeds deterministic jitter
  category: string;
  width: number;
  height: number;
  depth: number;
  detailScale?: number;    // optional density multiplier (default 1)
}

export interface TowerBuildResult {
  params: TowerLoftParams;
  floors: number;          // → shader uFloors (floor-true windows)
  diagrid: boolean;        // → shader uDiagrid (preset D facades)
}

type Family = 'A' | 'B' | 'C' | 'D';

const CATEGORY_FAMILY: Record<string, Family> = {
  'web-apps': 'A',
  content: 'B',
  'desktop-apps': 'B',
  visualization: 'C',
  art: 'C',
  infrastructure: 'D',
  trading: 'D',
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

/** Which categories render as parametric towers (the rest fall back to classic). */
export function isParametricCategory(category: string): boolean {
  return category in CATEGORY_FAMILY;
}

/**
 * Build the loft params + shader hints for a project, or null for unmapped
 * categories (caller uses the classic silhouette).
 */
export function presetForProject(input: TowerBuildInput): TowerBuildResult | null {
  const family = CATEGORY_FAMILY[input.category];
  if (!family) return null;

  const rng = mulberry32(hashStr(input.path));
  const jitter = (amount: number) => (rng() * 2 - 1) * amount; // symmetric ±amount

  const detailScale = input.detailScale ?? 1;
  const floors = Math.round(clamp((input.height / 2.5) * detailScale, 4, 28));
  const floorHeight = input.height / floors; // total height == the encoded height
  const a = input.width / 2;
  const b = input.depth / 2;

  let params: TowerLoftParams;
  let diagrid = false;

  switch (family) {
    case 'A': // Spiral — web-apps
      params = {
        profile: { kind: 'superellipse', a, b, n: 3.5, samples: 20 },
        floors, floorHeight, taper: 0.22, twistDeg: 65 + jitter(10),
      };
      break;
    case 'B': // Sculpted waist — content, desktop-apps
      params = {
        profile: { kind: 'superellipse', a, b, n: 4, samples: 24 },
        floors, floorHeight, taper: 0.10,
        waist: { depth: 0.06 + jitter(0.02), at: 0.6, width: 0.18 },
        crown: { reduction: 0.12, start: 0.82 },
      };
      break;
    case 'C': // Leaning S-curve — visualization, art
      params = {
        profile: { kind: 'superellipse', a, b, n: 2, samples: 18 },
        floors, floorHeight, taper: 0.20, twistDeg: 10,
        lean: { dx: input.height * 0.06 * (rng() < 0.5 ? -1 : 1), dz: input.height * jitter(0.02), sCurve: true },
      };
      break;
    case 'D': // Faceted octagon + setbacks — infrastructure, trading
    default:
      params = {
        profile: { kind: 'polygon', sides: 8, a, b },
        floors, floorHeight, taper: 0.25, twistDeg: 30 + jitter(6),
        setbacks: [{ at: 0.4, depth: 0.08 }, { at: 0.7, depth: 0.08 }],
        facetedNormals: true,
      };
      diagrid = true;
      break;
  }

  return { params, floors, diagrid };
}
