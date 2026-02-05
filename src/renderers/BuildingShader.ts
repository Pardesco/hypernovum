import * as THREE from 'three';
import type { ProjectData } from '../types';

// Shader source will be inlined by esbuild loader
import vertexShader from '../../shaders/building.vert';
import fragmentShader from '../../shaders/building.frag';

/**
 * Creates ShaderMaterial for buildings with procedural windows,
 * decay dithering, and activity glow.
 * Deferred to v0.2 — MVP uses MeshStandardMaterial.
 */
export class BuildingShader {
  createMaterial(project: ProjectData): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: this.getStatusColor(project.status) },
        uDecay: { value: this.calculateDecay(project.lastModified) },
        uActivity: { value: project.recentActivity ? 1.0 : 0.0 },
        uTime: { value: 0.0 },
      },
      vertexShader,
      fragmentShader,
      side: THREE.DoubleSide,
    });
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
