/**
 * Minimum on-screen size for small markers (VIS-001). Pure, so it is tested.
 *
 * Quest gems (radius 0.35) and agent orbs (0.26) sit on buildings 2–4 units
 * wide; from the overview camera ~110+ units away they rendered at a few
 * pixels, so quests and agents didn't read at all until zoomed in. Each frame
 * a marker is scaled up just enough to stay at least MIN_MARKER_PX across,
 * capped so a far-away marker doesn't balloon over its building.
 */

/** Minimum marker diameter in CSS pixels. */
export const MIN_MARKER_PX = 12;
/** Largest scale-up a marker gets. */
export const MAX_MARKER_SCALE = 6;

/**
 * Scale for a marker of `worldRadius` (already including any parent scale) at
 * `distance` from a perspective camera with vertical `fovDeg`, in a viewport
 * `viewportHeightPx` tall. 1 when it is already big enough.
 */
export function markerScale(
  worldRadius: number,
  distance: number,
  fovDeg: number,
  viewportHeightPx: number,
  minPx = MIN_MARKER_PX,
  maxScale = MAX_MARKER_SCALE,
): number {
  if (!(worldRadius > 0) || !(viewportHeightPx > 0) || !(distance > 0)) return 1;
  const pxPerUnit = viewportHeightPx / (2 * Math.tan((fovDeg * Math.PI) / 360) * distance);
  const diameterPx = 2 * worldRadius * pxPerUnit;
  return Math.min(maxScale, Math.max(1, minPx / diameterPx));
}
