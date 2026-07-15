import { describe, it, expect } from 'vitest';
import { presetForProject, isParametricCategory, type TowerBuildInput } from '../src/renderers/TowerPresets';
import { loftTower } from '../src/renderers/TowerLoft';

function input(over: Partial<TowerBuildInput> = {}): TowerBuildInput {
  return { path: 'Projects/app.md', category: 'web-apps', width: 4, height: 30, depth: 4, ...over };
}

describe('presetForProject — category mapping', () => {
  it('maps the four families and their categories', () => {
    expect(presetForProject(input({ category: 'web-apps' }))?.params.profile.kind).toBe('superellipse');
    expect(presetForProject(input({ category: 'content' }))?.params.waist).toBeDefined();
    expect(presetForProject(input({ category: 'visualization' }))?.params.lean).toBeDefined();
    const d = presetForProject(input({ category: 'infrastructure' }))!;
    expect(d.params.profile.kind).toBe('polygon');
    expect(d.diagrid).toBe(true);
    expect(d.params.facetedNormals).toBe(true);
  });

  it('returns null for unmapped categories (classic fallback)', () => {
    expect(presetForProject(input({ category: 'obsidian-plugins' }))).toBeNull();
    expect(presetForProject(input({ category: 'nonsense' }))).toBeNull();
    expect(isParametricCategory('obsidian-plugins')).toBe(false);
    expect(isParametricCategory('trading')).toBe(true);
  });

  it('only preset D carries the diagrid hint', () => {
    for (const c of ['web-apps', 'content', 'visualization', 'art', 'desktop-apps']) {
      expect(presetForProject(input({ category: c }))?.diagrid).toBe(false);
    }
    for (const c of ['infrastructure', 'trading']) {
      expect(presetForProject(input({ category: c }))?.diagrid).toBe(true);
    }
  });
});

describe('presetForProject — data mapping', () => {
  it('floors clamp to [4,28] and total height equals the encoded height', () => {
    const tiny = presetForProject(input({ height: 4 }))!;
    const huge = presetForProject(input({ height: 500 }))!;
    expect(tiny.floors).toBeGreaterThanOrEqual(4);
    expect(huge.floors).toBeLessThanOrEqual(28);
    // floors * floorHeight ≈ height (height encoding preserved)
    for (const r of [tiny, huge]) {
      expect(r.floors * r.params.floorHeight).toBeCloseTo(r === tiny ? 4 : 500, 3);
    }
  });

  it('profile half-extents come from width/depth', () => {
    const r = presetForProject(input({ width: 6, depth: 8 }))!;
    if (r.params.profile.kind === 'superellipse') {
      expect(r.params.profile.a).toBe(3);
      expect(r.params.profile.b).toBe(4);
    }
  });
});

describe('presetForProject — determinism + validity', () => {
  it('same input → identical params (seeded jitter is stable)', () => {
    expect(presetForProject(input())).toEqual(presetForProject(input()));
  });

  it('different paths → different jittered twist (family A)', () => {
    const a = presetForProject(input({ path: 'a.md' }))!.params.twistDeg;
    const b = presetForProject(input({ path: 'totally-different.md' }))!.params.twistDeg;
    expect(a).not.toBe(b);
  });

  it('every family produces geometry loftTower renders without NaN', () => {
    for (const c of ['web-apps', 'content', 'visualization', 'infrastructure']) {
      const r = presetForProject(input({ category: c }))!;
      const pos = loftTower(r.params).getAttribute('position').array as Float32Array;
      expect(pos.length).toBeGreaterThan(0);
      expect(pos.every(Number.isFinite)).toBe(true);
    }
  });
});
