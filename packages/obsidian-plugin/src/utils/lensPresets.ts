/**
 * Lens presets (LENS-001). Pure helpers so preset → state restoration is
 * unit-testable; the view owns the UI wiring.
 *
 * 0.5 removed the save/delete UI. Presets a user saved before then are still
 * listed and applied — the `savedLenses` setting is read, never written.
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

/**
 * The shipped defaults. A third, "Agents", was removed in 0.5: it set
 * layer=status with every filter at 'all', which made it byte-identical to
 * Clear filters — a no-op that shipped through four releases unreported.
 */
export const BUILT_IN_LENSES: LensPreset[] = [
  {
    id: 'builtin-active', name: 'Active Work', builtIn: true,
    layer: 'status', statusFilter: 'active', priorityFilter: 'all', categoryFilter: 'all', edgeTypes: [],
  },
  {
    id: 'builtin-attention', name: 'Needs Attention', builtIn: true,
    layer: 'attention', statusFilter: 'all', priorityFilter: 'all', categoryFilter: 'all', edgeTypes: [],
  },
];

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
