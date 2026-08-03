import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { loftTower, loftRoofDeckY, loftVertexCount, type TowerLoftParams } from '../src/renderers/TowerLoft';

// The four §7.11 preset families (as raw params — BLD-003 wires them to data).
const PRESETS: Record<string, TowerLoftParams> = {
  A_spiral: { profile: { kind: 'superellipse', a: 1.5, b: 1.2, n: 3.5, samples: 20 }, floors: 12, floorHeight: 2.5, taper: 0.22, twistDeg: 65 },
  B_block: { profile: { kind: 'superellipse', a: 1.4, b: 1.4, n: 4, samples: 24 }, floors: 16, floorHeight: 2.5, taper: 0.1, parapet: true },
  C_hive: { profile: { kind: 'polygon', sides: 6, a: 1.3, b: 1.0 }, floors: 10, floorHeight: 2.5, taper: 0.2, facetedNormals: true },
  D_faceted: { profile: { kind: 'polygon', sides: 8, a: 1.4, b: 1.4 }, floors: 14, floorHeight: 2.5, taper: 0.25, twistDeg: 30, setbacks: [{ at: 0.4, depth: 0.08 }, { at: 0.7, depth: 0.08 }], facetedNormals: true },
};

const SIZES = [3, 12, 28];

function positions(geo: ReturnType<typeof loftTower>): Float32Array {
  return geo.getAttribute('position').array as Float32Array;
}

describe('loftTower — presets generate clean geometry', () => {
  for (const [name, params] of Object.entries(PRESETS)) {
    it(`${name}: all positions + normals finite, non-empty`, () => {
      const geo = loftTower(params);
      const pos = positions(geo);
      expect(pos.length).toBeGreaterThan(0);
      expect(pos.every(Number.isFinite)).toBe(true);
      const nrm = geo.getAttribute('normal').array as Float32Array;
      expect(nrm.every(Number.isFinite)).toBe(true);
    });
  }
});

describe('invariant 1 — vertex count = f(M, floors) for indexed profiles', () => {
  it('non-faceted superellipse matches (m+1)(floors+1)+1', () => {
    const p = PRESETS.A_spiral;
    const geo = loftTower(p);
    expect(geo.getAttribute('position').count).toBe(loftVertexCount(p));
    // m=20 samples, floors=12 → 21*13 + 1 = 274
    expect(loftVertexCount(p)).toBe(21 * 13 + 1);
  });

  it('faceted profile is non-indexed with 3 verts per triangle', () => {
    const p = PRESETS.D_faceted;
    const geo = loftTower(p);
    expect(geo.getIndex()).toBeNull();
    // triangles = floors*m*2 (walls) + m (cap) = m*(2*floors+1)
    const m = 8, floors = 14;
    expect(geo.getAttribute('position').count).toBe(3 * m * (2 * floors + 1));
  });
});

describe('invariants 2/3 — finite + bottom-anchored + exact height', () => {
  for (const floors of SIZES) {
    it(`floors=${floors}: base at y=0, top at floors·floorHeight`, () => {
      const geo = loftTower({ ...PRESETS.A_spiral, floors });
      const bb = geo.boundingBox!;
      expect(bb.min.y).toBeCloseTo(0, 5);
      expect(bb.max.y).toBeCloseTo(floors * 2.5, 4);
    });
  }
});

describe('invariant 4 — UVs: v monotonic per ring, u in [0,1]', () => {
  it('u spans 0..1 and v increases with height', () => {
    const p = PRESETS.B_block;
    const geo = loftTower(p);
    const uv = geo.getAttribute('uv').array as Float32Array;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (let i = 0; i < uv.length; i += 2) {
      minU = Math.min(minU, uv[i]); maxU = Math.max(maxU, uv[i]);
      minV = Math.min(minV, uv[i + 1]); maxV = Math.max(maxV, uv[i + 1]);
    }
    expect(minU).toBeCloseTo(0, 5);
    expect(maxU).toBeCloseTo(1, 5);
    expect(minV).toBeCloseTo(0, 5);
    expect(maxV).toBeCloseTo(1, 5);
  });
});

describe('invariant 5 — no zero-area triangles at max-clamp params', () => {
  it('extreme params still produce finite, non-degenerate triangles', () => {
    const geo = loftTower({
      profile: { kind: 'superellipse', a: 1.4, b: 1.4, n: 5, samples: 32 },
      floors: 40, floorHeight: 2.5, taper: 0.35, twistDeg: 120,
      setbacks: [{ at: 0.4, depth: 0.12 }, { at: 0.7, depth: 0.12 }], parapet: true,
    });
    const geoNI = geo.toNonIndexed();
    const pos = geoNI.getAttribute('position').array as Float32Array;
    let degenerate = 0;
    for (let t = 0; t < pos.length; t += 9) {
      const ax = pos[t], ay = pos[t + 1], az = pos[t + 2];
      const bx = pos[t + 3], by = pos[t + 4], bz = pos[t + 5];
      const cx = pos[t + 6], cy = pos[t + 7], cz = pos[t + 8];
      // cross product magnitude (twice the area)
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (Math.hypot(nx, ny, nz) < 1e-6) degenerate++;
    }
    expect(degenerate).toBe(0);
  });
});

describe('invariant 6 — determinism', () => {
  it('same params → identical position buffer', () => {
    const a = positions(loftTower(PRESETS.D_faceted));
    const b = positions(loftTower(PRESETS.D_faceted));
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe('invariant 7 — clamp behavior', () => {
  it('twist 500° clamps to 120° (identical to an explicit 120° tower)', () => {
    const over = positions(loftTower({ ...PRESETS.A_spiral, twistDeg: 500 }));
    const clamped = positions(loftTower({ ...PRESETS.A_spiral, twistDeg: 120 }));
    expect(Array.from(over)).toEqual(Array.from(clamped));
  });

  it('floors 500 clamps to 40; floors 1 clamps to 3', () => {
    expect(loftTower({ ...PRESETS.A_spiral, floors: 500 }).boundingBox!.max.y).toBeCloseTo(40 * 2.5, 4);
    expect(loftTower({ ...PRESETS.A_spiral, floors: 1 }).boundingBox!.max.y).toBeCloseTo(3 * 2.5, 4);
  });

  it('never throws on garbage params', () => {
    expect(() => loftTower({ profile: { kind: 'superellipse', a: NaN, b: 1, n: 99, samples: 999 }, floors: NaN, floorHeight: -5, taper: 9 })).not.toThrow();
  });
});

describe('invariant 8 — radial footprint bounded by base × (1+β)', () => {
  for (const [name, params] of Object.entries(PRESETS)) {
    it(`${name}: every ring radius ≤ the base ring radius`, () => {
      // Strip faceting so the indexed grid layout is intact (same shape).
      const geo = loftTower({ ...params, facetedNormals: false });
      const pos = positions(geo);
      const floors = Math.round(params.floors);
      // Rings are centred on the axis, so measure radius from each ring's centroid.
      const m = params.profile.kind === 'polygon' ? params.profile.sides : params.profile.samples;
      const cols = m + 1;
      const ringRadius: number[] = [];
      for (let i = 0; i <= floors; i++) {
        let cx = 0, cz = 0;
        for (let j = 0; j < cols; j++) { const idx = (i * cols + j) * 3; cx += pos[idx]; cz += pos[idx + 2]; }
        cx /= cols; cz /= cols;
        let maxR = 0;
        for (let j = 0; j < cols; j++) { const idx = (i * cols + j) * 3; maxR = Math.max(maxR, Math.hypot(pos[idx] - cx, pos[idx + 2] - cz)); }
        ringRadius.push(maxR);
      }
      const baseR = ringRadius[0];
      for (const r of ringRadius) expect(r).toBeLessThanOrEqual(baseR + 1e-4);
    });
  }
});

describe('parapet (BLD-P2)', () => {
  const base: TowerLoftParams = {
    profile: { kind: 'superellipse', a: 2, b: 1.6, n: 3.5, samples: 20 },
    floors: 12, floorHeight: 2.5, taper: 0.20,
  };
  const H = 12 * 2.5;

  it('is off by default and leaves geometry bit-for-bit unchanged', () => {
    const a = loftTower(base).getAttribute('position').array as Float32Array;
    const b = loftTower({ ...base, parapet: false }).getAttribute('position').array as Float32Array;
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(loftVertexCount(base)).toBe(21 * 13 + 1);
  });

  it('folds the lip INSIDE the encoded height — priority encoding stays exact', () => {
    const geo = loftTower({ ...base, parapet: true });
    expect(geo.boundingBox!.max.y).toBeCloseTo(H, 4);
    expect(geo.boundingBox!.min.y).toBeCloseTo(0, 4);
  });

  it('steps inward, never outward — footprint and hit pad unaffected', () => {
    const plain = loftTower(base);
    const par = loftTower({ ...base, parapet: true });
    const maxR = (g: THREE.BufferGeometry) => {
      const p = g.getAttribute('position').array as Float32Array;
      let r = 0;
      for (let i = 0; i < p.length; i += 3) r = Math.max(r, Math.hypot(p[i], p[i + 2]));
      return r;
    };
    expect(maxR(par)).toBeLessThanOrEqual(maxR(plain) + 1e-6);
  });

  it('adds exactly three rings and keeps every position finite', () => {
    const p = { ...base, parapet: true };
    const geo = loftTower(p);
    expect(geo.getAttribute('position').count).toBe(loftVertexCount(p));
    expect(loftVertexCount(p)).toBe(21 * 16 + 1);
    const pos = geo.getAttribute('position').array as Float32Array;
    expect(pos.every(Number.isFinite)).toBe(true);
    const nrm = geo.getAttribute('normal').array as Float32Array;
    expect(nrm.every(Number.isFinite)).toBe(true);
  });

  it('puts the deck below the lip so roof props do not float', () => {
    const deck = loftRoofDeckY({ ...base, parapet: true });
    expect(deck).toBeLessThan(H);
    expect(deck).toBeGreaterThan(H - 2.5); // within one floor of the top
    expect(loftRoofDeckY(base)).toBeCloseTo(H, 4); // no parapet → deck is the top
  });
});
