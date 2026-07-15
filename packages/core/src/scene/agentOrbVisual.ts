/**
 * Pure agent-orb visual mapping (AGT-005).
 *
 * Maps a §10 agent state to how its orb should look and animate. Kept pure so
 * the state→visual table can be unit-tested; SceneManager applies the result
 * to the orb material and animate() modulates around the published baselines.
 */

/** Concrete orb colors; 'hue' means "use the agent's stable per-id hue". */
export const ORB_COLORS = {
  waiting: 0xffbb44,   // amber
  blocked: 0xff4444,   // red (also failed)
  complete: 0x4ade80,  // green
  stale: 0x8a8a8a,     // grey
} as const;

export interface OrbVisual {
  /** Concrete hex, or 'hue' to use the agent's stable id-hashed hue. */
  color: number | 'hue';
  emissiveBase: number;    // baseline emissiveIntensity
  pulseSpeed: number;      // 0 = no pulse
  pulseAmplitude: number;  // absolute emissive units added by sin()
  opacity: number;         // <1 → transparent orb
  orbit: boolean;          // true = orbit the building; false = park at top
  fadeOut: boolean;        // complete → fade to invisible over ~60s
}

/**
 * Resolve the orb visual for a state. Unknown states fall back to the working
 * treatment so a live-but-unlabeled agent still reads as active.
 */
export function orbVisualForState(state: string): OrbVisual {
  if (state === 'waiting') {
    // Amber, orbit paused, slow strong pulse — "may be waiting on you".
    return { color: ORB_COLORS.waiting, emissiveBase: 1.6, pulseSpeed: 1.2, pulseAmplitude: 0.6, opacity: 1, orbit: false, fadeOut: false };
  }
  if (state === 'blocked' || state === 'failed') {
    // Red, fast pulse — demands attention.
    return { color: ORB_COLORS.blocked, emissiveBase: 2.0, pulseSpeed: 5, pulseAmplitude: 0.5, opacity: 1, orbit: true, fadeOut: false };
  }
  if (state === 'complete') {
    // Green, static, fades out over ~60s (row persists in the inspector).
    return { color: ORB_COLORS.complete, emissiveBase: 1.5, pulseSpeed: 0, pulseAmplitude: 0, opacity: 1, orbit: false, fadeOut: true };
  }
  if (state === 'stale' || state === 'disconnected') {
    // Grey, dim, no orbit.
    return { color: ORB_COLORS.stale, emissiveBase: 0.35, pulseSpeed: 0, pulseAmplitude: 0, opacity: 0.4, orbit: false, fadeOut: false };
  }
  // Working states (and unknown) — agent hue, steady orbit, gentle pulse.
  return { color: 'hue', emissiveBase: 1.8, pulseSpeed: 2, pulseAmplitude: 0.15, opacity: 1, orbit: true, fadeOut: false };
}

/** True when a state should tint its host building's interior (editing glow). */
export function stateTintsHost(state: string): boolean {
  return state === 'editing';
}
