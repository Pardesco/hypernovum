import { describe, it, expect } from 'vitest';
import { BinPacker } from '../src/layout/BinPacker';
import type { District, ProjectData } from '../src/types';

/**
 * The 0.6.0 BinPacker.packDistricts, frozen verbatim (minus comments) as the
 * reference: saved block offsets are relative to ITS positions, so the default
 * (legacy) path must reproduce it exactly (LAY-001).
 */
function packDistricts060(projects: ProjectData[]): Map<string, District> {
  const buildingSpacing = 2, buildingsPerRow = 4, blockGap = 15, stageGap = 10, gridSize = 5;
  const snapToGrid = (v: number) => Math.round(v / gridSize) * gridSize;
  const calculateHeight = (priority: string) =>
    (({ critical: 7, high: 5, medium: 3, low: 1.5 } as Record<string, number>)[priority] ?? 2) * 2.5;
  const arrangeGridLayout = (district: District, startX: number, startZ: number) => {
    district.buildings.sort((a, b) => {
      const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return (order[a.priority] ?? 2) - (order[b.priority] ?? 2);
    });
    district.buildings.forEach((building, index) => {
      const row = Math.floor(index / buildingsPerRow);
      const col = index % buildingsPerRow;
      const baseSize = Math.max(2, Math.min(4, Math.sqrt(building.scope) * 0.4));
      const cellSize = gridSize + buildingSpacing;
      building.position = {
        x: snapToGrid(startX + col * cellSize + gridSize / 2),
        y: 0,
        z: snapToGrid(startZ + row * cellSize + gridSize / 2),
      };
      building.dimensions = { width: baseSize, height: calculateHeight(building.priority), depth: baseSize };
    });
  };

  const districts = new Map<string, District>();
  for (const project of projects) {
    const key = `${project.stage}_${project.category}`;
    if (!districts.has(key)) {
      districts.set(key, { stage: project.stage, category: project.category, buildings: [], bounds: { x: 0, z: 0, width: 0, depth: 0 } });
    }
    districts.get(key)!.buildings.push(project);
  }
  const categories = [...new Set(projects.map((p) => p.category))].sort();
  const stages = ['backlog', 'active', 'paused', 'complete'];
  let currentZ = gridSize;
  for (const category of categories) {
    const categoryDistricts = [...districts.values()].filter((d) => d.category === category);
    if (categoryDistricts.length === 0) continue;
    let currentX = gridSize;
    let maxDepthInCategory = 0;
    categoryDistricts.sort((a, b) => stages.indexOf(a.stage) - stages.indexOf(b.stage));
    for (const district of categoryDistricts) {
      const buildingCount = district.buildings.length;
      const cols = Math.min(buildingCount, buildingsPerRow);
      const rows = Math.ceil(buildingCount / buildingsPerRow);
      arrangeGridLayout(district, currentX, currentZ);
      const blockWidth = snapToGrid(cols * (gridSize + buildingSpacing));
      const blockDepth = snapToGrid(rows * (gridSize + buildingSpacing));
      district.bounds = { x: currentX, z: currentZ, width: Math.max(blockWidth, gridSize), depth: Math.max(blockDepth, gridSize) };
      currentX = snapToGrid(currentX + blockWidth + stageGap);
      maxDepthInCategory = Math.max(maxDepthInCategory, blockDepth);
    }
    currentZ = snapToGrid(currentZ + maxDepthInCategory + blockGap);
  }
  return districts;
}

const CATEGORIES = ['web-apps', 'infrastructure', 'trading', 'visualization', 'content', 'obsidian-plugins', 'uncategorized'];
const STAGES = ['backlog', 'active', 'paused', 'complete'];
const PRIORITIES = ['critical', 'high', 'medium', 'low'];

/** A deterministic pseudo-random vault (no Math.random, so failures reproduce). */
function vault(n: number, seed: number, categories = CATEGORIES): ProjectData[] {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  return Array.from({ length: n }, (_, i) => ({
    path: `p${i}.md`,
    title: `P${i}`,
    status: 'active',
    priority: PRIORITIES[Math.floor(rnd() * 4)],
    stage: STAGES[Math.floor(rnd() * 4)],
    category: categories[Math.floor(rnd() * categories.length)],
    scope: 1 + Math.floor(rnd() * 60),
    lastModified: 0,
    recentActivity: false,
    health: 80,
    noteCount: 1,
  }));
}

const snapshot = (projects: ProjectData[], districts: Map<string, District>) => ({
  projects: projects.map((p) => [p.path, p.position, p.dimensions]),
  districts: [...districts.entries()].map(([k, d]) => [k, d.bounds, d.buildings.map((b) => b.path)]),
});

/** Footprint of every category (union of its districts). */
function categoryRects(districts: Map<string, District>) {
  const rects = new Map<string, { x0: number; z0: number; x1: number; z1: number }>();
  for (const d of districts.values()) {
    const r = rects.get(d.category) ?? { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
    r.x0 = Math.min(r.x0, d.bounds.x); r.z0 = Math.min(r.z0, d.bounds.z);
    r.x1 = Math.max(r.x1, d.bounds.x + d.bounds.width); r.z1 = Math.max(r.z1, d.bounds.z + d.bounds.depth);
    rects.set(d.category, r);
  }
  return rects;
}

describe('BinPacker legacy layout is exactly 0.6.0 (LAY-001 saved-layout guarantee)', () => {
  for (const [n, seed] of [[1, 1], [7, 2], [27, 3], [100, 4], [250, 5]] as const) {
    it(`matches the frozen 0.6.0 packer for ${n} projects`, () => {
      const a = vault(n, seed), b = vault(n, seed);
      const ours = new BinPacker().packDistricts(a);
      const ref = packDistricts060(b);
      expect(snapshot(a, ours)).toEqual(snapshot(b, ref));
      // An explicit 'legacy' is the same thing.
      const c = vault(n, seed);
      expect(snapshot(c, new BinPacker().packDistricts(c, { layout: 'legacy' }))).toEqual(snapshot(b, ref));
    });
  }
});

describe('BinPacker shelf layout (LAY-001)', () => {
  it('packs the 7-district demo shape near the target aspect, not into a column', () => {
    const projects = vault(27, 3);
    const districts = new BinPacker().packDistricts(projects, { layout: 'shelf' });
    const rects = [...categoryRects(districts).values()];
    const w = Math.max(...rects.map((r) => r.x1)) - Math.min(...rects.map((r) => r.x0));
    const d = Math.max(...rects.map((r) => r.z1)) - Math.min(...rects.map((r) => r.z0));
    expect(w / d).toBeGreaterThanOrEqual(1.5);
    expect(w / d).toBeLessThanOrEqual(2.2);

    const legacy = packDistricts060(vault(27, 3));
    const lr = [...categoryRects(legacy).values()];
    const lw = Math.max(...lr.map((r) => r.x1)) - Math.min(...lr.map((r) => r.x0));
    const ld = Math.max(...lr.map((r) => r.z1)) - Math.min(...lr.map((r) => r.z0));
    expect(lw / ld).toBeLessThan(1); // the old one-category-per-row strip
  });

  it('never overlaps two districts, with room for the district labels', () => {
    for (const [n, seed] of [[27, 3], [100, 4], [250, 5], [12, 9]] as const) {
      const districts = new BinPacker().packDistricts(vault(n, seed), { layout: 'shelf' });
      const rects = [...categoryRects(districts).entries()];
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const [, a] = rects[i], [, b] = rects[j];
        // Outline padding is 3 per side, plus label space: require >= 10 units apart.
        const apartX = Math.max(b.x0 - a.x1, a.x0 - b.x1);
        const apartZ = Math.max(b.z0 - a.z1, a.z0 - b.z1);
        expect(Math.max(apartX, apartZ)).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it('keeps every building inside its district, on the 5-unit grid', () => {
    const projects = vault(100, 4);
    const districts = new BinPacker().packDistricts(projects, { layout: 'shelf' });
    for (const d of districts.values()) {
      for (const b of d.buildings) {
        expect(b.position!.x % 5).toBe(0);
        expect(b.position!.z % 5).toBe(0);
        expect(b.position!.x).toBeGreaterThanOrEqual(d.bounds.x);
        expect(b.position!.z).toBeGreaterThanOrEqual(d.bounds.z);
      }
    }
  });

  it('is deterministic and handles one category', () => {
    const a = vault(40, 7), b = vault(40, 7);
    expect(snapshot(a, new BinPacker().packDistricts(a, { layout: 'shelf' })))
      .toEqual(snapshot(b, new BinPacker().packDistricts(b, { layout: 'shelf' })));
    const one = vault(6, 1, ['solo']);
    const districts = new BinPacker().packDistricts(one, { layout: 'shelf' });
    expect(one.every((p) => p.position)).toBe(true);
    expect(districts.size).toBeGreaterThan(0);
  });
});
