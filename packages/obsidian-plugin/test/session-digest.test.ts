import { describe, it, expect } from 'vitest';
import { parseSessionLines, parseSessionDigest, type ActivityEvent } from '../src/monitors/sessionDigest';

function ev(over: Partial<ActivityEvent>): ActivityEvent {
  return { t: 0, sessionId: 's1', kind: 'ping', ...over };
}

describe('parseSessionLines', () => {
  it('parses JSONL and skips torn/garbage lines', () => {
    const text = [
      JSON.stringify(ev({ t: 1, kind: 'session-start' })),
      'not json',
      '',
      JSON.stringify(ev({ t: 2, file: 'a.ts' })),
    ].join('\n');
    const events = parseSessionLines(text);
    expect(events).toHaveLength(2);
    expect(events[1].file).toBe('a.ts');
  });
});

describe('parseSessionDigest', () => {
  it('computes duration, distinct files, name, project, ended', () => {
    const d = parseSessionDigest([
      ev({ t: 1000, kind: 'session-start', name: 'Claude Code', project: 'app', file: 'a.ts' }),
      ev({ t: 60_000, kind: 'ping', file: 'b.ts' }),
      ev({ t: 61_000, kind: 'ping', file: 'a.ts' }), // repeat file → deduped
      ev({ t: 120_000, kind: 'stop' }),
    ])!;
    expect(d.name).toBe('Claude Code');
    expect(d.project).toBe('app');
    expect(d.durationMs).toBe(119_000);
    expect(d.filesTouched.sort()).toEqual(['a.ts', 'b.ts']);
    expect(d.ended).toBe(true);
  });

  it('captures objective + plannedFiles for plan-vs-action (SES-003)', () => {
    const d = parseSessionDigest([
      ev({ t: 1, kind: 'session-start', objective: 'ship cart', plannedFiles: ['x.ts', 'y.ts'] }),
      ev({ t: 2, file: 'x.ts' }),
      ev({ t: 3, file: 'z.ts' }),
    ])!;
    expect(d.objective).toBe('ship cart');
    expect(d.plannedFiles).toEqual(['x.ts', 'y.ts']);
    expect(d.filesTouched.sort()).toEqual(['x.ts', 'z.ts']);
  });

  it('handles an unended (still-running) session', () => {
    const d = parseSessionDigest([ev({ t: 5, kind: 'session-start' })])!;
    expect(d.ended).toBe(false);
    expect(d.durationMs).toBe(0);
  });

  it('returns null for no events', () => {
    expect(parseSessionDigest([])).toBeNull();
  });
});
