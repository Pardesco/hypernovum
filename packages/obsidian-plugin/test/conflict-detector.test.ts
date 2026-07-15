import { describe, it, expect } from 'vitest';
import { detectConflicts } from '../src/monitors/ConflictDetector';
import type { AgentSession, AgentState } from '../src/monitors/AgentRegistry';
import type { ProjectData } from '@hypernovum/core';

function proj(path: string, over: Partial<ProjectData> = {}): ProjectData {
  return {
    path,
    title: path.replace(/\.md$/, ''),
    status: 'active',
    priority: 'medium',
    category: 'web-apps',
    ...over,
  } as ProjectData;
}

function sess(over: Partial<AgentSession> = {}): AgentSession {
  return {
    sessionId: 's1',
    name: 'Claude',
    projectPath: 'app.md',
    state: 'editing' as AgentState,
    action: null,
    filesTouched: new Map(),
    sessionStart: 0,
    lastPing: 0,
    legacy: false,
    ...over,
  };
}

function withFiles(s: AgentSession, project: string, files: string[]): AgentSession {
  s.filesTouched.set(project, new Set(files));
  return s;
}

describe('detectConflicts', () => {
  const projects = [proj('app.md', { title: 'App' })];

  it('flags same-file as high severity', () => {
    const a = withFiles(sess({ sessionId: 'a', name: 'Claude' }), 'app.md', ['src/x.ts', 'src/y.ts']);
    const b = withFiles(sess({ sessionId: 'b', name: 'Codex' }), 'app.md', ['src/x.ts']);
    const [c] = detectConflicts([a, b], projects);
    expect(c.kind).toBe('same-file');
    expect(c.severity).toBe('high');
    expect(c.sessions).toEqual(['a', 'b']);
    expect(c.files).toEqual(['src/x.ts']);
    expect(c.message).toContain('src/x.ts');
  });

  it('flags overlapping-files (≥3 shared) as medium', () => {
    const a = withFiles(sess({ sessionId: 'a' }), 'app.md', ['a.ts', 'b.ts', 'c.ts', 'd.ts']);
    const b = withFiles(sess({ sessionId: 'b' }), 'app.md', ['a.ts', 'b.ts', 'c.ts', 'e.ts']);
    const [c] = detectConflicts([a, b], projects);
    expect(c.kind).toBe('overlapping-files');
    expect(c.severity).toBe('medium');
    expect(c.files).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('flags overlapping-files by ≥30% ratio even under 3 shared', () => {
    // 2 shared of a 3-file set = 66% → overlapping, not same-file
    const a = withFiles(sess({ sessionId: 'a' }), 'app.md', ['a.ts', 'b.ts', 'c.ts']);
    const b = withFiles(sess({ sessionId: 'b' }), 'app.md', ['a.ts', 'b.ts']);
    const [c] = detectConflicts([a, b], projects);
    expect(c.kind).toBe('overlapping-files');
  });

  it('flags same-project (no overlap) as info', () => {
    const a = withFiles(sess({ sessionId: 'a' }), 'app.md', ['a.ts']);
    const b = withFiles(sess({ sessionId: 'b' }), 'app.md', ['z.ts']);
    const [c] = detectConflicts([a, b], projects);
    expect(c.kind).toBe('same-project');
    expect(c.severity).toBe('info');
  });

  it('normalizes relative vs absolute paths against projectDir', () => {
    const p = [proj('app.md', { title: 'App', projectDir: 'C:/repos/app' })];
    const a = withFiles(sess({ sessionId: 'a' }), 'app.md', ['C:/repos/app/src/x.ts']);
    const b = withFiles(sess({ sessionId: 'b' }), 'app.md', ['src/x.ts']);
    const [c] = detectConflicts([a, b], p);
    expect(c.kind).toBe('same-file');
    expect(c.files).toEqual(['src/x.ts']);
  });

  it('ignores sessions on different projects', () => {
    const a = withFiles(sess({ sessionId: 'a', projectPath: 'app.md' }), 'app.md', ['x.ts']);
    const b = withFiles(sess({ sessionId: 'b', projectPath: 'other.md' }), 'other.md', ['x.ts']);
    const conflicts = detectConflicts([a, b], [proj('app.md'), proj('other.md')]);
    expect(conflicts.filter((c) => c.kind === 'same-file')).toHaveLength(0);
  });

  it('excludes non-working (stale/complete) sessions from pairwise checks', () => {
    const a = withFiles(sess({ sessionId: 'a', state: 'stale' }), 'app.md', ['x.ts']);
    const b = withFiles(sess({ sessionId: 'b', state: 'editing' }), 'app.md', ['x.ts']);
    expect(detectConflicts([a, b], projects).filter((c) => c.kind === 'same-file')).toHaveLength(0);
  });

  it('flags stale-context when a working session started dirty', () => {
    const a = sess({ sessionId: 'a', dirtyAtStart: true });
    const conflicts = detectConflicts([a], projects);
    const sc = conflicts.find((c) => c.kind === 'stale-context')!;
    expect(sc.severity).toBe('info');
    expect(sc.sessions).toEqual(['a']);
  });

  it('flags complete-while-conflicted when repo has a merge conflict', () => {
    const p = [proj('app.md', { title: 'App', gitActivity: { hasMergeConflicts: true } as any })];
    const a = sess({ sessionId: 'a', state: 'complete' });
    const cw = detectConflicts([a], p).find((c) => c.kind === 'complete-while-conflicted')!;
    expect(cw.severity).toBe('high');
  });

  it('dedupes stable keys (idempotent across identical inputs)', () => {
    const a = withFiles(sess({ sessionId: 'a' }), 'app.md', ['x.ts']);
    const b = withFiles(sess({ sessionId: 'b' }), 'app.md', ['x.ts']);
    const first = detectConflicts([a, b], projects);
    const second = detectConflicts([a, b], projects);
    expect(first.map((c) => c.key)).toEqual(second.map((c) => c.key));
  });
});
