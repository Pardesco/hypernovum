import type * as THREE from 'three';

/**
 * Effective scene visibility (PERF-002 correctness fix).
 *
 * three.js's Raycaster does NOT skip objects with `visible === false` (it only
 * checks `layers`). So after we hide a filtered-out building via `.visible`, its
 * mesh (and any children — e.g. agent orbs) still register raycast hits. Every
 * pick site must therefore filter hits through this: an object is pickable only
 * if it and all its ancestors are visible.
 */
export function isSceneVisible(obj: THREE.Object3D | null | undefined): boolean {
  let o: THREE.Object3D | null | undefined = obj;
  while (o) {
    if (o.visible === false) return false;
    o = o.parent;
  }
  return true;
}
