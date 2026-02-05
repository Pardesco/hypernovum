/**
 * Glow manager for highlighting recently active projects.
 * MVP: uses emissive material property.
 * v0.2: will switch to shader-based glow via uniform.
 */
export class GlowManager {
  /** Returns whether a project should glow based on recent activity */
  shouldGlow(lastModified: number): boolean {
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    return Date.now() - lastModified < sevenDaysMs;
  }
}
