import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EdgeManager } from '../src/scene/EdgeManager';
import type { GraphEdge } from '../src/types';

function building(x: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 2));
  m.position.set(x, 0, z);
  return m;
}

function setup() {
  const scene = new THREE.Scene();
  const map = new Map<string, THREE.Mesh>([
    ['a.md', building(0, 0)],
    ['b.md', building(10, 0)],
    ['c.md', building(0, 10)],
  ]);
  for (const m of map.values()) scene.add(m);
  const em = new EdgeManager(scene, map, () => new THREE.Vector3(0, 25, 0));
  return { scene, map, em };
}

const backlink = (from: string, to: string, weight = 1): GraphEdge =>
  ({ from, to, type: 'backlink', direction: 'undirected', source: 'deterministic', weight });
const dependsOn = (from: string, to: string): GraphEdge =>
  ({ from, to, type: 'depends-on', direction: 'directed', source: 'deterministic' });

describe('EdgeManager', () => {
  it('builds tubes for resolvable edges and skips missing endpoints', () => {
    const { scene, em } = setup();
    const before = scene.children.length;
    em.setEdges([backlink('a.md', 'b.md'), backlink('a.md', 'missing.md')]);
    // one undirected backlink tube added (no arrow); missing endpoint skipped
    expect(scene.children.length).toBe(before + 1);
  });

  it('directed edges add an arrowhead cone (tube + arrow)', () => {
    const { scene, em } = setup();
    const before = scene.children.length;
    em.setEdges([dependsOn('a.md', 'b.md')]);
    expect(scene.children.length).toBe(before + 2); // tube + arrow
  });

  it('neighborsOf is symmetric across an edge', () => {
    const { em } = setup();
    em.setEdges([backlink('a.md', 'b.md'), dependsOn('a.md', 'c.md')]);
    expect([...em.neighborsOf('a.md')].sort()).toEqual(['b.md', 'c.md']);
    expect([...em.neighborsOf('b.md')]).toEqual(['a.md']);
    expect([...em.neighborsOf('c.md')]).toEqual(['a.md']);
  });

  it('setVisibleTypes hides edges and shrinks the neighbor index', () => {
    const { em } = setup();
    em.setEdges([backlink('a.md', 'b.md'), dependsOn('a.md', 'c.md')]);
    em.setVisibleTypes(new Set(['backlink']));
    // only the backlink neighbor remains
    expect([...em.neighborsOf('a.md')]).toEqual(['b.md']);
    expect([...em.neighborsOf('c.md')]).toEqual([]);
  });

  it('resolves the core sentinel endpoint for agent edges', () => {
    const { scene, em } = setup();
    const before = scene.children.length;
    em.setEdges([{ from: 'core', to: 'a.md', type: 'agent-working-on', direction: 'directed', source: 'deterministic' }]);
    expect(scene.children.length).toBe(before + 2); // tube + arrow, core resolved
  });

  it('update + highlightForPath run without throwing', () => {
    const { em } = setup();
    em.setEdges([backlink('a.md', 'b.md')]);
    em.highlightForPath('a.md');
    expect(() => em.update(1.23)).not.toThrow();
  });

  it('GFX-010: batches every edge of a type into one tube mesh + one arrow mesh', () => {
    const { scene, em, map } = setup();
    for (let i = 0; i < 20; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 2));
      m.position.set(i * 3, 0, 20);
      map.set(`n${i}.md`, m);
      scene.add(m);
    }
    const before = scene.children.length;
    const deps = Array.from({ length: 20 }, (_, i) => dependsOn(`n${i}.md`, 'a.md'));
    const links = Array.from({ length: 10 }, (_, i) => backlink(`n${i}.md`, 'b.md'));
    em.setEdges([...deps, ...links]);
    // depends-on: tubes + arrows; backlink: tubes only — 3 objects for 30 edges.
    expect(scene.children.length).toBe(before + 3);
    expect(em.drawCallCount()).toBe(3);
    em.setVisibleTypes(new Set(['backlink']));
    expect(em.drawCallCount()).toBe(1);
  });

  it('GFX-010: hover highlight flags only the touching edges, and clears again', () => {
    const { scene, em } = setup();
    em.setEdges([backlink('a.md', 'b.md'), backlink('b.md', 'c.md')]);
    const mesh = scene.children.find((o) => o.userData.isEdge) as THREE.Mesh;
    const touch = () => [...(mesh.geometry.getAttribute('aTouch').array as Float32Array)];
    const half = touch().length / 2; // two tubes of equal vertex count
    em.highlightForPath('a.md');
    expect(touch().slice(0, half).every((v) => v === 1)).toBe(true);
    expect(touch().slice(half).every((v) => v === 0)).toBe(true);
    em.highlightForPath(null);
    expect(touch().every((v) => v === 0)).toBe(true);
  });

  it('GFX-010: the breathe animation is one uniform write per merged mesh', () => {
    const { scene, em } = setup();
    em.setEdges([dependsOn('a.md', 'b.md')]);
    em.update(4.2);
    const meshes = scene.children.filter((o) => o.userData.isEdge) as THREE.Mesh[];
    expect(meshes).toHaveLength(2);
    for (const m of meshes) expect((m.material as THREE.ShaderMaterial).uniforms.uTime.value).toBe(4.2);
  });

  it('clear removes all edge objects from the scene', () => {
    const { scene, em } = setup();
    const before = scene.children.length;
    em.setEdges([dependsOn('a.md', 'b.md'), backlink('a.md', 'c.md')]);
    expect(scene.children.length).toBeGreaterThan(before);
    em.clear();
    expect(scene.children.length).toBe(before);
    expect([...em.neighborsOf('a.md')]).toEqual([]);
  });
});
