import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { isSceneVisible } from '../src/interactions/visibility';

describe('isSceneVisible (PERF-002 raycast filter)', () => {
  it('true for a visible object with no parents', () => {
    const o = new THREE.Object3D();
    expect(isSceneVisible(o)).toBe(true);
  });

  it('false when the object itself is hidden', () => {
    const o = new THREE.Object3D();
    o.visible = false;
    expect(isSceneVisible(o)).toBe(false);
  });

  it('false when any ANCESTOR is hidden (the orb-of-a-hidden-building case)', () => {
    const building = new THREE.Object3D();
    const orb = new THREE.Object3D(); // orb is visible itself…
    building.add(orb);
    building.visible = false;          // …but its parent building is hidden
    expect(isSceneVisible(orb)).toBe(false);
  });

  it('true when the whole ancestry is visible', () => {
    const root = new THREE.Object3D();
    const mid = new THREE.Object3D();
    const leaf = new THREE.Object3D();
    root.add(mid); mid.add(leaf);
    expect(isSceneVisible(leaf)).toBe(true);
  });

  it('false for null/undefined', () => {
    expect(isSceneVisible(null)).toBe(true); // no object → not "hidden" (loop skips)
    expect(isSceneVisible(undefined)).toBe(true);
  });
});
