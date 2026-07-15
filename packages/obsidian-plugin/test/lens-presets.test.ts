import { describe, it, expect } from 'vitest';
import {
  BUILT_IN_LENSES,
  stateToPreset,
  presetToState,
  nextPresetId,
  type LensState,
} from '../src/utils/lensPresets';

const state: LensState = {
  layer: 'attention',
  statusFilter: 'active',
  priorityFilter: 'high',
  categoryFilter: 'web-apps',
  searchQuery: 'cart',
  edgeTypes: ['backlink'],
};

describe('lens preset round-trip', () => {
  it('stateToPreset → presetToState reproduces the state', () => {
    const preset = stateToPreset('lens-1', 'My View', state);
    expect(presetToState(preset)).toEqual(state);
  });

  it('empty search normalizes to undefined in the preset, back to "" in state', () => {
    const preset = stateToPreset('lens-1', 'x', { ...state, searchQuery: '' });
    expect(preset.searchQuery).toBeUndefined();
    expect(presetToState(preset).searchQuery).toBe('');
  });

  it('edgeTypes is copied, not shared', () => {
    const preset = stateToPreset('lens-1', 'x', state);
    preset.edgeTypes.push('depends-on');
    expect(presetToState(stateToPreset('lens-2', 'y', state)).edgeTypes).toEqual(['backlink']);
  });
});

describe('built-in lenses', () => {
  it('ships exactly three, all builtIn', () => {
    expect(BUILT_IN_LENSES).toHaveLength(3);
    expect(BUILT_IN_LENSES.every((l) => l.builtIn)).toBe(true);
    expect(BUILT_IN_LENSES.map((l) => l.name)).toEqual(['Active Work', 'Needs Attention', 'Agents']);
  });

  it('Needs Attention uses the attention layer', () => {
    expect(BUILT_IN_LENSES.find((l) => l.id === 'builtin-attention')?.layer).toBe('attention');
  });
});

describe('nextPresetId', () => {
  it('avoids collisions with existing ids', () => {
    const existing = [stateToPreset('lens-1', 'a', state), stateToPreset('lens-2', 'b', state)];
    expect(nextPresetId(existing)).toBe('lens-3');
  });
});
