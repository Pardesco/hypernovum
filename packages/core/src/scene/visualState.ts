import { statusColor } from '../types';

/**
 * Pure visual-state resolver — the single place where simultaneous building
 * states (status, lens, weather, hover, selection, dimming, move mode)
 * compose into concrete material values. HighlightManager applies the result;
 * SceneManager.animate() only modulates emissive around `emissiveBase` and
 * glitch around `glitch` — it never chooses colors or baselines.
 *
 * Precedence (§8 of the implementation plan), later application wins:
 *   status (12) → lens (10, owns baseColor) → weather (11) →
 *   dimmed (9) → connected (7) → hovered (3) → selected (2) → move mode (1)
 * Warning channels (glitch/decay) intentionally pierce dimming.
 */

export interface WeatherLite {
  hasMergeConflicts: boolean;
  churnScore: number;
  staleBranchCount: number;
}

export interface ResolveInput {
  status: string;
  /** Lens color owns baseColor when present (git/tasks/recency/stack/attention) */
  lensColor?: number | null;
  weather?: WeatherLite | null;
  /** Time-based decay 0–1 (from last commit or note mtime) */
  decayFactor?: number;
  /** Task-completion ratio driving shader window fill */
  litPercent?: number;
  hovered?: boolean;
  selected?: boolean;
  /** Shares a visible edge with the selection */
  connected?: boolean;
  /** Focus/trace active and this building is unrelated */
  dimmed?: boolean;
  moveMode?: boolean;
  bloom?: boolean;
}

export type LabelTier = 'always' | 'normal' | 'hidden';

export interface VisualState {
  baseColor: number;
  emissiveColor: number;
  /** Baseline emissive intensity; animate() adds sin(t·speed)·amplitude */
  emissiveBase: number;
  pulseSpeed: number;
  pulseAmplitude: number;
  opacity: number;
  scale: number;
  edgeGlowOpacity: number;
  /** Multiplier applied to baseColor for the edge-glow line color */
  edgeGlowColorScale: number;
  /** Blocked buildings keep their animated edge-glow pulse (suppressed while dimmed) */
  edgeGlowPulse: boolean;
  /** Shader uGlitch baseline; animate() adds sin(t·glitchSpeed)·0.3 when > 0 */
  glitch: number;
  glitchSpeed: number;
  /** Shader uDecay */
  decay: number;
  /** Shader uLitPercent (already decay-attenuated) */
  litPercent: number;
  /** Shader uDimFactor — multiplies final fragment color (1 = no dim) */
  dimFactor: number;
  /** Foundation plinth uses its hover-brightened palette */
  foundationBright: boolean;
  labelTier: LabelTier;
}

const STATUS_ANIM: Record<string, { base: number; speed: number; amp: number }> = {
  blocked: { base: 0.25, speed: 4, amp: 0.15 },
  active: { base: 0.12, speed: 1.5, amp: 0.08 },
  complete: { base: 0.05, speed: 2, amp: 0.03 },
  paused: { base: 0.08, speed: 0.8, amp: 0.04 },
};

function lerpHex(a: number, b: number, t: number): number {
  const r = Math.round(((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t);
  const g = Math.round(((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = Math.round((a & 255) + ((b & 255) - (a & 255)) * t);
  return (r << 16) | (g << 8) | bl;
}

export function resolveVisualState(i: ResolveInput): VisualState {
  const status = i.status;
  const bloom = i.bloom ?? false;

  // 12 — status baseline
  const anim = STATUS_ANIM[status] ?? { base: 0.1, speed: 1, amp: 0.05 };
  let baseColor = statusColor(status);
  let emissiveColor = baseColor;
  let emissiveBase = anim.base;
  let pulseSpeed = anim.speed;
  let pulseAmplitude = anim.amp;
  let opacity = 1;
  let scale = 1;
  let dimFactor = 1;
  let glitch = status === 'blocked' ? 0.5 : 0;
  let glitchSpeed = 2;
  let decay = i.decayFactor ?? 0;
  let litPercent = i.litPercent ?? 0.5;
  let labelTier: LabelTier = 'normal';

  const bloomMult = bloom ? 1.5 : 1.0;
  let edgeGlowOpacity =
    status === 'blocked' ? Math.min(0.8 * bloomMult, 1)
      : status === 'active' ? Math.min(0.5 * bloomMult, 1)
        : 0.3;
  let edgeGlowColorScale = status === 'blocked' ? 3.0 : bloom ? 2.5 : 1.8;
  let edgeGlowPulse = status === 'blocked';

  // 10 — lens owns base color
  if (i.lensColor !== null && i.lensColor !== undefined) {
    baseColor = i.lensColor;
    emissiveColor = i.lensColor;
  }

  // 11 — weather (emissive/glitch/decay channels; composes with lens base)
  const w = i.weather;
  if (w) {
    if (w.hasMergeConflicts) {
      emissiveColor = 0xff2222;
      emissiveBase = 0.4;
      pulseSpeed = 6;
      pulseAmplitude = 0.25;
      glitch = 0.7;
      glitchSpeed = 6;
    } else if (w.churnScore > 60) {
      const overheat = (w.churnScore - 60) / 40;
      emissiveColor = lerpHex(emissiveColor, 0xff6600, overheat * 0.4);
      // Shader path renders walls from baseColor — shift it warm too
      baseColor = lerpHex(baseColor, 0xff6600, overheat * 0.3);
      emissiveBase += overheat * 0.15;
      pulseSpeed += overheat * 2;
    }
    if (w.staleBranchCount > 5) {
      emissiveBase *= 0.5;
      pulseAmplitude *= 0.3;
    }
    const staleDecay =
      w.staleBranchCount <= 0 ? 0
        : w.staleBranchCount <= 2 ? 0.3
          : w.staleBranchCount <= 5 ? 0.6 : 0.9;
    decay = Math.max(decay, staleDecay);
  }
  if (decay > 0.3) {
    litPercent = litPercent * (1.0 - decay * 0.8);
  }

  // 9 — dimmed (glitch/decay intentionally NOT scaled: warnings pierce dimming)
  if (i.dimmed) {
    opacity = 0.35;
    dimFactor = 0.35;
    emissiveBase *= 0.3;
    pulseAmplitude = 0;
    edgeGlowOpacity *= 0.3;
    edgeGlowPulse = false;
    labelTier = 'hidden';
  }

  // 7 — connected to the selection
  if (i.connected) {
    opacity = 1;
    dimFactor = 1;
    emissiveBase = Math.max(emissiveBase, anim.base + 0.05);
    edgeGlowPulse = status === 'blocked';
    labelTier = 'always';
  }

  // 3 — hovered (steady bright, no pulse — matches legacy hover)
  if (i.hovered) {
    emissiveBase = 0.6;
    pulseAmplitude = 0;
    opacity = 1;
    dimFactor = 1;
    labelTier = 'always';
  }

  // 2 — selected
  if (i.selected) {
    emissiveBase = Math.max(emissiveBase, 0.45);
    opacity = 1;
    dimFactor = 1;
    scale = 1.04;
    edgeGlowOpacity = Math.max(edgeGlowOpacity, 0.9);
    edgeGlowColorScale = Math.max(edgeGlowColorScale, 3.0);
    labelTier = 'always';
  }

  // 1 — move mode
  if (i.moveMode) {
    emissiveBase = 1.0;
    pulseAmplitude = 0;
    opacity = 1;
    dimFactor = 1;
    scale = 1;
    labelTier = 'always';
  }

  return {
    baseColor,
    emissiveColor,
    emissiveBase,
    pulseSpeed,
    pulseAmplitude,
    opacity,
    scale,
    edgeGlowOpacity: Math.min(edgeGlowOpacity, 1),
    edgeGlowColorScale,
    edgeGlowPulse,
    glitch,
    glitchSpeed,
    decay,
    litPercent,
    dimFactor,
    foundationBright: !!i.hovered,
    labelTier,
  };
}
