import type { ProjectData, District, Bounds } from '../types';

/**
 * Spatial bin-packing layout engine.
 * Groups projects by (stage, category) into districts,
 * then arranges buildings within each district in a grid
 * to prevent overlap / z-fighting.
 */
export class BinPacker {
  private districtSize = 20;
  private buildingSpacing = 1.5;
  private buildingsPerRow = 5;

  packDistricts(projects: ProjectData[]): Map<string, District> {
    const districts = new Map<string, District>();

    // 1. Group projects by (stage, category)
    for (const project of projects) {
      const key = `${project.stage}_${project.category}`;
      if (!districts.has(key)) {
        districts.set(key, {
          stage: project.stage,
          category: project.category,
          buildings: [],
          bounds: this.calculateDistrictBounds(project.stage, project.category),
        });
      }
      districts.get(key)!.buildings.push(project);
    }

    // 2. Within each district, arrange buildings in a grid
    for (const district of districts.values()) {
      this.arrangeGridLayout(district);
    }

    return districts;
  }

  private calculateDistrictBounds(stage: string, category: string): Bounds {
    // Map stage to X position
    const stagePositions: Record<string, number> = {
      backlog: -30,
      active: 0,
      paused: 15,
      complete: 30,
    };
    const stageX = stagePositions[stage] ?? 0;

    // Map category to Z position via hash
    const categoryZ = this.hashCategory(category) * 20 - 10;

    return {
      x: stageX,
      z: categoryZ,
      width: this.districtSize,
      depth: this.districtSize,
    };
  }

  private arrangeGridLayout(district: District): void {
    const { x: districtX, z: districtZ } = district.bounds;

    district.buildings.forEach((building, index) => {
      const row = Math.floor(index / this.buildingsPerRow);
      const col = index % this.buildingsPerRow;

      // Clamp minimum base size to prevent needle buildings
      const baseSize = Math.max(2, Math.sqrt(building.scope) * 0.5);

      building.position = {
        x: districtX + col * (baseSize + this.buildingSpacing),
        y: 0,
        z: districtZ + row * (baseSize + this.buildingSpacing),
      };

      building.dimensions = {
        width: baseSize,
        height: this.calculateHeight(building.priority),
        depth: baseSize,
      };
    });
  }

  private calculateHeight(priority: string): number {
    const storyHeight = 2;
    const stories: Record<string, number> = {
      critical: 8,
      high: 5,
      medium: 3,
      low: 1,
    };
    return (stories[priority] ?? 2) * storyHeight;
  }

  private hashCategory(category: string): number {
    let hash = 0;
    for (let i = 0; i < category.length; i++) {
      hash = (hash << 5) - hash + category.charCodeAt(i);
    }
    return Math.abs(hash % 10);
  }
}
