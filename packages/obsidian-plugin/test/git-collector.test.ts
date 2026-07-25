import { describe, it, expect } from 'vitest';
import {
  GitActivityCollector,
  parseRecentCommits,
  parseAheadBehind,
} from '../src/monitors/GitActivityCollector';
import { mapLimit } from '../src/utils/concurrency';

/** Collector with the process-spawning half stubbed, so we can count real scans. */
function countingCollector() {
  const collector = new GitActivityCollector();
  const state = { scans: 0 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (collector as any).collectUncached = async (dir: string) => {
    state.scans++;
    return { projectPath: dir } as never;
  };
  return { collector, state };
}

describe('parseRecentCommits', () => {
  it('parses tab-separated hash/ts/subject lines (ms timestamps)', () => {
    const raw = 'a1b2c3\t1700000000\tfix cart bug\nd4e5f6\t1699990000\tadd checkout';
    const out = parseRecentCommits(raw);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ hash: 'a1b2c3', ts: 1700000000000, subject: 'fix cart bug' });
    expect(out[1].subject).toBe('add checkout');
  });

  it('keeps tabs inside a subject', () => {
    const out = parseRecentCommits('a1\t1700000000\tsubject\twith\ttabs');
    expect(out[0].subject).toBe('subject\twith\ttabs');
  });

  it('returns [] for null/empty and skips malformed lines', () => {
    expect(parseRecentCommits(null)).toEqual([]);
    expect(parseRecentCommits('')).toEqual([]);
    expect(parseRecentCommits('garbage-no-tabs')).toEqual([]);
  });
});

describe('parseAheadBehind', () => {
  it('parses "behind<TAB>ahead"', () => {
    expect(parseAheadBehind('3\t5')).toEqual({ behind: 3, ahead: 5 });
    expect(parseAheadBehind('0\t0')).toEqual({ behind: 0, ahead: 0 });
  });

  it('returns null/null when there is no upstream (raw null)', () => {
    expect(parseAheadBehind(null)).toEqual({ ahead: null, behind: null });
  });

  it('returns null/null on malformed output', () => {
    expect(parseAheadBehind('nope')).toEqual({ ahead: null, behind: null });
  });
});

describe('GitActivityCollector caching', () => {
  it('scans a directory once for concurrent callers', async () => {
    // Several project notes commonly resolve to the same repo; each scan forks 8
    // git processes, so a shared in-flight promise is the whole point.
    const { collector, state } = countingCollector();
    await Promise.all([
      collector.collect('/repo', 1000),
      collector.collect('/repo', 1000),
      collector.collect('/repo', 1000),
    ]);
    expect(state.scans).toBe(1);
  });

  it('reuses the result inside the TTL and rescans after it', async () => {
    const { collector, state } = countingCollector();
    await collector.collect('/repo', 0);
    await collector.collect('/repo', 29_000);
    expect(state.scans).toBe(1);
    await collector.collect('/repo', 31_000);
    expect(state.scans).toBe(2);
  });

  it('keys the cache per directory', async () => {
    const { collector, state } = countingCollector();
    await collector.collect('/a', 0);
    await collector.collect('/b', 0);
    expect(state.scans).toBe(2);
  });

  it('invalidate() forces a rescan', async () => {
    const { collector, state } = countingCollector();
    await collector.collect('/repo', 0);
    collector.invalidate('/repo');
    await collector.collect('/repo', 1);
    expect(state.scans).toBe(2);

    collector.invalidate();
    await collector.collect('/repo', 2);
    expect(state.scans).toBe(3);
  });

  it('does not cache a rejection', async () => {
    const collector = new GitActivityCollector();
    let calls = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (collector as any).collectUncached = async () => {
      calls++;
      throw new Error('git exploded');
    };

    await expect(collector.collect('/repo', 0)).rejects.toThrow('git exploded');
    await expect(collector.collect('/repo', 1)).rejects.toThrow('git exploded');
    expect(calls).toBe(2);
  });
});

describe('mapLimit', () => {
  it('preserves order and returns all results', async () => {
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('handles an empty list', async () => {
    expect(await mapLimit([], 4, async (x) => x)).toEqual([]);
  });
});
