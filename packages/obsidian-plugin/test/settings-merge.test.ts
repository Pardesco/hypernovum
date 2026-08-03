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
  buildingStyleMigrated: false,
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

    expect(merged.buildingStyle).toBe('parametric'); // default flipped in 0.4.2
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

  it('empty data.json loads full defaults (fresh install)', () => {
    const merged = Object.assign({}, PLUGIN_DEFAULTS, {});
    expect(merged.buildingStyle).toBe('parametric'); // default flipped in 0.4.2
    expect(merged.vaultMode).toBe(false);
    expect(merged.savedLenses).toEqual([]);
    expect(merged.agentName).toBe('Claude Code');
  });

  it('mid-plan data.json (partial new keys) fills only the gaps', () => {
    // A vault upgraded partway: has interactionHintShown but not savedLenses/buildingStyle.
    const midData = {
      interactionHintShown: true,
      enableBloom: false,
      vaultMode: true,
    };
    const merged = Object.assign({}, PLUGIN_DEFAULTS, midData);
    expect(merged.interactionHintShown).toBe(true);   // preserved
    expect(merged.vaultMode).toBe(true);              // preserved
    expect(merged.buildingStyle).toBe('parametric'); // default flipped in 0.4.2     // filled
    expect(merged.savedLenses).toEqual([]);           // filled
  });

  it('preserves a stored parametric style and saved lens presets', () => {
    const data = {
      buildingStyle: 'parametric',
      savedLenses: [{ id: 'lens-1', name: 'Blocked', layer: 'attention', statusFilter: 'blocked', priorityFilter: 'all', categoryFilter: 'all', edgeTypes: ['blocked-by'] }],
    };
    const merged = Object.assign({}, PLUGIN_DEFAULTS, data);
    expect(merged.buildingStyle).toBe('parametric');
    expect(merged.savedLenses).toHaveLength(1);
    expect(merged.savedLenses[0].edgeTypes).toEqual(['blocked-by']);
  });
});


// Mirrors the buildingStyle migration in HypernovumPlugin.loadSettings(). The
// flip is only useful if EXISTING installs move too: they all have 'classic'
// persisted, so changing DEFAULT_SETTINGS alone would strand every current
// user on the old silhouettes.
function migrateBuildingStyle(stored: Record<string, unknown> | null) {
  const merged: Record<string, unknown> = { ...PLUGIN_DEFAULTS, ...(stored ?? {}) };
  if (stored && !stored.buildingStyleMigrated) {
    if (stored.buildingStyle === 'classic') merged.buildingStyle = 'parametric';
    merged.buildingStyleMigrated = true;
  }
  return merged;
}

describe('buildingStyle 0.4.2 migration', () => {
  it('carries an existing install off the old default exactly once', () => {
    const m = migrateBuildingStyle({ buildingStyle: 'classic' });
    expect(m.buildingStyle).toBe('parametric');
    expect(m.buildingStyleMigrated).toBe(true);
  });

  it('a deliberate switch BACK to classic sticks', () => {
    // Second load after the user chose classic post-migration.
    const m = migrateBuildingStyle({ buildingStyle: 'classic', buildingStyleMigrated: true });
    expect(m.buildingStyle).toBe('classic');
  });

  it('leaves an early adopter who already chose parametric alone', () => {
    const m = migrateBuildingStyle({ buildingStyle: 'parametric' });
    expect(m.buildingStyle).toBe('parametric');
    expect(m.buildingStyleMigrated).toBe(true);
  });

  it('a fresh install needs no migration and takes the default', () => {
    const m = migrateBuildingStyle(null);
    expect(m.buildingStyle).toBe('parametric');
    expect(m.buildingStyleMigrated).toBe(false);
  });
});
