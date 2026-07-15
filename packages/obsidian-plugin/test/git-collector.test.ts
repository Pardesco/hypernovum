import { describe, it, expect } from 'vitest';
import { parseRecentCommits, parseAheadBehind } from '../src/monitors/GitActivityCollector';
import { mapLimit } from '../src/utils/concurrency';

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
