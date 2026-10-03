import { describe, it, expect } from 'vitest';
import {
  BACKGROUND_FRAME_MS,
  IDLE_AFTER_MS,
  IDLE_FRAME_MS,
  minFrameInterval,
  shouldRenderFrame,
} from '../src/scene/framePacing';

const base = { now: 100_000, lastActivityAt: 100_000, focused: true, needsFullRate: false };

describe('minFrameInterval (GFX-008)', () => {
  it('renders every frame while the user is interacting', () => {
    expect(minFrameInterval(base)).toBe(0);
    expect(minFrameInterval({ ...base, lastActivityAt: base.now - IDLE_AFTER_MS })).toBe(0);
  });

  it('drops to ~30 fps after 5 s without input', () => {
    expect(minFrameInterval({ ...base, lastActivityAt: base.now - IDLE_AFTER_MS - 1 })).toBe(IDLE_FRAME_MS);
    expect(Math.round(1000 / IDLE_FRAME_MS)).toBe(30);
  });

  it('drops to ~5 fps while Obsidian is unfocused, even mid-interaction', () => {
    expect(minFrameInterval({ ...base, focused: false })).toBe(BACKGROUND_FRAME_MS);
    expect(Math.round(1000 / BACKGROUND_FRAME_MS)).toBe(5);
  });

  it('never throttles while something needs full rate (the Auto probe)', () => {
    expect(minFrameInterval({ ...base, focused: false, lastActivityAt: 0, needsFullRate: true })).toBe(0);
  });
});

describe('shouldRenderFrame', () => {
  it('renders every frame at full rate', () => {
    expect(shouldRenderFrame(1000, 999, 0)).toBe(true);
  });

  it('hits ~30 fps on a 60 Hz display despite rAF jitter', () => {
    // 60 Hz frames at 16.6 ms with ±0.5 ms jitter: every other frame renders.
    let last = 0, rendered = 0;
    for (let i = 1; i <= 600; i++) {
      const t = i * 16.67 + (i % 2 ? 0.5 : -0.5);
      if (shouldRenderFrame(t, last, IDLE_FRAME_MS)) { last = t; rendered++; }
    }
    expect(rendered).toBeGreaterThanOrEqual(290);
    expect(rendered).toBeLessThanOrEqual(310);
  });
});
