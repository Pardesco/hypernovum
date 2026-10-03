import { describe, it, expect } from 'vitest';
import { MAX_MARKER_SCALE, MIN_MARKER_PX, markerScale } from '../src/scene/markerScale';

const diameterPx = (r: number, d: number, fov: number, h: number, s: number) =>
  (2 * r * s * h) / (2 * Math.tan((fov * Math.PI) / 360) * d);

describe('markerScale (VIS-001)', () => {
  it('scales an overview-distance orb up to the minimum diameter', () => {
    // Orb radius 0.26, camera ~130 units away, 50° fov, 990 px tall canvas.
    const s = markerScale(0.26, 130, 50, 990);
    expect(s).toBeGreaterThan(1);
    expect(diameterPx(0.26, 130, 50, 990, s)).toBeCloseTo(MIN_MARKER_PX, 5);
  });

  it('leaves close-up markers at their modelled size', () => {
    expect(markerScale(0.35, 15, 50, 990)).toBe(1);
  });

  it('caps the scale-up for very distant markers', () => {
    expect(markerScale(0.26, 2000, 50, 990)).toBe(MAX_MARKER_SCALE);
  });

  it('is a no-op on degenerate input', () => {
    expect(markerScale(0, 100, 50, 990)).toBe(1);
    expect(markerScale(0.3, 0, 50, 990)).toBe(1);
    expect(markerScale(0.3, 100, 50, 0)).toBe(1);
  });
});
