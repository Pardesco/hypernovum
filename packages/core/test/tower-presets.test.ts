import { describe, it, expect } from 'vitest';
import { presetForProject, isParametricCategory, type TowerBuildInput } from '../src/renderers/TowerPresets';
import { loftStack, loftTower } from '../src/renderers/TowerLoft';

function input(over: Partial<TowerBuildInput> = {}): TowerBuildInput {
  return { path: 'Projects/app.md', category: 'web-apps', width: 4, height: 30, depth: 4, ...over };
}

const ALL_CATEGORIES = [
  'web-apps', 'content', 'desktop-apps', 'infrastructure',
  'trading', 'obsidian-plugins', 'visualization', 'art', 'nonsense',
];

// The four heights BinPacker actually emits (stories 1.5/3/5/7 x 2.5).
const REAL_HEIGHTS = [3.75, 7.5, 12.5, 17.5];

function build(r: ReturnType<typeof presetForProject>) {
  return r.kind === 'stack' ? loftStack(r.params) : loftTower(r.params);
}

describe('presetForProject — family mapping', () => {
  it('HELIX (web-apps) is a single twisted loft', () => {
    const r = presetForProject(input({ category: 'web-apps' }));
    expect(r.kind).toBe('loft');
    if (r.kind === 'loft') {
      expect(r.params.profile.kind).toBe('superellipse');
      expect(r.params.twistDeg!).toBeGreaterThan(60);
    }
  });

  it('LEDGER (content, desktop-apps) stacks rectangular slabs on alternating rotations', () => {
    for (const category of ['content', 'desktop-apps']) {
      const r = presetForProject(input({ category }));
      expect(r.kind).toBe('stack');
      if (r.kind !== 'stack') continue;
      expect(r.params.profile.kind).toBe('polygon');
      if (r.params.profile.kind === 'polygon') {
        expect(r.params.profile.sides).toBe(4);
        // aspect is IMPOSED — the layout always hands over width === depth
        expect(r.params.profile.b).toBeLessThan(r.params.profile.a);
      }
      expect(r.params.segments.length).toBeGreaterThanOrEqual(2);
      const rots = r.params.segments.map((s) => Math.round((s.rotationDeg ?? 0) / 45));
      expect(new Set(rots).size).toBeGreaterThan(1); // genuinely alternating
    }
  });

  it('BASTION (infrastructure, trading) telescopes in steps far bigger than the old setback clamp', () => {
    for (const category of ['infrastructure', 'trading']) {
      const r = presetForProject(input({ category }));
      expect(r.kind).toBe('stack');
      if (r.kind !== 'stack') continue;
      expect(r.diagrid).toBe(true);
      const scales = r.params.segments.map((s) => s.scale);
      expect(scales.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < scales.length; i++) {
        expect(scales[i]).toBeLessThan(scales[i - 1]);
        // the old `setbacks` clamped at 0.12; these are real massing steps
        expect(scales[i - 1] - scales[i]).toBeGreaterThan(0.15);
      }
    }
  });

  it('HIVE (obsidian-plugins) stays a straight faceted hexagon', () => {
    const r = presetForProject(input({ category: 'obsidian-plugins' }));
    expect(r.kind).toBe('loft');
    if (r.kind === 'loft') {
      expect(r.params.profile.kind).toBe('polygon');
      if (r.params.profile.kind === 'polygon') expect(r.params.profile.sides).toBe(6);
      expect(r.params.facetedNormals).toBe(true);
      expect(r.params.twistDeg ?? 0).toBe(0);
    }
    expect(r.diagrid).toBe(false);
  });

  it('unmapped categories get BLOCK rather than a classic silhouette', () => {
    const r = presetForProject(input({ category: 'nonsense' }));
    expect(r.kind).toBe('stack');
    if (r.kind === 'stack') expect(r.params.segments).toHaveLength(1);
    expect(isParametricCategory('nonsense')).toBe(true);
  });

  it('nothing leans any more — visualization and art are quiet blocks', () => {
    for (const category of ['visualization', 'art']) {
      const r = presetForProject(input({ category }));
      expect(r.kind).toBe('stack');
      if (r.kind === 'stack') expect(r.params.segments).toHaveLength(1);
    }
  });

  it('only BASTION carries the diagrid hint', () => {
    for (const c of ['web-apps', 'content', 'desktop-apps', 'obsidian-plugins', 'visualization', 'art', 'nonsense']) {
      expect(presetForProject(input({ category: c })).diagrid).toBe(false);
    }
  });
});

describe('presetForProject — the readout contract', () => {
  it('total height equals the encoded height for every family, at every real height', () => {
    for (const category of ALL_CATEGORIES) {
      for (const height of REAL_HEIGHTS) {
        const geo = build(presetForProject(input({ category, height })));
        expect(geo.boundingBox!.max.y).toBeCloseTo(height, 3);
        expect(geo.boundingBox!.min.y).toBeCloseTo(0, 3);
      }
    }
  });

  it('stacked masses sum to the floor count the shader is told about', () => {
    for (const category of ALL_CATEGORIES) {
      for (const height of REAL_HEIGHTS) {
        const r = presetForProject(input({ category, height }));
        if (r.kind !== 'stack') continue;
        const sum = r.params.segments.reduce((n, s) => n + s.floors, 0);
        expect(sum).toBe(r.floors);
      }
    }
  });

  it('the roof deck sits at or just below the bounding-box top', () => {
    for (const category of ALL_CATEGORIES) {
      const r = presetForProject(input({ category }));
      const top = build(r).boundingBox!.max.y;
      expect(r.roofDeckY).toBeLessThanOrEqual(top + 1e-6);
      expect(r.roofDeckY).toBeGreaterThan(top * 0.8);
    }
  });

  it('footprint never grows beyond the base plan (foundation + hit pad safety)', () => {
    for (const category of ALL_CATEGORIES) {
      const r = presetForProject(input({ category, width: 4, depth: 4 }));
      const pos = build(r).getAttribute('position').array as Float32Array;
      let maxR = 0;
      for (let i = 0; i < pos.length; i += 3) maxR = Math.max(maxR, Math.hypot(pos[i], pos[i + 2]));
      // base half-extent is 2; a square plan's corner sits at 2*sqrt(2)
      expect(maxR).toBeLessThanOrEqual(2 * Math.SQRT2 + 1e-4);
    }
  });
});

describe('presetForProject — determinism + validity', () => {
  it('same input → identical params (seeded jitter is stable)', () => {
    expect(presetForProject(input())).toEqual(presetForProject(input()));
  });

  it('different paths → different buildings within a family', () => {
    const a = JSON.stringify(presetForProject(input({ path: 'a.md', category: 'content' })).params);
    const b = JSON.stringify(presetForProject(input({ path: 'totally-different.md', category: 'content' })).params);
    expect(a).not.toBe(b);
  });

  it('every family renders finite geometry at every real height', () => {
    for (const category of ALL_CATEGORIES) {
      for (const height of REAL_HEIGHTS) {
        const geo = build(presetForProject(input({ category, height })));
        const pos = geo.getAttribute('position').array as Float32Array;
        const nrm = geo.getAttribute('normal').array as Float32Array;
        expect(pos.length).toBeGreaterThan(0);
        expect(pos.every(Number.isFinite)).toBe(true);
        expect(nrm.every(Number.isFinite)).toBe(true);
      }
    }
  });
});
