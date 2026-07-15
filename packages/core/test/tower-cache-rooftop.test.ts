import { describe, it, expect } from 'vitest';
import { loftTower, loftTowerCached, clearLoftCache, type TowerLoftParams } from '../src/renderers/TowerLoft';
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

  // safeR = min(width, depth) * 0.18 — greebles must stay inside the top ring.
  for (const category of ['web-apps', 'content', 'visualization', 'infrastructure']) {
    it(`${category}: min top-ring radius ≥ min(w,d)·0.18`, () => {
      const width = 4, depth = 3;
      const preset = presetForProject(input({ category, width, depth }))!;
      // Non-faceted so the grid layout is intact for per-ring measurement.
      const geo = loftTower({ ...preset.params, facetedNormals: false });
      const pos = geo.getAttribute('position').array as Float32Array;
      const m = preset.params.profile.kind === 'polygon' ? preset.params.profile.sides : preset.params.profile.samples;
      const cols = m + 1;
      const floors = preset.floors;

      // Top ring centroid + min vertex radius.
      let cx = 0, cz = 0;
      for (let j = 0; j < cols; j++) { const idx = (floors * cols + j) * 3; cx += pos[idx]; cz += pos[idx + 2]; }
      cx /= cols; cz /= cols;
      let minR = Infinity;
      for (let j = 0; j < cols; j++) {
        const idx = (floors * cols + j) * 3;
        minR = Math.min(minR, Math.hypot(pos[idx] - cx, pos[idx + 2] - cz));
      }

      const safeR = Math.min(width, depth) * 0.18;
      expect(minR).toBeGreaterThanOrEqual(safeR);
    });
  }
});
