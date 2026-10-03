import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { frameBoxInRect, freeRectAvoiding, projectToCanvas } from '../src/scene/viewFraming';

// Default overview direction (camera at 0.6 / 0.7 of the distance up / back).
const VIEW_DIR = new THREE.Vector3(0, 0.6, 0.7).normalize();
const CANVAS = { width: 1864, height: 990 };

describe('freeRectAvoiding (HUD-001)', () => {
  it('cuts the 0.6.0 HUD (inspector right, command panel top-centre, agents top-left)', () => {
    const free = freeRectAvoiding(CANVAS, [
      { x: 1528, y: 56, width: 320, height: 845 },   // inspector
      { x: 742, y: 48, width: 380, height: 262 },    // command panel
      { x: 16, y: 6, width: 220, height: 270 },      // agents panel
    ])!;
    expect(free).toEqual({ x: 0, y: 310, width: 1528, height: 680 });
  });

  it('ignores obstacles outside the remaining area and works with none', () => {
    expect(freeRectAvoiding(CANVAS, [])).toEqual({ x: 0, y: 0, ...CANVAS });
    const free = freeRectAvoiding(CANVAS, [
      { x: 742, y: 48, width: 380, height: 40 },     // collapsed command panel
      { x: 16, y: 6, width: 220, height: 30 },       // collapsed agents panel
    ])!;
    expect(free.y).toBe(88);
    expect(free.height).toBe(CANVAS.height - 88);
  });

  it('gives up (null) when panels leave too little to frame into', () => {
    expect(freeRectAvoiding({ width: 400, height: 600 }, [{ x: 0, y: 0, width: 300, height: 600 }])).toBeNull();
  });
});

describe('frameBoxInRect (HUD-001)', () => {
  const box = { minX: -70, maxX: 70, minZ: -40, maxZ: 40, maxY: 18 };
  const fov = 50;
  const aspect = CANVAS.width / CANVAS.height;

  function cameraFor(res: ReturnType<typeof frameBoxInRect>) {
    const cam = new THREE.PerspectiveCamera(fov, aspect, 0.1, 5000);
    cam.position.copy(res.position);
    cam.lookAt(res.target);
    cam.updateMatrixWorld();
    return cam;
  }

  it('puts every corner of the city inside the free rect', () => {
    const rect = { x: 0, y: 310, width: 1528, height: 680 };
    const res = frameBoxInRect({ box, fov, aspect, viewDir: VIEW_DIR, canvas: CANVAS, rect });
    const cam = cameraFor(res);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [box.minX, box.maxX]) for (const z of [box.minZ, box.maxZ]) for (const y of [0, box.maxY]) {
      const p = projectToCanvas(new THREE.Vector3(x, y, z), cam, CANVAS);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const tol = 2;
    expect(minX).toBeGreaterThanOrEqual(rect.x - tol);
    expect(maxX).toBeLessThanOrEqual(rect.x + rect.width + tol);
    expect(minY).toBeGreaterThanOrEqual(rect.y - tol);
    expect(maxY).toBeLessThanOrEqual(rect.y + rect.height + tol);
    // ...and actually uses it: the limiting dimension is ~filled (margin 8%).
    const fill = Math.max((maxX - minX) / rect.width, (maxY - minY) / rect.height);
    expect(fill).toBeGreaterThan(0.85);
  });

  it('keeps the fixed view direction', () => {
    const res = frameBoxInRect({ box, fov, aspect, viewDir: VIEW_DIR, canvas: CANVAS, rect: { x: 0, y: 0, ...CANVAS } });
    const dir = res.position.clone().sub(res.target).normalize();
    expect(dir.distanceTo(VIEW_DIR)).toBeLessThan(1e-6);
    expect(res.target.y).toBe(0);
  });

  it('respects distance limits', () => {
    const res = frameBoxInRect({ box, fov, aspect, viewDir: VIEW_DIR, canvas: CANVAS, rect: { x: 0, y: 0, ...CANVAS }, maxDistance: 60 });
    expect(res.distance).toBeLessThanOrEqual(60);
  });
});
