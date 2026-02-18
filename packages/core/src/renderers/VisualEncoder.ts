import * as THREE from 'three';
import type { ProjectData } from '../types';

/**
 * Maps project metadata to visual properties (color, height, decay, glow).
 * Used by SceneManager to configure building materials.
 */
export class VisualEncoder {
  /** Map project status to building color */
  getStatusColor(status: string): THREE.Color {
    const colors: Record<string, number> = {
      active: 0x00ff88,
      blocked: 0xff4444,
      paused: 0x4488ff,
      complete: 0xaa88ff,
    };
    return new THREE.Color(colors[status] ?? 0x888888);
  }

  /** Calculate decay factor (0 = fresh, 1 = stale) based on last modification */
  calculateDecay(lastModified: number): number {
    const daysSince = (Date.now() - lastModified) / (1000 * 60 * 60 * 24);
    if (daysSince < 7) return 0.0;
    if (daysSince < 30) return 0.3;
    if (daysSince < 60) return 0.6;
    return 0.9;
  }

  /** Calculate lit window percentage (0.0-1.0) based on task completion */
  getLitPercent(project: ProjectData): number {
    if (project.totalTasks && project.totalTasks > 0) {
      return (project.completedTasks ?? 0) / project.totalTasks;
    }
    return project.recentActivity ? 0.6 : 0.1;
  }
}
