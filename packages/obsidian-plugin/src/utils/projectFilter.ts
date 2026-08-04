import type { ProjectData } from '@hypernovum/core';

/**
 * Pure project-filter predicate (PERF-002). The visible set is what applyView
 * toggles, so keeping the match logic pure makes it unit-testable and keeps the
 * view's visibility diff independent of the scene.
 */

export interface FilterCriteria {
  query: string;          // already lower-cased + trimmed
  status: string;         // 'all' or a status
  priority: string;       // 'all' or a priority
  category: string;       // 'all' or a category
}

export function projectMatchesFilters(project: ProjectData, c: FilterCriteria): boolean {
  if (c.query) {
    const fields = [
      project.title, project.path, project.status, project.priority,
      project.category, project.projectDir, ...(project.stack ?? []),
    ].filter(Boolean).join(' ').toLowerCase();
    if (!fields.includes(c.query)) return false;
  }
  if (c.status !== 'all' && project.status !== c.status) return false;
  if (c.priority !== 'all' && project.priority !== c.priority) return false;
  if (c.category !== 'all' && project.category !== c.category) return false;
  return true;
}

export function filterProjects(projects: ProjectData[], c: FilterCriteria): ProjectData[] {
  return projects.filter((p) => projectMatchesFilters(p, c));
}
