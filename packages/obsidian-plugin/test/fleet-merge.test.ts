import { describe, it, expect } from 'vitest';
import {
  parseSnapshotToPresence,
  legacyToPresence,
  mergeFleet,
  FLEET_CAP,
} from '../src/monitors/fleetMerge';

function snap(over: Partial<any> = {}): any {
  return {
    version: 2,
    sessionId: 'sess-1',
    name: 'Claude Code',
    agentType: 'claude',
    project: 'app',
    state: 'editing',
    action: 'Edit x.ts',
    tool: 'Edit',
    file: 'src/x.ts',
    sessionStart: 1000,
    lastPing: 2000,
    ...over,
  };
}

describe('parseSnapshotToPresence', () => {
  it('parses a well-formed v2 snapshot', () => {
    const p = parseSnapshotToPresence(snap())!;
    expect(p).not.toBeNull();
    expect(p.id).toBe('sess-1');
    expect(p.name).toBe('Claude Code');
    expect(p.agentType).toBe('claude');
    expect(p.state).toBe('editing');
    expect(p.file).toBe('src/x.ts');
    expect(p.active).toBe(true);
    expect(p.legacy).toBe(false);
    expect(p.sessionStart).toBe(1000);
  });

  it('rejects snapshots missing id or lastPing', () => {
    expect(parseSnapshotToPresence(snap({ sessionId: undefined }))).toBeNull();
    expect(parseSnapshotToPresence(snap({ lastPing: 0 }))).toBeNull();
    expect(parseSnapshotToPresence(null)).toBeNull();
    expect(parseSnapshotToPresence('nope')).toBeNull();
  });

  it('marks complete/failed/stopped snapshots inactive', () => {
    expect(parseSnapshotToPresence(snap({ state: 'complete' }))!.active).toBe(false);
    expect(parseSnapshotToPresence(snap({ state: 'failed' }))!.active).toBe(false);
    expect(parseSnapshotToPresence(snap({ state: undefined, stoppedAt: 5 }))!.active).toBe(false);
  });

  it('defaults sessionStart to lastPing when absent', () => {
    expect(parseSnapshotToPresence(snap({ sessionStart: undefined }))!.sessionStart).toBe(2000);
  });
});

describe('legacyToPresence', () => {
  it('parses the legacy single-status file as the anonymous agent', () => {
    const p = legacyToPresence({ active: true, project: 'app', action: 'working', lastPing: 500 })!;
    expect(p.id).toBe('legacy');
    expect(p.legacy).toBe(true);
    expect(p.project).toBe('app');
    expect(p.active).toBe(true);
  });

  it('honors active:false and rejects unusable input', () => {
    expect(legacyToPresence({ active: false, lastPing: 1 })!.active).toBe(false);
    expect(legacyToPresence({ project: 'x' })).toBeNull(); // no lastPing
    expect(legacyToPresence(null)).toBeNull();
  });
});

describe('mergeFleet', () => {
  it('legacy-only vault yields exactly the legacy agent', () => {
    const legacy = legacyToPresence({ active: true, project: 'app', lastPing: 100 });
    const out = mergeFleet([], legacy);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('legacy');
  });

  it('keeps legacy when no v2 session covers the same project', () => {
    const v2 = [parseSnapshotToPresence(snap({ sessionId: 's1', project: 'other', lastPing: 200 }))!];
    const legacy = legacyToPresence({ active: true, project: 'app', lastPing: 100 });
    const out = mergeFleet(v2, legacy);
    expect(out.map((a) => a.id).sort()).toEqual(['legacy', 's1']);
  });

  it('drops legacy when a fresher v2 session claims the same project', () => {
    const v2 = [parseSnapshotToPresence(snap({ sessionId: 's1', project: 'app', lastPing: 300 }))!];
    const legacy = legacyToPresence({ active: true, project: 'app', lastPing: 100 });
    const out = mergeFleet(v2, legacy);
    expect(out.map((a) => a.id)).toEqual(['s1']);
  });

  it('keeps legacy if its ping is fresher than the same-project v2 session', () => {
    const v2 = [parseSnapshotToPresence(snap({ sessionId: 's1', project: 'app', lastPing: 100 }))!];
    const legacy = legacyToPresence({ active: true, project: 'app', lastPing: 300 });
    const out = mergeFleet(v2, legacy);
    expect(out.map((a) => a.id).sort()).toEqual(['legacy', 's1']);
  });

  it('dedupes by id, keeping the freshest (guards phantom duplicates)', () => {
    const dup = [
      parseSnapshotToPresence(snap({ sessionId: 's1', lastPing: 100, action: 'old' }))!,
      parseSnapshotToPresence(snap({ sessionId: 's1', lastPing: 300, action: 'new' }))!,
    ];
    const out = mergeFleet(dup, null);
    expect(out).toHaveLength(1);
    expect(out[0].action).toBe('new');
  });

  it('sorts freshest-first and caps at FLEET_CAP', () => {
    const many = Array.from({ length: FLEET_CAP + 5 }, (_, i) =>
      parseSnapshotToPresence(snap({ sessionId: `s${i}`, lastPing: i + 1 }))!,
    );
    const out = mergeFleet(many, null);
    expect(out).toHaveLength(FLEET_CAP);
    expect(out[0].lastPing).toBe(FLEET_CAP + 5); // freshest first
    expect(out[0].id).toBe(`s${FLEET_CAP + 4}`);
  });
});
