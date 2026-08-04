import * as THREE from 'three';
import type { EdgeType, GraphEdge } from '../types';

/**
 * EdgeManager (EDG-001) — the single renderer for every inter-building arc.
 *
 * Consumes a typed GraphEdge[] and draws one additive tube per edge, styled by
 * type (color/thickness), with a cone arrowhead for directed edges. Owns
 * per-type visibility, the hover/selection neighbor index, and the per-frame
 * breathe + highlight animation. Replaces SceneManager's ad-hoc linkArcs.
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

interface EdgeEntry {
  edge: GraphEdge;
  tube: THREE.Mesh;
  arrow: THREE.Mesh | null;
  baseOpacity: number;
  pulsePhase: number;
}

export class EdgeManager {
  private entries: EdgeEntry[] = [];
  private visibleTypes = new Set<EdgeType>(['backlink', 'agent-working-on', 'depends-on', 'blocked-by']);
  /** path → neighbor paths, restricted to currently visible edge types */
  private neighbors = new Map<string, Set<string>>();
  private highlightedPath: string | null = null;

  constructor(
    private scene: THREE.Scene,
    private buildingPathMap: Map<string, THREE.Mesh>,
    private getCorePos: () => THREE.Vector3 | null = () => null,
  ) {}

  /** Rebuild all edge geometry from a fresh GraphEdge set. */
  setEdges(edges: GraphEdge[]): void {
    this.clear();

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
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 24, radius, 5, false),
        new THREE.MeshBasicMaterial({
          color: style.color, transparent: true, opacity: 0.32,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      tube.userData = { isEdge: true, edgeType: edge.type };
      this.scene.add(tube);

      // Directed edges get a cone arrowhead near the destination.
      let arrow: THREE.Mesh | null = null;
      if (style.directed) {
        arrow = this.makeArrow(curve, style.color, radius);
        this.scene.add(arrow);
      }

      const baseOpacity = edge.type === 'backlink'
        ? 0.2 + Math.min(weight, 6) * 0.04
        : 0.3;
      this.entries.push({
        edge, tube, arrow, baseOpacity,
        pulsePhase: (start.x + end.z) % (Math.PI * 2),
      });

      this.addNeighbor(edge.from, edge.to);
      if (edge.direction === 'undirected') this.addNeighbor(edge.to, edge.from);
      else this.addNeighbor(edge.to, edge.from); // neighborhood is symmetric for highlight
    }

    this.applyVisibility();
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
  }

  /** Per-frame breathe + highlight boost. */
  update(elapsed: number): void {
    for (const e of this.entries) {
      const mat = e.tube.material as THREE.MeshBasicMaterial;
      const touching = this.highlightedPath !== null &&
        (e.edge.from === this.highlightedPath || e.edge.to === this.highlightedPath);
      const breathe = 0.75 + 0.25 * Math.sin(elapsed * 1.5 + e.pulsePhase);
      mat.opacity = Math.min(e.baseOpacity * breathe * (touching ? 3 : 1), 1);
      if (e.arrow) {
        (e.arrow.material as THREE.MeshBasicMaterial).opacity = Math.min(mat.opacity * 1.4, 1);
      }
    }
  }

  clear(): void {
    for (const e of this.entries) {
      e.tube.geometry.dispose();
      (e.tube.material as THREE.Material).dispose();
      this.scene.remove(e.tube);
      if (e.arrow) {
        e.arrow.geometry.dispose();
        (e.arrow.material as THREE.Material).dispose();
        this.scene.remove(e.arrow);
      }
    }
    this.entries = [];
    this.neighbors.clear();
    this.highlightedPath = null;
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

  private makeArrow(curve: THREE.QuadraticBezierCurve3, color: number, radius: number): THREE.Mesh {
    const at = curve.getPoint(0.82);
    const tangent = curve.getTangent(0.82).normalize();
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(radius * 3.2, radius * 9, 8),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    cone.position.copy(at);
    // Cone points +Y by default; orient it along the curve tangent.
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    cone.userData = { isEdge: true };
    return cone;
  }

  private addNeighbor(a: string, b: string): void {
    let set = this.neighbors.get(a);
    if (!set) { set = new Set(); this.neighbors.set(a, set); }
    set.add(b);
  }

  private applyVisibility(): void {
    for (const e of this.entries) {
      const vis = this.visibleTypes.has(e.edge.type);
      e.tube.visible = vis;
      if (e.arrow) e.arrow.visible = vis;
    }
  }

  private rebuildNeighborIndex(): void {
    this.neighbors.clear();
    for (const e of this.entries) {
      if (!this.visibleTypes.has(e.edge.type)) continue;
      this.addNeighbor(e.edge.from, e.edge.to);
      this.addNeighbor(e.edge.to, e.edge.from);
    }
  }
}
