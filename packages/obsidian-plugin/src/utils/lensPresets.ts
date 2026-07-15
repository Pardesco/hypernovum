/**
 * Saved lens presets (LENS-001). Pure helpers so preset ↔ state round-tripping
 * is unit-testable; the view owns the UI wiring.
 */

import type { LensPreset } from '../settings/SettingsTab';

/** The subset of view state a preset captures/restores. */
export interface LensState {
  layer: string;
  statusFilter: string;
  priorityFilter: string;
  categoryFilter: string;
  searchQuery: string;
  edgeTypes: string[];
}

/** Three shipped defaults (§Lens strategy). Agents = status, links off pre-Phase-4. */
export const BUILT_IN_LENSES: LensPreset[] = [
  {
    id: 'builtin-active', name: 'Active Work', builtIn: true,
    layer: 'status', statusFilter: 'active', priorityFilter: 'all', categoryFilter: 'all', edgeTypes: [],
  },
  {
    id: 'builtin-attention', name: 'Needs Attention', builtIn: true,
    layer: 'attention', statusFilter: 'all', priorityFilter: 'all', categoryFilter: 'all', edgeTypes: [],
  },
  {
    id: 'builtin-agents', name: 'Agents', builtIn: true,
    layer: 'status', statusFilter: 'all', priorityFilter: 'all', categoryFilter: 'all', edgeTypes: [],
  },
];

/** Capture the current view state as a named preset. */
export function stateToPreset(id: string, name: string, s: LensState): LensPreset {
  return {
    id, name,
    layer: s.layer,
    statusFilter: s.statusFilter,
    priorityFilter: s.priorityFilter,
    categoryFilter: s.categoryFilter,
    searchQuery: s.searchQuery || undefined,
    edgeTypes: [...s.edgeTypes],
  };
}

/** Restore the state a preset encodes. */
export function presetToState(p: LensPreset): LensState {
  return {
    layer: p.layer,
    statusFilter: p.statusFilter,
    priorityFilter: p.priorityFilter,
    categoryFilter: p.categoryFilter,
    searchQuery: p.searchQuery ?? '',
    edgeTypes: [...p.edgeTypes],
  };
}

/** Stable id for a user-saved preset (no Date.now/random — derive from name + existing). */
export function nextPresetId(existing: LensPreset[]): string {
  let n = existing.length + 1;
  const ids = new Set(existing.map((p) => p.id));
  while (ids.has(`lens-${n}`)) n++;
  return `lens-${n}`;
}
