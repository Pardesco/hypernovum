import type { ProjectData } from '../types';

export interface FilterCriteria {
  status?: string | null;
  priority?: string | null;
  category?: string | null;
  stage?: string | null;
}

/**
 * Facet filter for narrowing the visible set of buildings.
 * MVP placeholder — full UI and query engine come in v0.2.
 */
export class FacetFilter {
  filter(projects: ProjectData[], criteria: FilterCriteria): ProjectData[] {
    return projects.filter((p) => {
      if (criteria.status && p.status !== criteria.status) return false;
      if (criteria.priority && p.priority !== criteria.priority) return false;
      if (criteria.category && p.category !== criteria.category) return false;
      if (criteria.stage && p.stage !== criteria.stage) return false;
      return true;
    });
  }

  /** Extract unique values for each facet dimension */
  extractFacets(projects: ProjectData[]): Record<string, string[]> {
    const facets: Record<string, Set<string>> = {
      status: new Set(),
      priority: new Set(),
      category: new Set(),
      stage: new Set(),
    };

    for (const p of projects) {
      facets.status.add(p.status);
      facets.priority.add(p.priority);
      facets.category.add(p.category);
      facets.stage.add(p.stage);
    }

    return Object.fromEntries(
      Object.entries(facets).map(([k, v]) => [k, [...v].sort()]),
    );
  }
}
