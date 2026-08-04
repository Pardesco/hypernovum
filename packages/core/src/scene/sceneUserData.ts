import type * as THREE from 'three';
import type { ProjectData } from '../types';

/**
 * Everything Hypernovum stashes on `Object3D.userData`.
 *
 * three.js types `userData` as `any`, so every read of it was an unchecked
 * `any` member access — the single largest source of `no-unsafe-*` warnings in
 * this package, and a real hazard: a typo in a key name was previously
 * `undefined` at runtime with no compile-time complaint. Reads go through
 * {@link ud}; writes go through {@link setUserData}, which type-checks the
 * object literal.
 */
export interface SceneUserData {
  /** The project a building/foundation/marker belongs to. */
  project?: ProjectData;
  /** District category, on district chrome and drag handles. */
  category?: string;

  // Object-kind tags, used by raycasting and scene traversal.
  isBuilding?: boolean;
  isFoundation?: boolean;
  isDistrict?: boolean;
  isDragHandle?: boolean;
  isGround?: boolean;
  isLabel?: boolean;
  isRoad?: boolean;
  isNeuralCore?: boolean;
  isEdgeGlow?: boolean;
  isRoofDetail?: boolean;
  isQuestMarker?: boolean;
  isAgentOrb?: boolean;
  isConflictRing?: boolean;
  isQuestBurst?: boolean;

  /** Hit proxies point back at the mesh they stand in for. */
  visualHandle?: THREE.Object3D;
  visualFoundation?: THREE.Object3D;

  /** Quest-marker bob animation. */
  baseY?: number;
  bobPhase?: number;

  /** Agent orb identity. */
  agentId?: string;
}

/** Read an object's Hypernovum userData with real types. */
export function ud(obj: THREE.Object3D): SceneUserData {
  return obj.userData as SceneUserData;
}

/** The project an object belongs to, if any. */
export function projectOf(obj: THREE.Object3D): ProjectData | undefined {
  return (obj.userData as SceneUserData).project;
}

/** Replace an object's userData, checked against {@link SceneUserData}. */
export function setUserData(obj: THREE.Object3D, data: SceneUserData): void {
  obj.userData = data;
}
