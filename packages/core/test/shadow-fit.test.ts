import { describe, it, expect } from 'vitest';
import { fitShadowFrustum } from '../src/scene/shadowFit';

describe('fitShadowFrustum (GFX-007)', () => {
  it('centers on the city and encloses its bounding box', () => {
    const box = { minX: -33, maxX: 33, minZ: -70, maxZ: 70, maxY: 18 };
    const f = fitShadowFrustum(box);
    expect(f.center.x).toBe(0);
    expect(f.center.z).toBe(0);
    // Every corner of the (margin-free) box lies inside the sphere of radius halfSize.
    for (const x of [box.minX, box.maxX]) for (const z of [box.minZ, box.maxZ]) for (const y of [0, box.maxY]) {
      expect(Math.hypot(x - f.center.x, y - f.center.y, z - f.center.z)).toBeLessThanOrEqual(f.halfSize);
    }
    expect(f.near).toBeGreaterThan(0);
    expect(f.far - f.near).toBeCloseTo(2 * f.halfSize);
  });

  it('is much tighter than the old fixed ±150 frustum for a typical vault', () => {
    expect(fitShadowFrustum({ minX: -33, maxX: 33, minZ: -70, maxZ: 70, maxY: 18 }).halfSize).toBeLessThan(90);
  });

  it('never collapses for a single small building', () => {
    expect(fitShadowFrustum({ minX: -1, maxX: 1, minZ: -1, maxZ: 1, maxY: 3 }).halfSize).toBeGreaterThanOrEqual(20);
  });
});
