import { describe, it, expect } from 'vitest';
import {
  deriveAgentState,
  inferStateFromTool,
  AgentRegistry,
  LIVE_MS,
  WAITING_MAX_MS,
  DISCONNECT_MS,
} from '../src/monitors/AgentRegistry';
import type { AgentPresence } from '../src/monitors/fleetMerge';

const NOW = 1_000_000_000;

function presence(over: Partial<AgentPresence> = {}): AgentPresence {
  return {
    id: 's1',
    name: 'Claude Code',
    agentType: 'claude',
    project: 'app',
    action: null,
    state: undefined,
    tool: null,
    file: null,
    lastPing: NOW,
    sessionStart: NOW - 5000,
    active: true,
    legacy: false,
    ...over,
  };
}

describe('inferStateFromTool', () => {
  it('maps tools to working states', () => {
    expect(inferStateFromTool('Edit')).toBe('editing');
    expect(inferStateFromTool('Write')).toBe('editing');
    expect(inferStateFromTool('NotebookEdit')).toBe('editing');
    expect(inferStateFromTool('Read')).toBe('reading');
    expect(inferStateFromTool('Grep')).toBe('reading');
    expect(inferStateFromTool('Bash')).toBe('running');
    expect(inferStateFromTool('PowerShell')).toBe('running');
    expect(inferStateFromTool('Unknown')).toBe('running');
  });

  it('detects testing from the action phrase', () => {
    expect(inferStateFromTool('Bash', 'npm test')).toBe('testing');
    expect(inferStateFromTool('Edit', 'writing tests')).toBe('testing');
  });
});

describe('deriveAgentState (§10 matrix)', () => {
  it('fresh explicit live state wins', () => {
    expect(deriveAgentState(presence({ state: 'planning', lastPing: NOW }), NOW)).toBe('planning');
    expect(deriveAgentState(presence({ state: 'reviewing', lastPing: NOW }), NOW)).toBe('reviewing');
  });

  it('fresh with no explicit state infers from tool', () => {
    expect(deriveAgentState(presence({ tool: 'Edit', lastPing: NOW }), NOW)).toBe('editing');
    expect(deriveAgentState(presence({ tool: 'Read', lastPing: NOW }), NOW)).toBe('reading');
  });

  it('complete is sticky regardless of age', () => {
    expect(deriveAgentState(presence({ state: 'complete', lastPing: NOW - DISCONNECT_MS - 1 }), NOW)).toBe('complete');
  });

  it('failed/blocked stay red until past the waiting window, then stale', () => {
    expect(deriveAgentState(presence({ state: 'failed', lastPing: NOW - 30_000 }), NOW)).toBe('failed');
    expect(deriveAgentState(presence({ state: 'failed', lastPing: NOW - WAITING_MAX_MS - 1 }), NOW)).toBe('stale');
    expect(deriveAgentState(presence({ state: 'blocked', lastPing: NOW - 30_000 }), NOW)).toBe('blocked');
    expect(deriveAgentState(presence({ state: 'blocked', lastPing: NOW - WAITING_MAX_MS - 1 }), NOW)).toBe('stale');
  });

  it('age ladder: live → stale → disconnected, never inferred waiting', () => {
    expect(deriveAgentState(presence({ lastPing: NOW - (LIVE_MS + 5_000) }), NOW)).toBe('stale');
    expect(deriveAgentState(presence({ lastPing: NOW - (WAITING_MAX_MS + 5_000) }), NOW)).toBe('stale');
    expect(deriveAgentState(presence({ lastPing: NOW - (DISCONNECT_MS + 5_000) }), NOW)).toBe('disconnected');
  });

  it('AGT-010: one --state=editing ping reads editing for 90s, stale after, gone after 15min', () => {
    const p = presence({ state: 'editing', lastPing: NOW });
    expect(LIVE_MS).toBe(90_000);
    // The 10-60s generation gap between tool calls used to flip this to stale.
    for (const age of [0, 10_001, 30_000, 60_000, 90_000]) {
      expect(deriveAgentState(p, NOW + age)).toBe('editing');
    }
    expect(deriveAgentState(p, NOW + 90_001)).toBe('stale');
    expect(deriveAgentState(p, NOW + DISCONNECT_MS)).toBe('stale');
    expect(deriveAgentState(p, NOW + DISCONNECT_MS + 1)).toBe('disconnected');
  });

  it('AGT-010: every explicit live state (and tool inference) gets the same window', () => {
    for (const state of ['planning', 'reading', 'editing', 'running', 'testing', 'reviewing', 'starting']) {
      expect(deriveAgentState(presence({ state, lastPing: NOW - 45_000 }), NOW)).toBe(state);
    }
    // --hook pings carry no --state, so a busy Claude Code session lives on inference.
    expect(deriveAgentState(presence({ tool: 'Edit', lastPing: NOW - 45_000 }), NOW)).toBe('editing');
    expect(deriveAgentState(presence({ tool: 'Bash', action: 'npm test', lastPing: NOW - 80_000 }), NOW)).toBe('testing');
  });

  it('AGT-010: blocked, failed and complete keep their 0.6.0 behaviour', () => {
    expect(deriveAgentState(presence({ state: 'blocked', lastPing: NOW - 100_000 }), NOW)).toBe('blocked');
    expect(deriveAgentState(presence({ state: 'blocked', lastPing: NOW - WAITING_MAX_MS - 1 }), NOW)).toBe('stale');
    expect(deriveAgentState(presence({ state: 'failed', lastPing: NOW - 100_000 }), NOW)).toBe('failed');
    expect(deriveAgentState(presence({ state: 'failed', lastPing: NOW - WAITING_MAX_MS - 1 }), NOW)).toBe('stale');
    expect(deriveAgentState(presence({ state: 'complete', lastPing: NOW - DISCONNECT_MS * 2 }), NOW)).toBe('complete');
  });

  it('explicit live state overrides the age ladder only inside the live window', () => {
    expect(deriveAgentState(presence({ state: 'editing', lastPing: NOW - 60_000 }), NOW)).toBe('editing');
    expect(deriveAgentState(presence({ state: 'editing', lastPing: NOW - LIVE_MS - 1 }), NOW)).toBe('stale');
  });
});

describe('AgentRegistry', () => {
  const resolve = (p: AgentPresence) => (p.project ? `Projects/${p.project}.md` : null);

  it('accumulates filesTouched per (session, project) across pings', () => {
    const reg = new AgentRegistry(resolve);
    reg.update([presence({ file: 'src/a.ts', tool: 'Edit', lastPing: NOW })], NOW);
    reg.update([presence({ file: 'src/b.ts', tool: 'Edit', lastPing: NOW + 1000 })], NOW + 1000);
    const [s] = reg.getSessions();
    const files = s.filesTouched.get('Projects/app.md')!;
    expect([...files].sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('normalizes backslashes in filesTouched', () => {
    const reg = new AgentRegistry(resolve);
    reg.update([presence({ file: 'src\\deep\\c.ts', tool: 'Edit', lastPing: NOW })], NOW);
    const files = reg.getSessions()[0].filesTouched.get('Projects/app.md')!;
    expect([...files]).toEqual(['src/deep/c.ts']);
  });

  it('resets filesTouched when a same-id session restarts (new sessionStart)', () => {
    const reg = new AgentRegistry(resolve);
    reg.update([presence({ file: 'src/a.ts', tool: 'Edit', sessionStart: 100, lastPing: NOW })], NOW);
    reg.update([presence({ file: 'src/new.ts', tool: 'Edit', sessionStart: 999, lastPing: NOW + 1 })], NOW + 1);
    const files = reg.getSessions()[0].filesTouched.get('Projects/app.md')!;
    expect([...files]).toEqual(['src/new.ts']); // fresh session, prior files gone
  });

  it('drops sessions absent from the fleet', () => {
    const reg = new AgentRegistry(resolve);
    reg.update([presence({ id: 'a', lastPing: NOW }), presence({ id: 'b', lastPing: NOW })], NOW);
    expect(reg.getSessions()).toHaveLength(2);
    reg.update([presence({ id: 'a', lastPing: NOW + 1 })], NOW + 1);
    expect(reg.getSessions().map((s) => s.sessionId)).toEqual(['a']);
  });

  it('drops disconnected sessions', () => {
    const reg = new AgentRegistry(resolve);
    reg.update([presence({ id: 'a', lastPing: NOW })], NOW);
    // Same session still in fleet but aged past disconnect → derived disconnected → dropped
    reg.update([presence({ id: 'a', lastPing: NOW - DISCONNECT_MS - 1 })], NOW);
    expect(reg.getSessions()).toHaveLength(0);
  });

  it('sessionsForProject filters by resolved path', () => {
    const reg = new AgentRegistry(resolve);
    reg.update([
      presence({ id: 'a', project: 'app', lastPing: NOW }),
      presence({ id: 'b', project: 'other', lastPing: NOW }),
    ], NOW);
    expect(reg.sessionsForProject('Projects/app.md').map((s) => s.sessionId)).toEqual(['a']);
  });
});
