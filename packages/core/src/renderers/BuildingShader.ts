import * as THREE from 'three';
import type { ProjectData } from '../types';
import { statusColor } from '../types';
import { debugLog } from '../utils/log';

// Shader source will be inlined by esbuild loader
import vertexShader from '../shaders/building.vert';
import fragmentShader from '../shaders/building.frag';

/**
 * Creates ShaderMaterial for buildings with procedural windows,
 * decay dithering, glitch effects, and activity glow.
 */
export class BuildingShader {
  private static compilationTested = false;
  private static compilationFailed = false;

  /**
   * Test shader compilation once at startup.
   * Returns true if shaders compile successfully.
   */
  static testCompilation(renderer: THREE.WebGLRenderer): boolean {
    if (this.compilationTested) {
      return !this.compilationFailed;
    }
    this.compilationTested = true;

    try {
      // Create minimal test material with all required uniforms
      const testMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(0x00ff00) },
          uDecay: { value: 0.0 },
          uLitPercent: { value: 0.5 },
          uPulse: { value: 0.0 },
          uTime: { value: 0.0 },
          uGlitch: { value: 0.0 },
          uScope: { value: 10.0 },
          uTotalTasks: { value: 0.0 },
          uDimFactor: { value: 1.0 },
          uFloors: { value: 0.0 },
          uDiagrid: { value: 0.0 },
          uWindowCols: { value: 0.0 },
        },
        vertexShader,
        fragmentShader,
        side: THREE.DoubleSide,
      });

      // Force compilation by rendering a test mesh
      const testGeom = new THREE.BoxGeometry(1, 1, 1);
      const testMesh = new THREE.Mesh(testGeom, testMaterial);
      const testScene = new THREE.Scene();
      const testCamera = new THREE.PerspectiveCamera();
      testScene.add(testMesh);

      // Compile shaders
      renderer.compile(testScene, testCamera);

      // Resolve the deferred link BEFORE the material is disposed. three
      // (r160) probes KHR_parallel_shader_compile while building material
      // parameters, which switches ANGLE into async program linking, and
      // compile() defers every link-status query to first use. Deleting a
      // program whose link was never queried makes the driver's cleanup path
      // query the dead program internally — 12x "GL_INVALID_VALUE: Program
      // object expected" in the console on the first city build of every
      // session. Querying LINK_STATUS settles the link so disposal below is
      // clean, and doubles as the real compile check this method previously
      // never performed (compile() does not throw on GLSL errors).
      const gl = renderer.getContext();
      const programInfo = (
        renderer as unknown as {
          properties: { get(o: unknown): { currentProgram?: { program: WebGLProgram } } };
        }
      ).properties.get(testMaterial).currentProgram;
      const linked = programInfo
        ? (gl.getProgramParameter(programInfo.program, gl.LINK_STATUS) as boolean)
        : true; // renderer internals changed shape — keep the old "assume ok"

      // Cleanup
      testGeom.dispose();
      testMaterial.dispose();

      if (!linked) {
        debugLog('Shader program failed to link, using fallback materials');
        this.compilationFailed = true;
        return false;
      }

      debugLog('Shader compilation successful');
      return true;
    } catch (e) {
      debugLog('Shader compilation failed, using fallback materials:', e);
      this.compilationFailed = true;
      return false;
    }
  }

  /**
   * Check if shaders are available (compilation passed).
   */
  static isAvailable(): boolean {
    return this.compilationTested && !this.compilationFailed;
  }

  /**
   * Create shader material for a project building.
   * Returns null if shader compilation previously failed.
   */
  createMaterial(
    project: ProjectData,
    opts?: { floors?: number; diagrid?: boolean; sides?: number | null },
  ): THREE.ShaderMaterial | null {
    if (BuildingShader.compilationFailed) {
      return null;
    }

    try {
      return new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: this.getStatusColor(project.status) },
          uDecay: { value: this.calculateDecay(project.lastModified) },
          uLitPercent: { value: this.calculateLitPercent(project) },
          uPulse: { value: 0.0 },
          uTime: { value: 0.0 },
          uGlitch: { value: project.status === 'blocked' ? 0.6 : 0.0 },
          uScope: { value: project.scope || project.noteCount || 10 },
          uTotalTasks: { value: project.totalTasks ?? 0 },
          uDimFactor: { value: 1.0 },
          // Parametric mode passes real floor count + optional diagrid facade.
          uFloors: { value: opts?.floors ?? 0 },
          uDiagrid: { value: opts?.diagrid ? 1.0 : 0.0 },
          uWindowCols: {
            value: opts?.floors ? this.perimeterWindowCols(project, opts.sides ?? null) : 0.0,
          },
        },
        vertexShader,
        fragmentShader,
        side: THREE.DoubleSide,
        transparent: true,
      });
    } catch (e) {
      debugLog('Failed to create shader material:', e);
      return null;
    }
  }

  /**
   * Window columns around a lofted tower's full perimeter.
   *
   * The shader's legacy count is per box FACE; a loft's u wraps the entire
   * perimeter, so reusing it directly gives ~a quarter of the windows and
   * visibly weakens the task-count → density encoding. Scale by four faces'
   * worth, then snap to a multiple of the facet count so panes never straddle
   * a hard corner and read as broken decals.
   */
  private perimeterWindowCols(project: ProjectData, sides: number | null): number {
    const taskSource = project.totalTasks && project.totalTasks > 0
      ? project.totalTasks
      : (project.scope || project.noteCount || 10);
    const perFace = Math.min(10, Math.max(3, 3 + Math.floor(taskSource / 8)));
    let cols = perFace * 4;
    if (sides && sides > 0) cols = Math.max(sides, Math.round(cols / sides) * sides);
    return Math.min(cols, 64);
  }

  private getStatusColor(status: string): THREE.Color {
    // Unified palette — single source in types.STATUS_COLORS
    return new THREE.Color(statusColor(status));
  }

  private calculateDecay(lastModified: number): number {
    const daysSince = (Date.now() - lastModified) / (1000 * 60 * 60 * 24);
    if (daysSince < 7) return 0.0;
    if (daysSince < 30) return 0.3;
    if (daysSince < 60) return 0.6;
    return 0.9;
  }

  private calculateLitPercent(project: ProjectData): number {
    if (!project.totalTasks || project.totalTasks === 0) {
      // Legacy: use recentActivity as before
      return project.recentActivity ? 0.6 : 0.1;
    }
    return (project.completedTasks ?? 0) / project.totalTasks;
  }
}
