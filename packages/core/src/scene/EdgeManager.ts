import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { EdgeType, GraphEdge } from '../types';

/**
 * EdgeManager (EDG-001) — the single renderer for every inter-building arc.
 *
 * Consumes a typed GraphEdge[] and draws additive tubes styled by type
 * (color/thickness), with a cone arrowhead for directed edges. Owns per-type
 * visibility, the hover/selection neighbor index, and the breathe + highlight
 * animation.
 *
 * GFX-010: every edge of one type is merged into ONE tube mesh and ONE arrow
 * mesh, so the arcs cost at most two draw calls per type (eight in all)
 * instead of two per edge. Per-edge breathing phase, base opacity and the
 * hover highlight live in vertex attributes; the shader animates them, so the
 * per-frame update is a single uniform write.
 *
 * The 'core' sentinel endpoint (agent edges, EDG-005) resolves via getCorePos.
 */

interface EdgeStyle {
  color: number;
  radius: number;
  directed: boolean;
}

const EDGE_STYLE: Record<EdgeType, EdgeStyle> = {
  // brand violet — the established backlink look; thickness scales with weight
  backlink: { color: 0xb38cff, radius: 0.055, directed: false },
  // teal, thin, directed dependent → dependency
  'depends-on': { color: 0x2dd4bf, radius: 0.05, directed: true },
  // red-amber, directed blocker → blocked
  'blocked-by': { color: 0xff8844, radius: 0.07, directed: true },
  // cyan activity stream, directed core → building
  'agent-working-on': { color: 0x22d3ee, radius: 0.06, directed: true },
};

const EDGE_TYPES = Object.keys(EDGE_STYLE) as EdgeType[];

/** One edge's slice of its type's merged geometry (for the highlight attribute). */
interface EdgeEntry {
  edge: GraphEdge;
  tubeStart: number;
  tubeCount: number;
  arrowStart: number;
  arrowCount: number;
}

/** The merged meshes for one edge type. */
interface TypeBatch {
  type: EdgeType;
  tubes: THREE.Mesh | null;
  arrows: THREE.Mesh | null;
  entries: EdgeEntry[];
}

const VERTEX_SHADER = `
  attribute float aPhase;
  attribute float aBase;
  attribute float aTouch;
  uniform float uTime;
  uniform float uBoost;
  varying float vAlpha;
  void main() {
    // Same curve the per-edge materials used: breathe around the base opacity,
    // x3 when the edge touches the hovered/selected building.
    float breathe = 0.75 + 0.25 * sin(uTime * 1.5 + aPhase);
    vAlpha = min(min(aBase * breathe * (aTouch > 0.5 ? 3.0 : 1.0), 1.0) * uBoost, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FRAGMENT_SHADER = `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uColor, vAlpha);
  }`;

function edgeMaterial(color: number, boost: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uBoost: { value: boost },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/** Tag every vertex of `geo` with one edge's phase/base/touch values. */
function addEdgeAttributes(geo: THREE.BufferGeometry, phase: number, base: number): void {
  const n = geo.attributes.position.count;
  geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(new Float32Array(n).fill(phase), 1));
  geo.setAttribute('aBase', new THREE.Float32BufferAttribute(new Float32Array(n).fill(base), 1));
  geo.setAttribute('aTouch', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
}

export class EdgeManager {
  private batches = new Map<EdgeType, TypeBatch>();
  private visibleTypes = new Set<EdgeType>(['backlink', 'agent-working-on', 'depends-on', 'blocked-by']);
  /** path → neighbor paths, restricted to currently visible edge types */
  private neighbors = new Map<string, Set<string>>();
  private highlightedPath: string | null = null;
  /** Highlight last written into the aTouch attributes. */
  private appliedHighlight: string | null = null;

  constructor(
    private scene: THREE.Scene,
    private buildingPathMap: Map<string, THREE.Mesh>,
    private getCorePos: () => THREE.Vector3 | null = () => null,
  ) {}

  /** Rebuild all edge geometry from a fresh GraphEdge set. */
  setEdges(edges: GraphEdge[]): void {
    this.clear();

    const tubeGeos = new Map<EdgeType, THREE.BufferGeometry[]>();
    const arrowGeos = new Map<EdgeType, THREE.BufferGeometry[]>();
    const entries = new Map<EdgeType, EdgeEntry[]>();
    const tubeCursor = new Map<EdgeType, number>();
    const arrowCursor = new Map<EdgeType, number>();

    for (const edge of edges) {
      const start = this.endpoint(edge.from);
      const end = this.endpoint(edge.to);
      if (!start || !end) continue;

      const style = EDGE_STYLE[edge.type];
      const dist = start.distanceTo(end);
      const control = start.clone().add(end).multiplyScalar(0.5);
      control.y += Math.max(3, dist * 0.35);
      const curve = new THREE.QuadraticBezierCurve3(start, control, end);

      const weight = edge.weight ?? 1;
      const radius = edge.type === 'backlink'
        ? style.radius + Math.min(weight, 6) * 0.015
        : style.radius;
      const baseOpacity = edge.type === 'backlink'
        ? 0.2 + Math.min(weight, 6) * 0.04
        : 0.3;
      const phase = (start.x + end.z) % (Math.PI * 2);

      const tube = new THREE.TubeGeometry(curve, 24, radius, 5, false);
      addEdgeAttributes(tube, phase, baseOpacity);
      const tubeStart = tubeCursor.get(edge.type) ?? 0;
      const tubeCount = tube.attributes.position.count;
      tubeCursor.set(edge.type, tubeStart + tubeCount);
      if (!tubeGeos.has(edge.type)) tubeGeos.set(edge.type, []);
      tubeGeos.get(edge.type)!.push(tube);

      // Directed edges get a cone arrowhead near the destination.
      let arrowStart = 0, arrowCount = 0;
      if (style.directed) {
        const arrow = this.arrowGeometry(curve, radius);
        addEdgeAttributes(arrow, phase, baseOpacity);
        arrowStart = arrowCursor.get(edge.type) ?? 0;
        arrowCount = arrow.attributes.position.count;
        arrowCursor.set(edge.type, arrowStart + arrowCount);
        if (!arrowGeos.has(edge.type)) arrowGeos.set(edge.type, []);
        arrowGeos.get(edge.type)!.push(arrow);
      }

      if (!entries.has(edge.type)) entries.set(edge.type, []);
      entries.get(edge.type)!.push({ edge, tubeStart, tubeCount, arrowStart, arrowCount });

      this.addNeighbor(edge.from, edge.to);
      this.addNeighbor(edge.to, edge.from); // neighborhood is symmetric for highlight
    }

    for (const type of EDGE_TYPES) {
      const typeEntries = entries.get(type);
      if (!typeEntries) continue;
      const style = EDGE_STYLE[type];
      const tubes = this.mergedMesh(tubeGeos.get(type), style.color, 1);
      // Arrowheads ran at 1.4x their tube's opacity.
      const arrows = this.mergedMesh(arrowGeos.get(type), style.color, 1.4);
      this.batches.set(type, { type, tubes, arrows, entries: typeEntries });
    }

    this.appliedHighlight = null;
    this.applyVisibility();
    this.applyHighlight();
  }

  /** Toggle which edge types render (no geometry rebuild). */
  setVisibleTypes(types: Set<EdgeType>): void {
    this.visibleTypes = new Set(types);
    this.applyVisibility();
    // Neighbor index depends on visible types — recompute from live entries.
    this.rebuildNeighborIndex();
  }

  getVisibleTypes(): Set<EdgeType> {
    return new Set(this.visibleTypes);
  }

  /** Neighbors of a path across currently-visible edges (for highlight/dim sets). */
  neighborsOf(path: string): Set<string> {
    return this.neighbors.get(path) ?? new Set();
  }

  /** Boost the arcs touching `path` (hover/selection neighborhood). */
  highlightForPath(path: string | null): void {
    this.highlightedPath = path;
    this.applyHighlight();
  }

  /** Per-frame breathe: one uniform per merged mesh. */
  update(elapsed: number): void {
    for (const batch of this.batches.values()) {
      for (const mesh of [batch.tubes, batch.arrows]) {
        if (mesh) (mesh.material as THREE.ShaderMaterial).uniforms.uTime.value = elapsed;
      }
    }
  }

  clear(): void {
    for (const batch of this.batches.values()) {
      for (const mesh of [batch.tubes, batch.arrows]) {
        if (!mesh) continue;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.scene.remove(mesh);
      }
    }
    this.batches.clear();
    this.neighbors.clear();
    this.highlightedPath = null;
    this.appliedHighlight = null;
  }

  dispose(): void {
    this.clear();
  }

  // --- internals ---

  private endpoint(path: string): THREE.Vector3 | null {
    if (path === 'core') return this.getCorePos();
    const mesh = this.buildingPathMap.get(path);
    if (!mesh) return null;
    const geo = mesh.geometry;
    geo.computeBoundingBox();
    return new THREE.Vector3(mesh.position.x, mesh.position.y + (geo.boundingBox?.max.y ?? 5) * 0.9, mesh.position.z);
  }

  private arrowGeometry(curve: THREE.QuadraticBezierCurve3, radius: number): THREE.BufferGeometry {
    const at = curve.getPoint(0.82);
    const tangent = curve.getTangent(0.82).normalize();
    const cone = new THREE.ConeGeometry(radius * 3.2, radius * 9, 8);
    // Cone points +Y by default; orient it along the curve tangent, then bake
    // the transform so every arrow can share one merged mesh.
    const m = new THREE.Matrix4().compose(
      at,
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent),
      new THREE.Vector3(1, 1, 1),
    );
    cone.applyMatrix4(m);
    return cone;
  }

  private mergedMesh(geos: THREE.BufferGeometry[] | undefined, color: number, boost: number): THREE.Mesh | null {
    if (!geos || geos.length === 0) return null;
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (geos.length > 1) for (const g of geos) g.dispose();
    if (!merged) return null;
    const mesh = new THREE.Mesh(merged, edgeMaterial(color, boost));
    mesh.userData = { isEdge: true };
    this.scene.add(mesh);
    return mesh;
  }

  /** Write the touching flag into aTouch for the highlighted path's edges. */
  private applyHighlight(): void {
    if (this.appliedHighlight === this.highlightedPath) return;
    const prev = this.appliedHighlight;
    const next = this.highlightedPath;
    this.appliedHighlight = next;
    const touches = (e: GraphEdge, p: string | null) => p !== null && (e.from === p || e.to === p);

    for (const batch of this.batches.values()) {
      let tubeDirty = false, arrowDirty = false;
      const tubeTouch = batch.tubes?.geometry.getAttribute('aTouch') as THREE.BufferAttribute | undefined;
      const arrowTouch = batch.arrows?.geometry.getAttribute('aTouch') as THREE.BufferAttribute | undefined;
      for (const entry of batch.entries) {
        const was = touches(entry.edge, prev), now = touches(entry.edge, next);
        if (was === now) continue;
        const value = now ? 1 : 0;
        if (tubeTouch) {
          (tubeTouch.array as Float32Array).fill(value, entry.tubeStart, entry.tubeStart + entry.tubeCount);
          tubeDirty = true;
        }
        if (arrowTouch && entry.arrowCount > 0) {
          (arrowTouch.array as Float32Array).fill(value, entry.arrowStart, entry.arrowStart + entry.arrowCount);
          arrowDirty = true;
        }
      }
      if (tubeDirty && tubeTouch) tubeTouch.needsUpdate = true;
      if (arrowDirty && arrowTouch) arrowTouch.needsUpdate = true;
    }
  }

  private addNeighbor(a: string, b: string): void {
    let set = this.neighbors.get(a);
    if (!set) { set = new Set(); this.neighbors.set(a, set); }
    set.add(b);
  }

  private applyVisibility(): void {
    for (const batch of this.batches.values()) {
      const vis = this.visibleTypes.has(batch.type);
      if (batch.tubes) batch.tubes.visible = vis;
      if (batch.arrows) batch.arrows.visible = vis;
    }
  }

  private rebuildNeighborIndex(): void {
    this.neighbors.clear();
    for (const batch of this.batches.values()) {
      if (!this.visibleTypes.has(batch.type)) continue;
      for (const { edge } of batch.entries) {
        this.addNeighbor(edge.from, edge.to);
        this.addNeighbor(edge.to, edge.from);
      }
    }
  }

  /** Draw calls the arcs cost right now (visible merged meshes). */
  drawCallCount(): number {
    let n = 0;
    for (const batch of this.batches.values()) {
      if (!this.visibleTypes.has(batch.type)) continue;
      if (batch.tubes) n++;
      if (batch.arrows) n++;
    }
    return n;
  }
}
