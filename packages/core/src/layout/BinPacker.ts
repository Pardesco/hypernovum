import type { ProjectData, District, Bounds } from '../types';

/**
 * Spatial bin-packing layout engine.
 * Groups projects by category into city blocks with roads between them.
 * Within each block, arranges buildings in a grid by stage (X) and index (Z).
 */
export class BinPacker {
  private buildingSpacing = 2;
  private buildingsPerRow = 4;
  private blockGap = 15; // Gap between category blocks (multiple of grid)
  private stageGap = 10;  // Gap between stages within a block (multiple of grid)
  private gridSize = 5;  // Grid snap size - must match SceneManager

  private snapToGrid(value: number): number {
    return Math.round(value / this.gridSize) * this.gridSize;
  }

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
          bounds: { x: 0, z: 0, width: 0, depth: 0 },
        });
      }
      districts.get(key)!.buildings.push(project);
    }

    // 2. Get unique categories and stages
    const categories = [...new Set(projects.map(p => p.category))].sort();
    const stages = ['backlog', 'active', 'paused', 'complete'];

    // 3. Layout each category as a city block (grid-aligned)
    let currentZ = this.gridSize; // Start at grid position

    for (const category of categories) {
      const categoryDistricts = [...districts.values()].filter(d => d.category === category);
      if (categoryDistricts.length === 0) continue;

      let currentX = this.gridSize; // Start at grid position
      let maxDepthInCategory = 0;

      // Sort by stage order
      categoryDistricts.sort((a, b) => stages.indexOf(a.stage) - stages.indexOf(b.stage));

      for (const district of categoryDistricts) {
        // Calculate block dimensions based on building count
        const buildingCount = district.buildings.length;
        const cols = Math.min(buildingCount, this.buildingsPerRow);
        const rows = Math.ceil(buildingCount / this.buildingsPerRow);

        // Arrange buildings (grid-aligned start positions)
        this.arrangeGridLayout(district, currentX, currentZ);

        // Calculate actual bounds (snap to grid)
        const avgBuildingSize = this.gridSize;
        const blockWidth = this.snapToGrid(cols * (avgBuildingSize + this.buildingSpacing));
        const blockDepth = this.snapToGrid(rows * (avgBuildingSize + this.buildingSpacing));

        district.bounds = {
          x: currentX,
          z: currentZ,
          width: Math.max(blockWidth, this.gridSize),
          depth: Math.max(blockDepth, this.gridSize),
        };

        currentX = this.snapToGrid(currentX + blockWidth + this.stageGap);
        maxDepthInCategory = Math.max(maxDepthInCategory, blockDepth);
      }

      currentZ = this.snapToGrid(currentZ + maxDepthInCategory + this.blockGap);
    }

    return districts;
  }

  private arrangeGridLayout(district: District, startX: number, startZ: number): void {
    // Sort buildings by priority (critical first) for visual hierarchy
    district.buildings.sort((a, b) => {
      const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
    });

    district.buildings.forEach((building, index) => {
      const row = Math.floor(index / this.buildingsPerRow);
      const col = index % this.buildingsPerRow;

      // Building size based on scope (snap to reasonable sizes)
      const baseSize = Math.max(2, Math.min(4, Math.sqrt(building.scope) * 0.4));

      // Snap building positions to grid
      const cellSize = this.gridSize + this.buildingSpacing;
      building.position = {
        x: this.snapToGrid(startX + col * cellSize + this.gridSize / 2),
        y: 0,
        z: this.snapToGrid(startZ + row * cellSize + this.gridSize / 2),
      };

      building.dimensions = {
        width: baseSize,
        height: this.calculateHeight(building.priority),
        depth: baseSize,
      };
    });
  }

  private calculateHeight(priority: string): number {
    const storyHeight = 2.5;
    const stories: Record<string, number> = {
      critical: 7,
      high: 5,
      medium: 3,
      low: 1.5,
    };
    return (stories[priority] ?? 2) * storyHeight;
  }
}
