import { describe, it, expect } from 'vitest';
import { BinPacker } from '../src/layout/BinPacker';
import type { ProjectData } from '../src/types';

function project(overrides: Partial<ProjectData>): ProjectData {
  return {
    path: 'p.md',
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
    ...overrides,
  };
}

describe('BinPacker', () => {
  it('assigns positions and dimensions to every project', () => {
    const projects = [
      project({ path: 'a.md', category: 'web-apps', priority: 'critical' }),
      project({ path: 'b.md', category: 'web-apps', priority: 'low' }),
      project({ path: 'c.md', category: 'trading' }),
    ];
    const districts = new BinPacker().packDistricts(projects);

    expect(districts.size).toBeGreaterThan(0);
    for (const p of projects) {
      expect(p.position).toBeDefined();
      expect(p.dimensions).toBeDefined();
      expect(p.dimensions!.height).toBeGreaterThan(0);
    }
  });

  it('maps priority to height monotonically', () => {
    const critical = project({ path: 'a.md', priority: 'critical' });
    const low = project({ path: 'b.md', priority: 'low' });
    new BinPacker().packDistricts([critical, low]);
    expect(critical.dimensions!.height).toBeGreaterThan(low.dimensions!.height);
  });
});
