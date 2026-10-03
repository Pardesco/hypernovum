import { describe, it, expect } from 'vitest';
import { migrateAgentName } from '../src/settings/settingsMigrations';

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
