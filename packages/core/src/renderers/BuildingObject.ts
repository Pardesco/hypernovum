import * as THREE from 'three';
import type { ProjectData } from '../types';
import { BuildingFactory } from './BuildingFactory';

/**
 * Factory for creating building mesh objects from project data.
 * MVP uses basic BoxGeometry + MeshStandardMaterial.
 * v0.2 will switch to InstancedMesh + ShaderMaterial.
 */
export class BuildingObject {
  createBuilding(project: ProjectData): THREE.Mesh | null {
    if (!project.position || !project.dimensions) return null;

    const { width, height, depth } = project.dimensions;

    // Generate procedural geometry based on project data/status
    const geometry = BuildingFactory.createBuilding(project);

    // Ensure shadow casting/receiving
    geometry.computeVertexNormals();

    // Material fallback if shader fails (will be replaced by BuildingShader if valid)
    const material = new THREE.MeshStandardMaterial({
      color: this.getColor(project.status),
      roughness: 0.6,
      metalness: 0.8,
      flatShading: true, // Cyberpunk low-poly aesthetic
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
      project.position.x,
      0, // Geometry is already y-translated (0 to height)
      project.position.z,
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { isBuilding: true, project };

    return mesh;
  }

  private getColor(status: string): number {
    const colors: Record<string, number> = {
      active: 0x00ff88,
      blocked: 0xff4444,
      paused: 0x4488ff,
      complete: 0xaa88ff,
    };
    return colors[status] ?? 0x888888;
  }
}
