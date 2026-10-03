import * as THREE from 'three';

/**
 * Panel-aware camera framing (HUD-001). Pure functions (three.js math only, no
 * renderer or DOM), so both the free-area pick and the framing solve are
 * unit-tested.
 *
 * The overview used to frame the city into the whole canvas, so the HUD's
 * centre command panel and right inspector covered part of it. The host now
 * reports the unobstructed part of the canvas and the camera frames the city
 * into that instead.
 */

/** Axis-aligned rectangle in canvas CSS pixels, origin at the canvas top-left. */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The largest unobstructed rectangle left after cutting each obstacle away
 * (greedy, biggest obstacle first: each one is removed from whichever side
 * keeps the most area). Returns null when what's left is too small to frame
 * into — a narrow pane — so the caller falls back to the whole canvas.
 */
export function freeRectAvoiding(
  canvas: { width: number; height: number },
  obstacles: readonly ScreenRect[],
  minFraction = 0.35,
): ScreenRect | null {
  let free: ScreenRect = { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const sorted = [...obstacles]
    .filter((o) => o.width > 0 && o.height > 0)
    .sort((a, b) => b.width * b.height - a.width * a.height);

  for (const o of sorted) {
    const ox0 = Math.max(o.x, free.x);
    const oy0 = Math.max(o.y, free.y);
    const ox1 = Math.min(o.x + o.width, free.x + free.width);
    const oy1 = Math.min(o.y + o.height, free.y + free.height);
    if (ox1 <= ox0 || oy1 <= oy0) continue; // doesn't overlap what's left

    const fx1 = free.x + free.width;
    const fy1 = free.y + free.height;
    const candidates: ScreenRect[] = [
      { x: ox1, y: free.y, width: fx1 - ox1, height: free.height },        // keep right of it
      { x: free.x, y: free.y, width: ox0 - free.x, height: free.height },  // keep left of it
      { x: free.x, y: oy1, width: free.width, height: fy1 - oy1 },         // keep below it
      { x: free.x, y: free.y, width: free.width, height: oy0 - free.y },   // keep above it
    ];
    free = candidates.reduce((best, c) => (c.width * c.height > best.width * best.height ? c : best));
  }

  if (free.width < canvas.width * minFraction || free.height < canvas.height * minFraction) return null;
  return free;
}

/** World-space box to frame: footprint plus the tallest point. */
export interface FramingBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxY: number;
}

export interface FramingInput {
  box: FramingBox;
  /** Vertical field of view (degrees) and aspect of the camera. */
  fov: number;
  aspect: number;
  /** Unit vector from the target toward the camera (the fixed view direction). */
  viewDir: THREE.Vector3;
  canvas: { width: number; height: number };
  rect: ScreenRect;
  /** Extra breathing room around the box (1.08 = 8%). */
  margin?: number;
  minDistance?: number;
  maxDistance?: number;
}

export interface FramingResult {
  target: THREE.Vector3;
  position: THREE.Vector3;
  distance: number;
}

/**
 * Camera target and distance (along `viewDir`) that put the box inside `rect`.
 * Alternates a distance step (fit the box's projected extent to the rect) and
 * a target step (move the projected centre onto the rect's centre) until it
 * settles (damped; 30 iterations converge well past pixel precision).
 */
export function frameBoxInRect(input: FramingInput): FramingResult {
  const { box, canvas, rect } = input;
  const margin = input.margin ?? 1.08;
  const minD = input.minDistance ?? 1;
  const maxD = input.maxDistance ?? 5000;
  const viewDir = input.viewDir.clone().normalize();

  const cam = new THREE.PerspectiveCamera(input.fov, input.aspect, 0.1, 10000);
  const corners: THREE.Vector3[] = [];
  for (const x of [box.minX, box.maxX]) for (const z of [box.minZ, box.maxZ]) for (const y of [0, box.maxY]) {
    corners.push(new THREE.Vector3(x, y, z));
  }

  // Free rect in NDC (y up).
  const nx0 = (rect.x / canvas.width) * 2 - 1;
  const nx1 = ((rect.x + rect.width) / canvas.width) * 2 - 1;
  const ny1 = 1 - (rect.y / canvas.height) * 2;
  const ny0 = 1 - ((rect.y + rect.height) / canvas.height) * 2;
  const fx = (nx0 + nx1) / 2;
  const fy = (ny0 + ny1) / 2;

  const target = new THREE.Vector3((box.minX + box.maxX) / 2, 0, (box.minZ + box.maxZ) / 2);
  let distance = Math.max(box.maxX - box.minX, box.maxZ - box.minZ, 10) * 1.2;

  const right = new THREE.Vector3();
  const groundFwd = new THREE.Vector3(-viewDir.x, 0, -viewDir.z);
  if (groundFwd.lengthSq() < 1e-6) groundFwd.set(0, 0, -1);
  groundFwd.normalize();
  const sinElev = Math.max(0.2, viewDir.y);
  const p = new THREE.Vector3();

  for (let iter = 0; iter < 30; iter++) {
    cam.position.copy(target).addScaledVector(viewDir, distance);
    cam.lookAt(target);
    cam.updateMatrixWorld();

    let minPx = Infinity, maxPx = -Infinity, minPy = Infinity, maxPy = -Infinity;
    let behind = false;
    for (const c of corners) {
      p.copy(c).applyMatrix4(cam.matrixWorldInverse);
      if (p.z > -0.1) { behind = true; break; }
      p.applyMatrix4(cam.projectionMatrix);
      minPx = Math.min(minPx, p.x); maxPx = Math.max(maxPx, p.x);
      minPy = Math.min(minPy, p.y); maxPy = Math.max(maxPy, p.y);
    }
    if (behind) { distance = Math.min(maxD, distance * 1.5); continue; }

    // Both steps use this one measurement (taken at the current distance).
    // Target: slide along the ground so the projected centre lands on the rect's.
    const halfH = distance * Math.tan(THREE.MathUtils.degToRad(input.fov) / 2);
    const halfW = halfH * input.aspect;
    right.setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize();
    const cx = (minPx + maxPx) / 2;
    const cy = (minPy + maxPy) / 2;
    // Damped: the shift and the distance change compound, and undamped steps
    // oscillate and diverge on wide cities.
    target.addScaledVector(right, 0.6 * (cx - fx) * halfW);
    target.addScaledVector(groundFwd, (0.6 * (cy - fy) * halfH) / sinElev);

    // Distance: projected extent scales ~1/distance.
    const scale = Math.max((maxPx - minPx) / (nx1 - nx0), (maxPy - minPy) / (ny1 - ny0)) * margin;
    distance = Math.min(maxD, Math.max(minD, distance * Math.pow(scale, 0.7)));
  }

  return {
    target,
    position: target.clone().addScaledVector(viewDir, distance),
    distance,
  };
}

/** NDC → canvas-pixel projection of a world point (for QA and tests). */
export function projectToCanvas(
  point: THREE.Vector3,
  camera: THREE.Camera,
  canvas: { width: number; height: number },
): { x: number; y: number } {
  const v = point.clone().project(camera);
  return { x: ((v.x + 1) / 2) * canvas.width, y: ((1 - v.y) / 2) * canvas.height };
}
