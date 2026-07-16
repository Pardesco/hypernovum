import { describe, it, expect } from 'vitest';
import { projectMatchesFilters, filterProjects, type FilterCriteria } from '../src/utils/projectFilter';
import type { ProjectData } from '@hypernovum/core';

function proj(over: Partial<ProjectData> = {}): ProjectData {
  return {
    path: 'a.md', title: 'App', status: 'active', priority: 'high', category: 'web-apps',
    stack: ['TypeScript'], ...over,
  } as ProjectData;
}

const all: FilterCriteria = { query: '', status: 'all', priority: 'all', category: 'all', memoryOnly: false };

describe('projectMatchesFilters', () => {
  it('passes everything under the default (all) criteria', () => {
    expect(projectMatchesFilters(proj(), all)).toBe(true);
  });

  it('matches the search query across title/status/stack (case-insensitive, pre-lowered)', () => {
    expect(projectMatchesFilters(proj({ title: 'Cart Service' }), { ...all, query: 'cart' })).toBe(true);
    expect(projectMatchesFilters(proj({ stack: ['React'] }), { ...all, query: 'react' })).toBe(true);
    expect(projectMatchesFilters(proj({ title: 'App' }), { ...all, query: 'ghost' })).toBe(false);
  });

  it('filters by status / priority / category', () => {
    expect(projectMatchesFilters(proj({ status: 'blocked' }), { ...all, status: 'active' })).toBe(false);
    expect(projectMatchesFilters(proj({ priority: 'low' }), { ...all, priority: 'high' })).toBe(false);
    expect(projectMatchesFilters(proj({ category: 'art' }), { ...all, category: 'web-apps' })).toBe(false);
    expect(projectMatchesFilters(proj(), { ...all, status: 'active', priority: 'high', category: 'web-apps' })).toBe(true);
  });

  it('memory lens keeps only memory-ready projects', () => {
    expect(projectMatchesFilters(proj({ hasMemoryContext: true }), { ...all, memoryOnly: true })).toBe(true);
    expect(projectMatchesFilters(proj({ hasMemoryContext: false }), { ...all, memoryOnly: true })).toBe(false);
  });

  it('combines predicates with AND', () => {
    const p = proj({ title: 'Cart', status: 'active', category: 'web-apps' });
    expect(projectMatchesFilters(p, { ...all, query: 'cart', status: 'active', category: 'web-apps' })).toBe(true);
    expect(projectMatchesFilters(p, { ...all, query: 'cart', status: 'blocked' })).toBe(false);
  });
});

describe('filterProjects (the visible set)', () => {
  it('returns only matching projects, preserving order', () => {
    const projects = [
      proj({ path: 'a.md', status: 'active' }),
      proj({ path: 'b.md', status: 'blocked' }),
      proj({ path: 'c.md', status: 'active' }),
    ];
    const visible = filterProjects(projects, { ...all, status: 'active' });
    expect(visible.map((p) => p.path)).toEqual(['a.md', 'c.md']);
  });
});
