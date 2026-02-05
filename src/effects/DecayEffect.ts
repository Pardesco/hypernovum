/**
 * Decay effect manager.
 * MVP: applies desaturation via material color adjustment.
 * v0.2: will switch to shader-based decay with screen-door dithering.
 */
export class DecayEffect {
  /**
   * Calculate decay factor from last modified timestamp.
   * Returns 0.0 (fresh) to 0.9 (very stale).
   */
  calculateDecay(lastModified: number): number {
    const daysSince = (Date.now() - lastModified) / (1000 * 60 * 60 * 24);
    if (daysSince < 7) return 0.0;
    if (daysSince < 30) return 0.3;
    if (daysSince < 60) return 0.6;
    return 0.9;
  }
}
