import { describe, it, expect } from 'vitest';
import { orbVisualForState, stateTintsHost, ORB_COLORS } from '../src/scene/agentOrbVisual';

describe('orbVisualForState (§10 → orb visuals)', () => {
  it('working states use the agent hue, steady orbit, gentle pulse', () => {
    for (const s of ['starting', 'planning', 'reading', 'editing', 'running', 'testing', 'reviewing']) {
      const v = orbVisualForState(s);
      expect(v.color).toBe('hue');
      expect(v.orbit).toBe(true);
      expect(v.opacity).toBe(1);
      expect(v.fadeOut).toBe(false);
      expect(v.pulseSpeed).toBeGreaterThan(0);
    }
  });

  it('waiting is amber, orbit paused, slow strong pulse', () => {
    const v = orbVisualForState('waiting');
    expect(v.color).toBe(ORB_COLORS.waiting);
    expect(v.orbit).toBe(false);
    expect(v.pulseSpeed).toBeGreaterThan(0);
    expect(v.pulseAmplitude).toBeGreaterThan(0.4);
  });

  it('blocked and failed are red with a fast pulse', () => {
    for (const s of ['blocked', 'failed']) {
      const v = orbVisualForState(s);
      expect(v.color).toBe(ORB_COLORS.blocked);
      expect(v.pulseSpeed).toBeGreaterThanOrEqual(5);
    }
  });

  it('complete is green, static, fading out', () => {
    const v = orbVisualForState('complete');
    expect(v.color).toBe(ORB_COLORS.complete);
    expect(v.pulseSpeed).toBe(0);
    expect(v.fadeOut).toBe(true);
    expect(v.orbit).toBe(false);
  });

  it('stale/disconnected are grey, dim, no orbit', () => {
    for (const s of ['stale', 'disconnected']) {
      const v = orbVisualForState(s);
      expect(v.color).toBe(ORB_COLORS.stale);
      expect(v.opacity).toBeLessThan(1);
      expect(v.orbit).toBe(false);
    }
  });

  it('unknown states fall back to the working treatment', () => {
    expect(orbVisualForState('something-new').color).toBe('hue');
  });
});

describe('stateTintsHost', () => {
  it('only editing tints the host building', () => {
    expect(stateTintsHost('editing')).toBe(true);
    expect(stateTintsHost('reading')).toBe(false);
    expect(stateTintsHost('waiting')).toBe(false);
    expect(stateTintsHost('')).toBe(false);
  });
});
