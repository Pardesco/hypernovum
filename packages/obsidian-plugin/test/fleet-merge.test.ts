import { describe, it, expect } from 'vitest';
import {
  parseSnapshotToPresence,
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

describe('mergeFleet', () => {
  it('an empty snapshot directory yields no agents', () => {
    expect(mergeFleet([])).toEqual([]);
  });

  it('passes distinct sessions through', () => {
    const v2 = [
      parseSnapshotToPresence(snap({ sessionId: 's1', project: 'other', lastPing: 200 }))!,
      parseSnapshotToPresence(snap({ sessionId: 's2', project: 'app', lastPing: 100 }))!,
    ];
    expect(mergeFleet(v2).map((a) => a.id).sort()).toEqual(['s1', 's2']);
  });

  it('dedupes by id, keeping the freshest (guards phantom duplicates)', () => {
    const dup = [
      parseSnapshotToPresence(snap({ sessionId: 's1', lastPing: 100, action: 'old' }))!,
      parseSnapshotToPresence(snap({ sessionId: 's1', lastPing: 300, action: 'new' }))!,
    ];
    const out = mergeFleet(dup);
    expect(out).toHaveLength(1);
    expect(out[0].action).toBe('new');
  });

  it('sorts freshest-first and caps at FLEET_CAP', () => {
    const many = Array.from({ length: FLEET_CAP + 5 }, (_, i) =>
      parseSnapshotToPresence(snap({ sessionId: `s${i}`, lastPing: i + 1 }))!,
    );
    const out = mergeFleet(many);
    expect(out).toHaveLength(FLEET_CAP);
    expect(out[0].lastPing).toBe(FLEET_CAP + 5); // freshest first
    expect(out[0].id).toBe(`s${FLEET_CAP + 4}`);
  });
});
