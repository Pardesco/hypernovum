import { describe, it, expect } from 'vitest';
import { parseSnapshotToPresence, mergeFleet } from '../src/monitors/fleetMerge';
import { parseSessionLines, parseSessionDigest } from '../src/monitors/sessionDigest';
import { buildManifestIndex, matchManifestDeps, resolveProjectRef } from '../src/monitors/dependencyMatch';
import { parseRecentCommits, parseAheadBehind } from '../src/monitors/GitActivityCollector';
import { computeWarnings } from '../src/monitors/WarningAggregator';

// A grab-bag of hostile inputs.
const GARBAGE: unknown[] = [
  null, undefined, 0, 1, -1, NaN, Infinity, '', 'x', '{}', '[]', [], {},
  [1, 2, 3], { random: 'junk' }, true, false, () => {}, Symbol('s') as unknown,
  { sessionId: 123, lastPing: 'nope' }, { lastPing: NaN }, { project: {} },
];

describe('HRD-002 — parsers never throw on garbage', () => {
  it('parseSnapshotToPresence tolerates any input', () => {
    for (const g of GARBAGE) expect(() => parseSnapshotToPresence(g)).not.toThrow();
    // Structurally-invalid snapshots yield null (→ counted as degraded, skipped).
    expect(parseSnapshotToPresence({ sessionId: 123, lastPing: 'nope' })).toBeNull();
    expect(parseSnapshotToPresence([])).toBeNull();
  });

  it('mergeFleet tolerates empty/garbage-derived lists', () => {
    expect(() => mergeFleet([])).not.toThrow();
    expect(mergeFleet([])).toEqual([]);
  });
});

describe('HRD-002 — session log tolerates torn/garbage JSONL', () => {
  it('skips torn last line, BOM, blank lines, and non-JSON', () => {
    const text = [
      '﻿' + JSON.stringify({ t: 1, sessionId: 's', kind: 'session-start' }), // BOM prefix
      '',
      '   ',
      'not json at all',
      '{ "t": 2, "sessionId": "s", "kind": "ping"',   // torn (truncated) line
      JSON.stringify({ t: 3, sessionId: 's', kind: 'ping', file: 'a.ts' }),
    ].join('\n');
    let events: ReturnType<typeof parseSessionLines> = [];
    expect(() => { events = parseSessionLines(text); }).not.toThrow();
    // The BOM line fails JSON.parse; only the two clean lines survive.
    expect(events.length).toBe(2);
    expect(() => parseSessionDigest(events)).not.toThrow();
  });

  it('parseSessionDigest tolerates empty + malformed event arrays', () => {
    expect(parseSessionDigest([])).toBeNull();
    expect(() => parseSessionDigest([{ t: 1 } as any, {} as any])).not.toThrow();
  });
});

describe('HRD-002 — dependency + git parsers tolerate garbage', () => {
  it('manifest matching never throws on junk deps/index', () => {
    const idx = buildManifestIndex([{ path: 'a.md' }, { path: 'b.md', name: 'lib', projectDir: 'C:/lib' }]);
    expect(() => matchManifestDeps({} as any, idx, 'a.md')).not.toThrow();
    expect(() => matchManifestDeps({ x: null as any, y: 123 as any }, idx, 'a.md')).not.toThrow();
    expect(matchManifestDeps({ lib: '^1' }, idx, 'a.md')).toEqual(['b.md']);
  });

  it('resolveProjectRef tolerates junk refs', () => {
    for (const g of ['', '[[', ']]', '[[]]', '   ', '﻿']) {
      expect(() => resolveProjectRef(g, [{ path: 'a.md', title: 'A' }])).not.toThrow();
    }
  });

  it('git output parsers tolerate torn/garbage strings', () => {
    for (const g of ['', 'garbage', '\t\t', 'a\tnotanumber\tsubject', null]) {
      expect(() => parseRecentCommits(g as any)).not.toThrow();
      expect(() => parseAheadBehind(g as any)).not.toThrow();
    }
    expect(parseRecentCommits('garbage-no-tabs')).toEqual([]);
    expect(parseAheadBehind('garbage')).toEqual({ ahead: null, behind: null });
  });
});

describe('HRD-002 — warning aggregator surfaces degraded-data, tolerates junk', () => {
  it('raises one aggregated degraded-data warning when skips > 0', () => {
    const w = computeWarnings([], [], [], 5);
    const d = w.filter((x) => x.type === 'degraded-data');
    expect(d).toHaveLength(1);
    expect(d[0].severity).toBe('low');
    expect(d[0].message).toContain('5');
  });

  it('no degraded warning when nothing was skipped', () => {
    expect(computeWarnings([], [], [], 0).some((x) => x.type === 'degraded-data')).toBe(false);
  });

  it('tolerates projects/sessions with missing fields', () => {
    expect(() => computeWarnings(
      [{ path: 'a.md', title: 'A', status: 'active' } as any],
      [{ sessionId: 's', state: 'editing', projectPath: null, filesTouched: new Map() } as any],
      [],
    )).not.toThrow();
  });
});
