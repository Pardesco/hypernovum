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
});
