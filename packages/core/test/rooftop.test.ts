import { describe, it, expect } from 'vitest';
import { RooftopFactory } from '../src/renderers/RooftopFactory';
import type { ProjectData } from '../src/types';

function project(path: string, overrides: Partial<ProjectData> = {}): ProjectData {
  return {
    path,
    title: 'P',
    status: 'active',
    priority: 'medium',
    stage: 'active',
    category: 'web-apps',
    scope: 4,
    lastModified: 0,
    recentActivity: false,
    health: 80,
    noteCount: 1,
    dimensions: { width: 3, height: 10, depth: 3 },
    position: { x: 0, y: 0, z: 0 },
    ...overrides,
  };
}

// Minimal stand-in building geometry (factories only read the bounding box)
import * as THREE from 'three';
const box = () => new THREE.BoxGeometry(3, 10, 3);

describe('RooftopFactory', () => {
  it('is deterministic per project path', () => {
    const a1 = RooftopFactory.createRooftop(project('same.md'), box());
    const a2 = RooftopFactory.createRooftop(project('same.md'), box());
    expect(a1.detail).not.toBeNull();
    expect(Array.from(a1.detail!.attributes.position.array)).toEqual(
      Array.from(a2.detail!.attributes.position.array),
    );
  });

  it('gives critical projects a beacon even on pointed roofs', () => {
    const pointed = project('p.md', { category: 'trading', priority: 'critical' });
    const kit = RooftopFactory.createRooftop(pointed, box());
    expect(kit.detail).toBeNull();
    expect(kit.beaconPosition).not.toBeNull();
  });

  // Regression: leaning presets move the roof centerline by up to 0.12·H, many
  // times the safe radius, so a kit built around local origin hangs in mid-air
  // beside the tower. Every piece must ride the offset.
  it('places the whole kit on the roof centerline, not local origin', () => {
    const p = project('lean.md', { priority: 'critical' });
    const topCenter = { x: 2.5, z: -1.75 };
    const kit = RooftopFactory.createRooftop(p, box(), topCenter);

    const safeR = Math.min(3, 3) * 0.18; // min(width, depth) * 0.18
    const pos = kit.detail!.attributes.position.array as Float32Array;
    for (let i = 0; i < pos.length; i += 3) {
      const dist = Math.hypot(pos[i] - topCenter.x, pos[i + 2] - topCenter.z);
      // Greebles have their own extent; generous bound, but far tighter than
      // the ~3.05 they would sit at if they were still centred on the origin.
      expect(dist).toBeLessThan(safeR + 1.0);
    }
    // The beacon rides the mast, which is scattered within safeR of the centre.
    expect(Math.abs(kit.beaconPosition!.x - topCenter.x)).toBeLessThan(safeR);
    expect(Math.abs(kit.beaconPosition!.z - topCenter.z)).toBeLessThan(safeR);
  });

  it('defaults to local origin when no lean is supplied (classic path)', () => {
    const kit = RooftopFactory.createRooftop(project('c.md', { priority: 'critical' }), box());
    expect(Math.abs(kit.beaconPosition!.x)).toBeLessThan(0.6);
    expect(Math.abs(kit.beaconPosition!.z)).toBeLessThan(0.6);
  });
});
