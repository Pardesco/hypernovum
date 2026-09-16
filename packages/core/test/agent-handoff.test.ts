import { describe, it, expect } from 'vitest';
import { agentCommandWithContext } from '../src/utils/agentHandoff';
describe('provider handoff', () => {
  it('hands context to supported bare launchers without changing approval settings', () => {
    expect(agentCommandWithContext('codex')).toContain('Read .hypernovum/SETUP.md');
    expect(agentCommandWithContext('claude')).toContain('--append-system-prompt');
    expect(agentCommandWithContext('codex')).not.toContain('--yolo');
  });
  it('preserves custom commands, existing prompts, and shell expressions byte for byte', () => {
    for (const command of ['codex --resume', 'claude "existing task"', 'custom-agent', 'claude && echo done']) expect(agentCommandWithContext(command)).toBe(command);
  });
});
