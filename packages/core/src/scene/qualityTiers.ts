/**
 * Graphics quality tiers (GFX-009). Pure: no three.js, no DOM, so the tier
 * table, the Auto pick and the adaptive-resolution policy are unit-tested.
 */

export type QualityTier = 'low' | 'balanced' | 'high' | 'ultra';
/** The user-facing setting: a fixed tier, or Auto (probe on first open). */
export type QualitySetting = 'auto' | QualityTier;

export interface TierConfig {
  /** Upper bound on the renderer pixel ratio (device pixel ratio is clamped to it). */
  pixelRatioCap: number;
  /** MSAA samples for the composer's scene target (GFX-001). 0 = none. */
  msaaSamples: number;
  /** Bloom pass: off, at half resolution, or full. */
  bloom: 'off' | 'half' | 'full';
  /** Shadow map: off, or rendered on demand (GFX-007). */
  shadows: 'off' | 'static';
  shadowMapSize: number;
  /** Wide antialiased lines (GFX-004). */
  wideLines: boolean;
  /** Analytic facade reflections (GFX-005). */
  reflections: boolean;
}

export const TIER_CONFIG: Record<QualityTier, TierConfig> = {
  // Genuinely light: native-ish resolution, no post chain, no shadow map, 1 px
  // lines, no reflections. For integrated GPUs, battery and very large vaults.
  low: { pixelRatioCap: 1, msaaSamples: 0, bloom: 'off', shadows: 'off', shadowMapSize: 1024, wideLines: false, reflections: false },
  balanced: { pixelRatioCap: 1.25, msaaSamples: 2, bloom: 'half', shadows: 'static', shadowMapSize: 2048, wideLines: true, reflections: true },
  high: { pixelRatioCap: 1.5, msaaSamples: 4, bloom: 'full', shadows: 'static', shadowMapSize: 2048, wideLines: true, reflections: true },
  ultra: { pixelRatioCap: 2, msaaSamples: 4, bloom: 'full', shadows: 'static', shadowMapSize: 4096, wideLines: true, reflections: true },
};

export const QUALITY_TIERS: readonly QualityTier[] = ['low', 'balanced', 'high', 'ultra'];

export function isQualitySetting(value: unknown): value is QualitySetting {
  return value === 'auto' || QUALITY_TIERS.includes(value as QualityTier);
}

/** Tier Auto starts on before its probe finishes. */
export const AUTO_START_TIER: QualityTier = 'high';
/** How long Auto samples frames on first open (ms), and the minimum sample count. */
export const AUTO_PROBE_MS = 2000;
export const AUTO_PROBE_MIN_SAMPLES = 30;

/**
 * Tier for a measured median frame interval at the High tier. Auto never picks
 * Ultra (that is an explicit choice: 4096 shadows, full device pixel ratio).
 * The interval is vsync-bound, so anything at or near display rate stays High.
 */
export function pickAutoTier(medianFrameMs: number): QualityTier {
  if (!Number.isFinite(medianFrameMs) || medianFrameMs <= 0) return AUTO_START_TIER;
  if (medianFrameMs <= 22) return 'high';
  if (medianFrameMs <= 40) return 'balanced';
  return 'low';
}

/** Renderer pixel ratio for a device pixel ratio, a tier cap and an adaptive scale. */
export function effectivePixelRatio(devicePixelRatio: number, cap: number, adaptiveScale = 1): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.max(0.5, Math.min(dpr, cap) * adaptiveScale);
}

/**
 * Adaptive resolution (GFX-009): drop the pixel ratio while the camera moves
 * on frames slower than ~20 ms, restore it once the camera has been still for
 * a moment. Two levels only, so the render targets are reallocated at most
 * twice per camera gesture, never per frame.
 */
export class AdaptiveResolution {
  static readonly SLOW_FRAME_MS = 20;
  static readonly REDUCED_SCALE = 0.75;
  static readonly RESTORE_AFTER_MS = 750;
  /** Consecutive slow moving frames before dropping (filters one-off hitches). */
  static readonly SLOW_FRAMES_TO_DROP = 6;

  private slowStreak = 0;
  scale = 1;

  /**
   * Feed one frame. Returns the new scale when it changed, else null.
   * @param frameMs interval since the previous frame
   * @param msSinceCameraMove time since the camera last moved (0 = moving now)
   */
  update(frameMs: number, msSinceCameraMove: number): number | null {
    const moving = msSinceCameraMove < 100;
    if (moving && frameMs > AdaptiveResolution.SLOW_FRAME_MS) this.slowStreak++;
    else if (moving) this.slowStreak = 0;

    if (this.scale === 1 && moving && this.slowStreak >= AdaptiveResolution.SLOW_FRAMES_TO_DROP) {
      this.scale = AdaptiveResolution.REDUCED_SCALE;
      this.slowStreak = 0;
      return this.scale;
    }
    if (this.scale < 1 && msSinceCameraMove >= AdaptiveResolution.RESTORE_AFTER_MS) {
      this.scale = 1;
      this.slowStreak = 0;
      return this.scale;
    }
    return null;
  }
}
