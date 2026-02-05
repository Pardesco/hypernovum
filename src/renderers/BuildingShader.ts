import * as THREE from 'three';
import type { ProjectData } from '../types';

// Shader source will be inlined by esbuild loader
import vertexShader from '../../shaders/building.vert';
import fragmentShader from '../../shaders/building.frag';

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
          uActivity: { value: 0.5 },
          uTime: { value: 0.0 },
          uGlitch: { value: 0.0 },
          uScope: { value: 10.0 },
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

      // Cleanup
      testGeom.dispose();
      testMaterial.dispose();

      console.log('[Hypervault] Shader compilation successful');
      return true;
    } catch (e) {
      console.warn('[Hypervault] Shader compilation failed, using fallback materials:', e);
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
  createMaterial(project: ProjectData): THREE.ShaderMaterial | null {
    if (BuildingShader.compilationFailed) {
      return null;
    }

    try {
      return new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: this.getStatusColor(project.status) },
          uDecay: { value: this.calculateDecay(project.lastModified) },
          uActivity: { value: project.recentActivity ? 1.0 : 0.0 },
          uTime: { value: 0.0 },
          uGlitch: { value: project.status === 'blocked' ? 0.6 : 0.0 },
          uScope: { value: project.scope || project.noteCount || 10 },
        },
        vertexShader,
        fragmentShader,
        side: THREE.DoubleSide,
        transparent: true,
      });
    } catch (e) {
      console.warn('[Hypervault] Failed to create shader material:', e);
      return null;
    }
  }

  private getStatusColor(status: string): THREE.Color {
    const colors: Record<string, number> = {
      active: 0x00ff88,
      blocked: 0xff4444,
      paused: 0x4488ff,
      complete: 0xaa88ff,
    };
    return new THREE.Color(colors[status] ?? 0x888888);
  }

  private calculateDecay(lastModified: number): number {
    const daysSince = (Date.now() - lastModified) / (1000 * 60 * 60 * 24);
    if (daysSince < 7) return 0.0;
    if (daysSince < 30) return 0.3;
    if (daysSince < 60) return 0.6;
    return 0.9;
  }
}
