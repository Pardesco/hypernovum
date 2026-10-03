/**
 * Pure camera-framing helpers (CAM-001). No three.js, so the policy and the
 * overview math are unit-testable.
 */

/** Overview frame for a set of building footprints. */
export interface CityFrame {
  centerX: number;
  centerZ: number;
  /** Largest padded extent — drives camera distance. */
  maxSize: number;
  /** Camera distance along the default view direction. */
  distance: number;
  /** Default camera position for this frame. */
  position: { x: number; y: number; z: number };
  /** Pan-clamp radius around the center. */
  radius: number;
}

/**
 * Default overview for the given building positions, or null when there are
 * none. Same constants the camera used since 0.1: a fixed 0.6 / 0.7 elevation
 * ratio, +30 units of breathing room, and a 50-unit floor so a tiny city isn't
 * framed nose-to-glass.
 */
export function computeCityFrame(points: readonly { x: number; z: number }[]): CityFrame | null {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  if (minX === Infinity) return null;

  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const maxSize = Math.max(maxX - minX + 30, maxZ - minZ + 30, 50);
  const distance = maxSize * 1.1;
  return {
    centerX,
    centerZ,
    maxSize,
    distance,
    position: { x: centerX, y: distance * 0.6, z: centerZ + distance * 0.7 },
    radius: maxSize * 0.75,
  };
}

/**
 * Whether a rebuild should re-frame the camera (CAM-001).
 *
 * Rebuilds run on every project-note save, so re-framing each time threw the
 * user's zoom away mid-task. Frame only on the view's first non-empty build,
 * when the city goes from empty to non-empty, or when the host asks for it.
 */
export function shouldFrameOnBuild(input: {
  hasFramed: boolean;
  previousCount: number;
  count: number;
  refit?: boolean;
}): boolean {
  if (input.count === 0) return false;
  if (!input.hasFramed) return true;
  if (input.previousCount === 0) return true;
  return input.refit === true;
}
