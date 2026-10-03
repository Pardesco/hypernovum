/**
 * Tight directional-shadow frustum for the city (GFX-007). Pure numbers so it
 * is testable without three.js.
 *
 * Fitting the orthographic shadow camera to the city's bounding sphere (instead
 * of a fixed ±150 box) concentrates the shadow map's texels on what is actually
 * there, so the same map size gives sharper shadows. A sphere fit is
 * direction-independent: it covers the box whichever way the light points.
 */

export interface CityBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Tallest point that casts or receives a shadow. */
  maxY: number;
}

export interface ShadowFrustum {
  center: { x: number; y: number; z: number };
  /** Half-extent of the square orthographic frustum. */
  halfSize: number;
  /** Light distance from the center along its direction. */
  distance: number;
  near: number;
  far: number;
}

/** Margin (world units) for roof details, beacons and hosts that lift districts. */
const MARGIN = 8;

export function fitShadowFrustum(box: CityBox): ShadowFrustum {
  const halfX = (box.maxX - box.minX) / 2 + MARGIN;
  const halfZ = (box.maxZ - box.minZ) / 2 + MARGIN;
  const height = Math.max(box.maxY, 0) + MARGIN;
  const halfY = height / 2;
  const radius = Math.max(Math.hypot(halfX, halfY, halfZ), 20);
  const distance = radius * 2;
  return {
    center: { x: (box.minX + box.maxX) / 2, y: halfY, z: (box.minZ + box.maxZ) / 2 },
    halfSize: radius,
    distance,
    near: Math.max(0.5, distance - radius),
    far: distance + radius,
  };
}
