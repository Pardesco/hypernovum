import { describe, it, expect } from 'vitest';
import {
  TIER_CONFIG,
  QUALITY_TIERS,
  AdaptiveResolution,
  effectivePixelRatio,
  isQualitySetting,
  pickAutoTier,
} from '../src/scene/qualityTiers';

describe('TIER_CONFIG (GFX-009)', () => {
  it('Low is genuinely light', () => {
    expect(TIER_CONFIG.low).toEqual({
      pixelRatioCap: 1, msaaSamples: 0, bloom: 'off', shadows: 'off', shadowMapSize: 1024,
      wideLines: false, reflections: false,
    });
  });

  it('matches the plan table for the other tiers', () => {
    expect(TIER_CONFIG.balanced).toMatchObject({ pixelRatioCap: 1.25, msaaSamples: 2, bloom: 'half', shadows: 'static', wideLines: true, reflections: true });
    expect(TIER_CONFIG.high).toMatchObject({ pixelRatioCap: 1.5, msaaSamples: 4, bloom: 'full', shadows: 'static', shadowMapSize: 2048 });
    expect(TIER_CONFIG.ultra).toMatchObject({ pixelRatioCap: 2, msaaSamples: 4, bloom: 'full', shadowMapSize: 4096 });
  });

  it('gets strictly heavier tier by tier', () => {
    for (let i = 1; i < QUALITY_TIERS.length; i++) {
      const lo = TIER_CONFIG[QUALITY_TIERS[i - 1]], hi = TIER_CONFIG[QUALITY_TIERS[i]];
      expect(hi.pixelRatioCap).toBeGreaterThanOrEqual(lo.pixelRatioCap);
      expect(hi.msaaSamples).toBeGreaterThanOrEqual(lo.msaaSamples);
      expect(hi.shadowMapSize).toBeGreaterThanOrEqual(lo.shadowMapSize);
    }
  });

  it('validates persisted settings', () => {
    expect(isQualitySetting('auto')).toBe(true);
    expect(isQualitySetting('ultra')).toBe(true);
    expect(isQualitySetting('extreme')).toBe(false);
    expect(isQualitySetting(undefined)).toBe(false);
  });
});

describe('pickAutoTier', () => {
  it('keeps High at display rate (vsync-bound intervals)', () => {
    expect(pickAutoTier(5.6)).toBe('high');   // 180 Hz
    expect(pickAutoTier(16.7)).toBe('high');  // 60 Hz
    expect(pickAutoTier(22)).toBe('high');
  });

  it('steps down for slow machines and never picks Ultra', () => {
    expect(pickAutoTier(25)).toBe('balanced');
    expect(pickAutoTier(40)).toBe('balanced');
    expect(pickAutoTier(55)).toBe('low');
    expect(pickAutoTier(1)).not.toBe('ultra');
  });

  it('falls back to the start tier on no data', () => {
    expect(pickAutoTier(0)).toBe('high');
    expect(pickAutoTier(Number.NaN)).toBe('high');
  });
});

describe('effectivePixelRatio', () => {
  it('clamps the device ratio to the tier cap, then scales', () => {
    expect(effectivePixelRatio(2, 1.5)).toBe(1.5);
    expect(effectivePixelRatio(1, 1.5)).toBe(1);
    expect(effectivePixelRatio(2, 2, 0.75)).toBe(1.5);
    expect(effectivePixelRatio(1, 1, 0.75)).toBe(0.75);
  });

  it('survives junk device ratios and never drops below 0.5', () => {
    expect(effectivePixelRatio(Number.NaN, 2)).toBe(1);
    expect(effectivePixelRatio(1, 1, 0.1)).toBe(0.5);
  });
});

describe('AdaptiveResolution', () => {
  it('drops only after sustained slow frames while the camera moves', () => {
    const a = new AdaptiveResolution();
    for (let i = 0; i < 5; i++) expect(a.update(30, 0)).toBeNull();
    expect(a.update(30, 0)).toBe(0.75);
    expect(a.scale).toBe(0.75);
  });

  it('ignores slow frames while the camera is still, and fast frames while moving', () => {
    const a = new AdaptiveResolution();
    for (let i = 0; i < 20; i++) expect(a.update(40, 5000)).toBeNull();
    for (let i = 0; i < 20; i++) expect(a.update(8, 0)).toBeNull();
    expect(a.scale).toBe(1);
  });

  it('a fast frame mid-gesture resets the streak', () => {
    const a = new AdaptiveResolution();
    for (let i = 0; i < 5; i++) a.update(30, 0);
    a.update(10, 0);
    for (let i = 0; i < 5; i++) expect(a.update(30, 0)).toBeNull();
  });

  it('restores full resolution once the camera has been still for 750 ms', () => {
    const a = new AdaptiveResolution();
    for (let i = 0; i < 6; i++) a.update(30, 0);
    expect(a.update(16, 500)).toBeNull();
    expect(a.update(16, 750)).toBe(1);
    expect(a.update(16, 2000)).toBeNull(); // no churn once restored
  });
});
