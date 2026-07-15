import { describe, it, expect } from 'vitest';
import { resolveVisualState } from '../src/scene/visualState';
import { STATUS_COLORS } from '../src/types';

const weather = (over: Partial<{ hasMergeConflicts: boolean; churnScore: number; staleBranchCount: number }> = {}) => ({
  hasMergeConflicts: false,
  churnScore: 0,
  staleBranchCount: 0,
  ...over,
});

describe('resolveVisualState precedence (§8)', () => {
  it('default: status owns base color and anim baselines', () => {
    const s = resolveVisualState({ status: 'active' });
    expect(s.baseColor).toBe(STATUS_COLORS.active);
    expect(s.emissiveBase).toBeCloseTo(0.12);
    expect(s.pulseSpeed).toBeCloseTo(1.5);
    expect(s.opacity).toBe(1);
    expect(s.scale).toBe(1);
    expect(s.glitch).toBe(0);
  });

  it('blocked status carries glitch base and edge-glow pulse', () => {
    const s = resolveVisualState({ status: 'blocked' });
    expect(s.glitch).toBeCloseTo(0.5);
    expect(s.edgeGlowPulse).toBe(true);
    expect(s.edgeGlowColorScale).toBe(3.0);
  });

  it('lens owns base color over status', () => {
    const s = resolveVisualState({ status: 'active', lensColor: 0x123456 });
    expect(s.baseColor).toBe(0x123456);
    expect(s.emissiveColor).toBe(0x123456);
  });

  it('merge-conflict weather overrides emissive channels but not lens base', () => {
    const s = resolveVisualState({
      status: 'active',
      lensColor: 0x123456,
      weather: weather({ hasMergeConflicts: true }),
    });
    expect(s.baseColor).toBe(0x123456);       // lens keeps base
    expect(s.emissiveColor).toBe(0xff2222);   // conflict takes emissive
    expect(s.glitch).toBeCloseTo(0.7);
    expect(s.glitchSpeed).toBe(6);
  });

  it('stale branches dampen emissive and raise decay', () => {
    const s = resolveVisualState({ status: 'active', weather: weather({ staleBranchCount: 6 }) });
    expect(s.emissiveBase).toBeCloseTo(0.12 * 0.5);
    expect(s.decay).toBeCloseTo(0.9);
  });

  it('decay attenuates lit windows past the 0.3 threshold', () => {
    const s = resolveVisualState({ status: 'active', decayFactor: 0.5, litPercent: 1.0 });
    expect(s.litPercent).toBeCloseTo(1.0 * (1 - 0.5 * 0.8));
  });

  it('hover: steady bright, no pulse, pierces dimming', () => {
    const s = resolveVisualState({ status: 'paused', hovered: true, dimmed: true });
    expect(s.emissiveBase).toBeCloseTo(0.6);
    expect(s.pulseAmplitude).toBe(0);
    expect(s.opacity).toBe(1);
    expect(s.dimFactor).toBe(1);
    expect(s.foundationBright).toBe(true);
    expect(s.labelTier).toBe('always');
  });

  it('selected: scale + edge emphasis + always-label', () => {
    const s = resolveVisualState({ status: 'active', selected: true });
    expect(s.scale).toBeCloseTo(1.04);
    expect(s.edgeGlowOpacity).toBeGreaterThanOrEqual(0.9);
    expect(s.labelTier).toBe('always');
  });

  it('selected beats hovered for scale, hover cannot dim a selection', () => {
    const s = resolveVisualState({ status: 'active', selected: true, hovered: true });
    expect(s.scale).toBeCloseTo(1.04);
    expect(s.opacity).toBe(1);
  });

  it('dimmed: reduced opacity/emissive, suppressed pulse, hidden label', () => {
    const s = resolveVisualState({ status: 'blocked', dimmed: true });
    expect(s.opacity).toBeCloseTo(0.35);
    expect(s.dimFactor).toBeCloseTo(0.35);
    expect(s.pulseAmplitude).toBe(0);
    expect(s.edgeGlowPulse).toBe(false);
    expect(s.labelTier).toBe('hidden');
    // Warnings pierce dimming: glitch channel survives
    expect(s.glitch).toBeCloseTo(0.5);
  });

  it('connected restores visibility inside a focus pass', () => {
    const s = resolveVisualState({ status: 'active', dimmed: true, connected: true });
    expect(s.opacity).toBe(1);
    expect(s.labelTier).toBe('always');
  });

  it('move mode: max bright, no pulse, unit scale', () => {
    const s = resolveVisualState({ status: 'active', selected: true, moveMode: true });
    expect(s.emissiveBase).toBe(1.0);
    expect(s.pulseAmplitude).toBe(0);
    expect(s.scale).toBe(1);
  });

  it('bloom boosts edge glow within clamp', () => {
    const dim = resolveVisualState({ status: 'active', bloom: false });
    const bloom = resolveVisualState({ status: 'active', bloom: true });
    expect(bloom.edgeGlowOpacity).toBeGreaterThan(dim.edgeGlowOpacity);
    expect(bloom.edgeGlowOpacity).toBeLessThanOrEqual(1);
  });
});
