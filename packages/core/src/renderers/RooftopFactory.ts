import * as THREE from 'three';
import { mergeBufferGeometries } from 'three-stdlib';
import type { ProjectData } from '../types';

export interface RooftopKit {
  /** Merged greeble geometry (masts, HVAC blocks) in building-local coordinates, or null if the roof stays clean */
  detail: THREE.BufferGeometry | null;
  /** Local position for a warning beacon (critical priority only), or null */
  beaconPosition: THREE.Vector3 | null;
}

/** Categories whose silhouettes end in a point — no flat roof to build on */
const POINTED_CATEGORIES = new Set(['visualization', 'trading']);

/**
 * Procedural rooftop detail kit. Adds the small-scale "someone lives here"
 * layer that sells the city at a glance: antenna masts, HVAC blocks, and a
 * red aircraft-warning beacon on critical-priority towers.
 *
 * All geometry is deterministic per project path, sized conservatively so it
 * always sits inside the roof footprint regardless of silhouette.
 */
export class RooftopFactory {
  private static seededRandom(seed: string): () => number {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    let state = hash || 1;
    return () => {
      // Mulberry32 — cheap deterministic PRNG stream
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * @param roofAnchor Where the roof actually is, in the building's local space.
   *   `x`/`z`: the centerline — leaning parametric presets move it by up to
   *   0.12·H, several times the safe radius, so without this the whole kit
   *   floats in mid-air beside the tower. `y`: the deck, when it is not simply
   *   the top of the bounding box — a parapet's lip is the highest point, but
   *   props sit on the recessed deck below it.
   */
  static createRooftop(
    project: ProjectData,
    buildingGeo: THREE.BufferGeometry,
    roofAnchor: { x: number; z: number; y?: number } = { x: 0, z: 0 },
  ): RooftopKit {
    const { width, height, depth } = project.dimensions!;
    const pointed = POINTED_CATEGORIES.has(project.category);

    buildingGeo.computeBoundingBox();
    const topY = roofAnchor.y ?? buildingGeo.boundingBox!.max.y;
    const cx = roofAnchor.x, cz = roofAnchor.z;

    // Critical projects get a warning beacon even on pointed roofs
    const wantsBeacon = project.priority === 'critical';

    // Tiny sheds stay clean — greebles read as clutter below this scale
    if (pointed || height < 3) {
      return {
        detail: null,
        beaconPosition: wantsBeacon ? new THREE.Vector3(cx, topY + 0.3, cz) : null,
      };
    }

    const rand = this.seededRandom(project.path || 'default');
    // Conservative safe radius: inside every silhouette's roof, including the
    // helix tower's rotated top face and the 5-tier ziggurat's narrow crown
    const safeR = Math.min(width, depth) * 0.18;
    const geometries: THREE.BufferGeometry[] = [];

    // Antenna mast — every flat roof gets one; height scales with the tower
    const mastH = Math.min(1.2 + rand() * 1.8, height * 0.35);
    const mastAngle = rand() * Math.PI * 2;
    const mastR = rand() * safeR * 0.7;
    const mastX = cx + Math.cos(mastAngle) * mastR;
    const mastZ = cz + Math.sin(mastAngle) * mastR;
    const mast = new THREE.CylinderGeometry(0.05, 0.08, mastH, 5);
    mast.translate(mastX, topY + mastH / 2, mastZ);
    geometries.push(mast);
    // Crossbar near the tip
    const bar = new THREE.BoxGeometry(0.5, 0.05, 0.05);
    bar.rotateY(rand() * Math.PI);
    bar.translate(mastX, topY + mastH * 0.8, mastZ);
    geometries.push(bar);

    // 2-3 HVAC blocks scattered inside the safe footprint
    const blockCount = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < blockCount; i++) {
      const bw = 0.35 + rand() * 0.45;
      const bh = 0.2 + rand() * 0.35;
      const bd = 0.35 + rand() * 0.45;
      const angle = rand() * Math.PI * 2;
      const dist = rand() * safeR;
      const block = new THREE.BoxGeometry(bw, bh, bd);
      block.rotateY(rand() > 0.5 ? Math.PI / 4 : 0);
      block.translate(cx + Math.cos(angle) * dist, topY + bh / 2, cz + Math.sin(angle) * dist);
      geometries.push(block);
    }

    const merged = mergeBufferGeometries(geometries);
    return {
      detail: merged,
      beaconPosition: wantsBeacon
        ? new THREE.Vector3(mastX, topY + mastH + 0.15, mastZ)
        : null,
    };
  }
}
