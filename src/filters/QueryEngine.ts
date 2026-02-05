import type { ProjectData } from '../types';

/**
 * Query engine for text-based filtering of projects.
 * Placeholder for v0.2 — will support search-as-you-type.
 */
export class QueryEngine {
  search(projects: ProjectData[], query: string): ProjectData[] {
    if (!query.trim()) return projects;

    const lower = query.toLowerCase();
    return projects.filter(
      (p) =>
        p.title.toLowerCase().includes(lower) ||
        p.category.toLowerCase().includes(lower) ||
        p.status.toLowerCase().includes(lower),
    );
  }
}
