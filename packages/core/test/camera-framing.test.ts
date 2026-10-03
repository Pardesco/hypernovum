import { describe, it, expect } from 'vitest';
import { computeCityFrame, shouldFrameOnBuild } from '../src/scene/cameraFraming';

describe('shouldFrameOnBuild (CAM-001)', () => {
  it('frames the first non-empty build of a view', () => {
    expect(shouldFrameOnBuild({ hasFramed: false, previousCount: 0, count: 12 })).toBe(true);
  });

  it('keeps the camera on ordinary rebuilds (note save, Prepare vault, lens)', () => {
    expect(shouldFrameOnBuild({ hasFramed: true, previousCount: 12, count: 12 })).toBe(false);
    expect(shouldFrameOnBuild({ hasFramed: true, previousCount: 12, count: 13 })).toBe(false);
    expect(shouldFrameOnBuild({ hasFramed: true, previousCount: 12, count: 11 })).toBe(false);
  });

  it('frames when the city goes from empty to non-empty', () => {
    expect(shouldFrameOnBuild({ hasFramed: true, previousCount: 0, count: 1 })).toBe(true);
  });

  it('never frames an empty city, and waits for the first building', () => {
    expect(shouldFrameOnBuild({ hasFramed: false, previousCount: 0, count: 0 })).toBe(false);
    expect(shouldFrameOnBuild({ hasFramed: true, previousCount: 5, count: 0 })).toBe(false);
  });

  it('honours an explicit refit', () => {
    expect(shouldFrameOnBuild({ hasFramed: true, previousCount: 12, count: 3, refit: true })).toBe(true);
  });
});

describe('computeCityFrame', () => {
  it('returns null for no positions', () => {
    expect(computeCityFrame([])).toBeNull();
  });

  it('centers on the footprint and keeps the 0.6 / 0.7 elevation ratio', () => {
    const f = computeCityFrame([{ x: -40, z: -10 }, { x: 40, z: 30 }])!;
    expect(f.centerX).toBe(0);
    expect(f.centerZ).toBe(10);
    expect(f.maxSize).toBe(110); // 80 + 30
    expect(f.distance).toBeCloseTo(121);
    expect(f.position.y).toBeCloseTo(121 * 0.6);
    expect(f.position.z).toBeCloseTo(10 + 121 * 0.7);
    expect(f.radius).toBeCloseTo(82.5);
  });

  it('floors tiny cities at 50 units', () => {
    expect(computeCityFrame([{ x: 3, z: 3 }])!.maxSize).toBe(50);
  });
});
