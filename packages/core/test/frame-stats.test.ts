import { describe, it, expect } from 'vitest';
import { FrameStats, formatPerfSnapshot } from '../src/scene/frameStats';

describe('FrameStats', () => {
  it('reports median and quantiles over a rolling window', () => {
    const s = new FrameStats(5);
    for (const ms of [10, 20, 30, 40, 50]) s.push(ms);
    expect(s.median()).toBe(30);
    expect(s.quantile(0.9)).toBe(50);
    s.push(60); // evicts 10
    expect(s.count).toBe(5);
    expect(s.median()).toBe(40);
  });

  it('ignores junk samples and is empty-safe', () => {
    const s = new FrameStats();
    s.push(Number.NaN);
    s.push(-1);
    s.push(Infinity);
    expect(s.count).toBe(0);
    expect(s.median()).toBe(0);
  });
});

describe('formatPerfSnapshot', () => {
  it('prints the overlay lines', () => {
    const lines = formatPerfSnapshot({
      frameMs: 16.7, frameP90Ms: 18.2, cpuMs: 0.84, fps: 60, drawCalls: 287,
      triangles: 16390, pixelRatio: 1, tier: 'high',
    });
    expect(lines).toEqual([
      '60 fps · frame 16.7 ms (p90 18.2)',
      'cpu 0.84 ms · 287 draws · 16k tris',
      'pixel ratio 1.00 · high',
    ]);
  });
});
