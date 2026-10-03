import { describe, it, expect } from 'vitest';
import { layoutVersionFor, migrateAgentName } from '../src/settings/settingsMigrations';

describe('migrateAgentName (TXT-001)', () => {
  it('renames the shipped "GPT Codex" preset label to "Codex CLI"', () => {
    expect(migrateAgentName('codex', 'GPT Codex')).toBe('Codex CLI');
  });

  it('leaves current and other preset names alone', () => {
    expect(migrateAgentName('codex', 'Codex CLI')).toBeNull();
    expect(migrateAgentName('claude', 'Claude Code')).toBeNull();
    expect(migrateAgentName('agy', 'Antigravity CLI')).toBeNull();
  });

  it('never touches a custom agent, even one that reuses the old label', () => {
    expect(migrateAgentName('my-codex-wrapper', 'GPT Codex')).toBeNull();
    expect(migrateAgentName('codex', 'My Codex')).toBeNull();
    expect(migrateAgentName('', 'Custom Agent')).toBeNull();
  });
});

describe('layoutVersionFor (LAY-001)', () => {
  const saved = [{ category: 'web-apps', offsetX: 5, offsetZ: -10 }];

  it('keeps the legacy packer for configs with real saved offsets', () => {
    expect(layoutVersionFor({ blockPositions: saved })).toBe(1);
    expect(layoutVersionFor({ blockPositions: [{ category: 'x', offsetX: 0, offsetZ: 2.5 }] })).toBe(1);
  });

  it('moves configs without customised positions, and new installs, to the shelf layout', () => {
    expect(layoutVersionFor(null)).toBe(2);
    expect(layoutVersionFor({})).toBe(2);
    expect(layoutVersionFor({ blockPositions: [] })).toBe(2);
    // "Save layout" without moving anything stores zero offsets.
    expect(layoutVersionFor({ blockPositions: [{ category: 'a', offsetX: 0, offsetZ: 0 }] })).toBe(2);
  });

  it('never overrides a recorded version', () => {
    expect(layoutVersionFor({ layoutVersion: 2, blockPositions: saved })).toBe(2);
    expect(layoutVersionFor({ layoutVersion: 1, blockPositions: [] })).toBe(1);
  });

  it('tolerates junk in data.json', () => {
    expect(layoutVersionFor({ layoutVersion: 'two', blockPositions: 'nope' })).toBe(2);
    expect(layoutVersionFor({ blockPositions: [null, 3, { offsetX: 'a' }] })).toBe(2);
  });
});
