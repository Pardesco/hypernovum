import { describe, it, expect } from 'vitest';
import { BUILT_IN_LENSES, presetToState } from '../src/utils/lensPresets';
import type { LensPreset } from '../src/settings/SettingsTab';

const preset: LensPreset = {
  id: 'lens-1',
  name: 'My View',
  layer: 'attention',
  statusFilter: 'active',
  priorityFilter: 'high',
  categoryFilter: 'web-apps',
  searchQuery: 'cart',
  edgeTypes: ['backlink'],
};

describe('presetToState', () => {
  it('restores every field a preset encodes', () => {
    expect(presetToState(preset)).toEqual({
      layer: 'attention',
      statusFilter: 'active',
      priorityFilter: 'high',
      categoryFilter: 'web-apps',
      searchQuery: 'cart',
      edgeTypes: ['backlink'],
    });
  });

  it('an absent search query restores as the empty string', () => {
    expect(presetToState({ ...preset, searchQuery: undefined }).searchQuery).toBe('');
  });

  it('copies edgeTypes rather than aliasing the stored array', () => {
    const state = presetToState(preset);
    state.edgeTypes.push('depends-on');
    expect(preset.edgeTypes).toEqual(['backlink']);
  });
});

describe('built-in lenses', () => {
  it('ships exactly two, both builtIn', () => {
    expect(BUILT_IN_LENSES).toHaveLength(2);
    expect(BUILT_IN_LENSES.every((l) => l.builtIn)).toBe(true);
    expect(BUILT_IN_LENSES.map((l) => l.name)).toEqual(['Active Work', 'Needs Attention']);
  });

  it('Needs Attention uses the attention layer', () => {
    expect(BUILT_IN_LENSES.find((l) => l.id === 'builtin-attention')?.layer).toBe('attention');
  });

  it('no built-in is a no-op — each differs from cleared filters', () => {
    const cleared = { layer: 'status', statusFilter: 'all', priorityFilter: 'all', categoryFilter: 'all' };
    for (const lens of BUILT_IN_LENSES) {
      const differs =
        lens.layer !== cleared.layer ||
        lens.statusFilter !== cleared.statusFilter ||
        lens.priorityFilter !== cleared.priorityFilter ||
        lens.categoryFilter !== cleared.categoryFilter ||
        lens.edgeTypes.length > 0;
      expect(differs, `"${lens.name}" is identical to Clear filters`).toBe(true);
    }
  });
});
