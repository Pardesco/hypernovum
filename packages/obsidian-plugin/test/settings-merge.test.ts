import { describe, it, expect } from 'vitest';

// Mirrors HypernovumPlugin.loadSettings(): Object.assign over defaults must
// tolerate data.json files written by any earlier plugin version.
// (Defaults are re-declared here because SettingsTab imports 'obsidian',
// which cannot load under Node — keep this fixture in sync with SettingsTab.)
import { DEFAULT_SETTINGS as CORE_DEFAULTS } from '../../core/src/types';

const PLUGIN_DEFAULTS = {
  ...CORE_DEFAULTS,
  agentName: 'Claude Code',
  agentCommand: 'claude',
  vaultMode: false,
  interactionHintShown: false,
  savedLenses: [],
};

describe('settings default-merge', () => {
  it('fills new keys when loading a pre-0.4 data.json', () => {
    const oldData = {
      projectTag: 'project',
      showLabels: true,
      enableShaders: true,
      blockPositions: [{ category: 'web-apps', offsetX: 5, offsetZ: 0 }],
      agentCommand: 'codex',
    };
    const merged = Object.assign({}, PLUGIN_DEFAULTS, oldData);

    expect(merged.buildingStyle).toBe('classic');
    expect(merged.interactionHintShown).toBe(false);
    expect(merged.savedLenses).toEqual([]);
    // Existing values preserved
    expect(merged.agentCommand).toBe('codex');
    expect(merged.blockPositions).toHaveLength(1);
    expect(merged.enableShaders).toBe(true);
  });

  it('preserves unknown keys from newer versions', () => {
    const futureData = { someFutureKey: 42 };
    const merged = Object.assign({}, PLUGIN_DEFAULTS, futureData) as Record<string, unknown>;
    expect(merged.someFutureKey).toBe(42);
  });
});
