/**
 * Regression tests for BuildingShader.testCompilation.
 *
 * Bug: testCompilation() called renderer.compile() and then immediately
 * disposed the test material. three r160 probes KHR_parallel_shader_compile
 * for every material's parameters (switching ANGLE into async program
 * linking) and defers all link-status queries to first use — so the test
 * program was deleted while its link was still unresolved, and the driver's
 * cleanup emitted 12x "GL_INVALID_VALUE: Program object expected" in the
 * renderer console on the first city build of every session.
 *
 * The fix queries LINK_STATUS before disposal, which settles the link AND
 * turns testCompilation into a real test: renderer.compile() never throws on
 * GLSL errors, so the old try/catch could not detect a broken shader.
 *
 * The suite cannot compile GLSL (Node, no GL) — these tests pin the CONTRACT
 * against a mocked renderer: the link query must happen, it must happen
 * before the program is destroyed, and its result must decide the outcome.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type * as THREE from 'three';
import { BuildingShader } from '../src/renderers/BuildingShader';

type StaticState = { compilationTested: boolean; compilationFailed: boolean };
const resetStatics = () => {
  const s = BuildingShader as unknown as StaticState;
  s.compilationTested = false;
  s.compilationFailed = false;
};

/**
 * Mock renderer that mimics the three r160 surface testCompilation touches:
 * compile() registers a currentProgram for each material, dispose() destroys
 * it (the 'dispose' listener three's WebGLRenderer installs), and the GL
 * context records the order of link queries vs. program deletion.
 */
function makeRenderer(linkStatus: boolean) {
  const calls: string[] = [];
  const glProgram = { fake: 'program' };
  const programs = new Map<unknown, { program: unknown }>();
  const gl = {
    LINK_STATUS: 0x8b82,
    getProgramParameter: (program: unknown, pname: number) => {
      calls.push(pname === 0x8b82 ? `link-status:${program === glProgram ? 'test-program' : 'other'}` : 'other-query');
      return linkStatus;
    },
  };
  const renderer = {
    compile: (scene: THREE.Scene) => {
      calls.push('compile');
      scene.traverse((obj) => {
        const material = (obj as THREE.Mesh).material;
        if (material && !Array.isArray(material)) {
          programs.set(material, { program: glProgram });
          // three's renderer deletes the GL program when a material with a
          // released program is disposed — record that ordering.
          material.addEventListener('dispose', () => calls.push('delete-program'));
        }
      });
    },
    getContext: () => gl,
    properties: {
      get: (o: unknown) => ({ currentProgram: programs.get(o) }),
    },
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, calls };
}

describe('BuildingShader.testCompilation', () => {
  beforeEach(resetStatics);

  it('queries LINK_STATUS of the test program BEFORE the program is deleted', () => {
    const { renderer, calls } = makeRenderer(true);
    const ok = BuildingShader.testCompilation(renderer);

    expect(ok).toBe(true);
    const linkAt = calls.indexOf('link-status:test-program');
    const deleteAt = calls.indexOf('delete-program');
    // The link must be settled (queried) before disposal deletes the program;
    // deleting an unqueried program under KHR_parallel_shader_compile spams
    // "GL_INVALID_VALUE: Program object expected" 12x in the console.
    expect(linkAt).toBeGreaterThan(calls.indexOf('compile'));
    expect(deleteAt).toBeGreaterThan(-1);
    expect(linkAt).toBeLessThan(deleteAt);
  });

  it('reports failure (and flips the fallback) when the program did not link', () => {
    const { renderer } = makeRenderer(false);
    const ok = BuildingShader.testCompilation(renderer);

    expect(ok).toBe(false);
    expect(BuildingShader.isAvailable()).toBe(false);
    // createMaterial must fall back to null so buildings use standard materials.
    const shader = new BuildingShader();
    expect(
      shader.createMaterial({
        path: 'p.md', title: 'p', status: 'active', priority: 'medium',
        category: 'c', lastModified: Date.now(),
      } as never),
    ).toBeNull();
  });

  it('reports success when the program linked', () => {
    const { renderer } = makeRenderer(true);
    expect(BuildingShader.testCompilation(renderer)).toBe(true);
    expect(BuildingShader.isAvailable()).toBe(true);
  });

  it('only tests once per session (static gate)', () => {
    const { renderer, calls } = makeRenderer(true);
    BuildingShader.testCompilation(renderer);
    const before = calls.length;
    BuildingShader.testCompilation(renderer);
    expect(calls.length).toBe(before);
  });
});
