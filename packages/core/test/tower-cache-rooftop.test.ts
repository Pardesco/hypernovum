import { describe, it, expect } from 'vitest';
import { loftStack, loftTower, loftTowerCached, clearLoftCache, type TowerLoftParams } from '../src/renderers/TowerLoft';
import { presetForProject, type TowerBuildInput } from '../src/renderers/TowerPresets';

const sample: TowerLoftParams = {
  profile: { kind: 'superellipse', a: 1.5, b: 1.2, n: 3.5, samples: 20 },
  floors: 12, floorHeight: 2.5, taper: 0.22, twistDeg: 65,
};

describe('loftTowerCached (BLD-006)', () => {
  it('returns a distinct clone each call with identical data', () => {
    clearLoftCache();
    const a = loftTowerCached(sample);
    const b = loftTowerCached(sample);
    expect(a).not.toBe(b); // different geometry instances
    expect(Array.from(a.getAttribute('position').array)).toEqual(Array.from(b.getAttribute('position').array));
  });

  it('mutating a clone does not corrupt subsequent clones', () => {
    clearLoftCache();
    const a = loftTowerCached(sample);
    a.translate(100, 0, 0); // mutate the clone
    const b = loftTowerCached(sample);
    const bx = (b.getAttribute('position').array as Float32Array)[0];
    expect(Math.abs(bx)).toBeLessThan(50); // unaffected by the +100 translate
  });

  it('clearLoftCache leaves the generator working', () => {
    loftTowerCached(sample);
    clearLoftCache();
    expect(loftTowerCached(sample).getAttribute('position').count).toBeGreaterThan(0);
  });
});

describe('RooftopFactory safe radius fits every preset top floor (BLD-006)', () => {
  function input(over: Partial<TowerBuildInput>): TowerBuildInput {
    return { path: 'p.md', category: 'web-apps', width: 4, height: 30, depth: 3, ...over };
  }

  // safeR = min(width, depth) * 0.18 — the greeble kit is scattered within that
  // radius of the axis at deck height, so the deck's INRADIUS has to clear it.
  //
  // Measured off the built geometry rather than off grid indices, because the
  // two generators lay their buffers out differently and a preset may switch
  // between them: take every vertex sitting at deck height, ignore the cap
  // centre at r=0, and the smallest remaining radius is the inradius.
  for (const category of ['web-apps', 'content', 'desktop-apps', 'visualization', 'art', 'infrastructure', 'trading', 'obsidian-plugins', 'nonsense']) {
    it(`${category}: deck inradius ≥ min(w,d)·0.18`, () => {
      const width = 4, depth = 3;
      const preset = presetForProject(input({ category, width, depth }));
      const geo = preset.kind === 'stack'
        ? loftStack({ ...preset.params, facetedNormals: false })
        : loftTower({ ...preset.params, facetedNormals: false });
      const pos = geo.getAttribute('position').array as Float32Array;

      let minR = Infinity;
      for (let i = 0; i < pos.length; i += 3) {
        if (Math.abs(pos[i + 1] - preset.roofDeckY) > 1e-3) continue;
        const r = Math.hypot(pos[i], pos[i + 2]);
        if (r < 1e-6) continue; // the cap centre
        minR = Math.min(minR, r);
      }

      expect(minR).toBeLessThan(Infinity); // a deck must exist at roofDeckY
      expect(minR).toBeGreaterThanOrEqual(Math.min(width, depth) * 0.18);
    });
  }
});
