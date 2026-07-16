import { describe, it, expect } from 'vitest';
import {
  computeWarnings,
  topWarningPerProject,
  warningBadgeCount,
  topSeverityByProject,
} from '../src/monitors/WarningAggregator';
import type { AgentSession, AgentState } from '../src/monitors/AgentRegistry';
import type { ConflictRecord } from '../src/monitors/ConflictDetector';
import type { ProjectData } from '@hypernovum/core';

function proj(path: string, over: Partial<ProjectData> = {}): ProjectData {
  return {
    path, title: path.replace(/\.md$/, ''), status: 'active', priority: 'medium', category: 'web-apps',
    ...over,
  } as ProjectData;
}
function sess(over: Partial<AgentSession> = {}): AgentSession {
  return {
    sessionId: 's1', name: 'Claude', projectPath: 'app.md', state: 'editing' as AgentState,
    action: null, filesTouched: new Map(), sessionStart: 0, lastPing: 0, legacy: false, ...over,
  };
}
const NOW = Date.now();

describe('computeWarnings (§11 catalog)', () => {
  it('merge conflict → high, open-terminal', () => {
    const w = computeWarnings([proj('app.md', { gitActivity: { hasMergeConflicts: true } as any })], [], []);
    const m = w.find((x) => x.type === 'merge-conflict')!;
    expect(m.severity).toBe('high');
    expect(m.action.kind).toBe('open-terminal');
  });

  it('blocked status → high, focus', () => {
    const w = computeWarnings([proj('app.md', { status: 'blocked' })], [], []);
    expect(w.find((x) => x.type === 'blocked')?.severity).toBe('high');
  });

  it('blocked message names resolvable blockers (blocked_by)', () => {
    const projects = [
      proj('app.md', { title: 'App', status: 'blocked', blockedBy: ['[[Core Lib]]'] }),
      proj('lib.md', { title: 'Core Lib' }),
    ];
    const w = computeWarnings(projects, [], []);
    expect(w.find((x) => x.type === 'blocked')?.message).toBe('Blocked by Core Lib');
  });

  it('unresolved blocked_by → low broken-link warning', () => {
    const w = computeWarnings([proj('app.md', { title: 'App', status: 'active', blockedBy: ['[[Ghost]]'] })], [], []);
    const bl = w.find((x) => x.type === 'broken-link')!;
    expect(bl.severity).toBe('low');
    expect(bl.message).toContain('Ghost');
  });

  it('uncommitted → medium, but suppressed when a working agent is on the project', () => {
    const git = { hasUncommittedChanges: true } as any;
    const withoutAgent = computeWarnings([proj('app.md', { gitActivity: git })], [], []);
    expect(withoutAgent.some((x) => x.type === 'uncommitted')).toBe(true);

    const withAgent = computeWarnings(
      [proj('app.md', { gitActivity: git })],
      [sess({ projectPath: 'app.md', state: 'editing' })],
      [],
    );
    expect(withAgent.some((x) => x.type === 'uncommitted')).toBe(false);
  });

  it('behind upstream → medium with count; ahead-only does not warn', () => {
    const behind = computeWarnings([proj('app.md', { gitActivity: { behind: 3, ahead: 0 } as any })], [], []);
    expect(behind.find((x) => x.type === 'behind-upstream')?.message).toContain('3');
    const ahead = computeWarnings([proj('app.md', { gitActivity: { behind: 0, ahead: 4 } as any })], [], []);
    expect(ahead.some((x) => x.type === 'behind-upstream')).toBe(false);
  });

  it('stale project → low (active + untouched >30d)', () => {
    const old = NOW - 45 * 24 * 3600 * 1000;
    const w = computeWarnings([proj('app.md', { status: 'active', gitActivity: { lastCommitDate: old } as any })], [], []);
    expect(w.find((x) => x.type === 'stale-project')?.severity).toBe('low');
  });

  it('same-file conflict → high; overlapping → medium (both agents-same-file type)', () => {
    const conflicts: ConflictRecord[] = [
      { key: 'k1', kind: 'same-file', severity: 'high', sessions: ['a', 'b'], projectPaths: ['app.md'], message: 'both touched x.ts' },
      { key: 'k2', kind: 'overlapping-files', severity: 'medium', sessions: ['a', 'b'], projectPaths: ['app.md'], message: 'overlap on 4' },
    ];
    const w = computeWarnings([proj('app.md')], [], conflicts);
    const agentWarnings = w.filter((x) => x.type === 'agents-same-file');
    expect(agentWarnings.map((x) => x.severity).sort()).toEqual(['high', 'medium']);
    expect(agentWarnings.every((x) => x.action.kind === 'show-conflict')).toBe(true);
  });

  it('agent state warnings: failed→high, waiting→medium, stale→low', () => {
    const w = computeWarnings([proj('app.md')], [
      sess({ sessionId: 'f', state: 'failed' }),
      sess({ sessionId: 'w', state: 'waiting' }),
      sess({ sessionId: 's', state: 'stale' }),
    ], []);
    expect(w.find((x) => x.type === 'agent-failed')?.severity).toBe('high');
    expect(w.find((x) => x.type === 'agent-waiting')?.severity).toBe('medium');
    expect(w.find((x) => x.type === 'stale-agent')?.severity).toBe('low');
  });

  it('degraded data → low, vault-level (null path)', () => {
    const w = computeWarnings([], [], [], 3);
    const d = w.find((x) => x.type === 'degraded-data')!;
    expect(d.severity).toBe('low');
    expect(d.projectPath).toBeNull();
    expect(d.message).toContain('3');
  });

  it('sorts high severity first', () => {
    const w = computeWarnings(
      [proj('app.md', { status: 'blocked', gitActivity: { behind: 1 } as any })],
      [sess({ state: 'stale', sessionId: 'z' })],
      [],
    );
    expect(severities(w)[0]).toBe('high');
    expect(severities(w).at(-1)).toBe('low');
  });
});

function severities(w: { severity: string }[]) {
  return w.map((x) => x.severity);
}

describe('overview helpers', () => {
  const warnings = computeWarnings(
    [proj('app.md', { status: 'blocked', gitActivity: { behind: 2 } as any })], // high + medium on one project
    [sess({ sessionId: 'z', state: 'stale', projectPath: 'app.md' })],          // low
    [],
  );

  it('topWarningPerProject keeps only the highest severity per project', () => {
    const top = topWarningPerProject(warnings);
    const forApp = top.filter((w) => w.projectPath === 'app.md');
    expect(forApp).toHaveLength(1);
    expect(forApp[0].severity).toBe('high');
  });

  it('warningBadgeCount counts high+medium only (low excluded)', () => {
    // high (blocked) + medium (behind) = 2; low (stale-agent) excluded
    expect(warningBadgeCount(warnings)).toBe(2);
  });

  it('topSeverityByProject returns the max severity per project', () => {
    expect(topSeverityByProject(warnings).get('app.md')).toBe('high');
  });
});
