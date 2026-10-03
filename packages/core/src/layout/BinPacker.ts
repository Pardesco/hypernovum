import type { ProjectData, District } from '../types';

/** Options for {@link BinPacker.packDistricts}. */
export interface PackOptions {
  /**
   * 'legacy' (default): one category per row along Z — the 0.x layout, which
   * saved block offsets (BlockPosition) are relative to.
   * 'shelf' (LAY-001): category blocks packed into rows toward `targetAspect`.
   */
  layout?: 'legacy' | 'shelf';
  /** Footprint width:depth the shelf layout aims for. Default 1.8. */
  targetAspect?: number;
}

/** One category's districts laid out together, and their footprint. */
interface CategoryBlock {
  category: string;
  districts: District[];
  minX: number;
  minZ: number;
  width: number;
  depth: number;
}

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
  /**
   * Shelf layout: horizontal gap between neighbouring category blocks. Wider
   * than blockGap because each district's label sits left of its outline.
   */
  private shelfGapX = 20;

  private snapToGrid(value: number): number {
    return Math.round(value / this.gridSize) * this.gridSize;
  }

  packDistricts(projects: ProjectData[], options?: PackOptions): Map<string, District> {
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

    // 2. Get unique categories
    const categories = [...new Set(projects.map(p => p.category))].sort();

    if (options?.layout === 'shelf') {
      this.packShelves(categories, districts, options.targetAspect ?? 1.8);
      return districts;
    }

    // 3. Legacy: each category is one row of blocks along Z (grid-aligned)
    let currentZ = this.gridSize; // Start at grid position
    for (const category of categories) {
      const block = this.layoutCategory(category, districts, this.gridSize, currentZ);
      if (!block) continue;
      currentZ = this.snapToGrid(currentZ + block.depth + this.blockGap);
    }

    return districts;
  }

  /**
   * Lay out one category's districts (one per stage, left to right) starting
   * at (startX, startZ). Returns the block footprint, or null for an empty
   * category. `depth` is the deepest district (unsnapped, as the legacy row
   * advance always used it).
   */
  private layoutCategory(
    category: string,
    districts: Map<string, District>,
    startX: number,
    startZ: number,
  ): CategoryBlock | null {
    const stages = ['backlog', 'active', 'paused', 'complete'];
    const categoryDistricts = [...districts.values()].filter(d => d.category === category);
    if (categoryDistricts.length === 0) return null;

    let currentX = startX;
    let maxDepthInCategory = 0;
    let maxX = startX;

    // Sort by stage order
    categoryDistricts.sort((a, b) => stages.indexOf(a.stage) - stages.indexOf(b.stage));

    for (const district of categoryDistricts) {
      // Calculate block dimensions based on building count
      const buildingCount = district.buildings.length;
      const cols = Math.min(buildingCount, this.buildingsPerRow);
      const rows = Math.ceil(buildingCount / this.buildingsPerRow);

      // Arrange buildings (grid-aligned start positions)
      this.arrangeGridLayout(district, currentX, startZ);

      // Calculate actual bounds (snap to grid)
      const avgBuildingSize = this.gridSize;
      const blockWidth = this.snapToGrid(cols * (avgBuildingSize + this.buildingSpacing));
      const blockDepth = this.snapToGrid(rows * (avgBuildingSize + this.buildingSpacing));

      district.bounds = {
        x: currentX,
        z: startZ,
        width: Math.max(blockWidth, this.gridSize),
        depth: Math.max(blockDepth, this.gridSize),
      };
      maxX = Math.max(maxX, district.bounds.x + district.bounds.width);

      currentX = this.snapToGrid(currentX + blockWidth + this.stageGap);
      maxDepthInCategory = Math.max(maxDepthInCategory, blockDepth);
    }

    return {
      category,
      districts: categoryDistricts,
      minX: startX,
      minZ: startZ,
      width: maxX - startX,
      depth: Math.max(maxDepthInCategory, this.gridSize),
    };
  }

  /**
   * LAY-001: pack category blocks into rows ("shelves") toward a target
   * width:depth, instead of one category per row — seven districts used to
   * make a strip ~3x deeper than wide. Every candidate shelf width is tried
   * and the one whose footprint aspect is closest to the target wins (ties:
   * the smaller footprint). Deepest blocks go first so rows stay even.
   * Deterministic: same projects, same layout.
   */
  private packShelves(categories: string[], districts: Map<string, District>, targetAspect: number): void {
    // Lay every category out at the origin first, to measure it.
    const blocks: CategoryBlock[] = [];
    for (const category of categories) {
      const block = this.layoutCategory(category, districts, this.gridSize, this.gridSize);
      if (block) blocks.push(block);
    }
    if (blocks.length === 0) return;

    blocks.sort((a, b) => b.depth - a.depth || a.category.localeCompare(b.category));

    const total = blocks.reduce((sum, b) => sum + b.width, 0) + this.shelfGapX * (blocks.length - 1);
    const widest = Math.max(...blocks.map((b) => b.width));
    let best: { rows: CategoryBlock[][]; score: number; area: number } | null = null;
    for (let limit = widest; limit <= total + this.gridSize; limit += this.gridSize) {
      const rows = this.shelfRows(blocks, limit);
      const { width, depth } = this.shelfExtent(rows);
      const score = Math.abs(Math.log(width / depth / targetAspect));
      const area = width * depth;
      if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) <= 1e-9 && area < best.area)) {
        best = { rows, score, area };
      }
    }

    // Place: rows top to bottom (Z), blocks left to right (X), on the grid.
    let z = 0;
    for (const row of best!.rows) {
      let x = 0;
      let rowDepth = 0;
      for (const block of row) {
        this.translateBlock(block, this.snapToGrid(x), this.snapToGrid(z));
        x += block.width + this.shelfGapX;
        rowDepth = Math.max(rowDepth, block.depth);
      }
      z += rowDepth + this.blockGap;
    }
  }

  /** Greedy rows no wider than `limit` (a block wider than the limit gets its own row). */
  private shelfRows(blocks: CategoryBlock[], limit: number): CategoryBlock[][] {
    const rows: CategoryBlock[][] = [];
    let row: CategoryBlock[] = [];
    let width = 0;
    for (const block of blocks) {
      const next = row.length === 0 ? block.width : width + this.shelfGapX + block.width;
      if (row.length > 0 && next > limit) {
        rows.push(row);
        row = [block];
        width = block.width;
      } else {
        row.push(block);
        width = next;
      }
    }
    if (row.length > 0) rows.push(row);
    return rows;
  }

  private shelfExtent(rows: CategoryBlock[][]): { width: number; depth: number } {
    let width = 0;
    let depth = 0;
    rows.forEach((row, i) => {
      width = Math.max(width, row.reduce((s, b) => s + b.width, 0) + this.shelfGapX * (row.length - 1));
      depth += Math.max(...row.map((b) => b.depth)) + (i > 0 ? this.blockGap : 0);
    });
    return { width, depth: Math.max(depth, 1) };
  }

  /** Move a block laid out at its own origin to (x, z). */
  private translateBlock(block: CategoryBlock, x: number, z: number): void {
    const dx = x - block.minX;
    const dz = z - block.minZ;
    for (const district of block.districts) {
      district.bounds.x += dx;
      district.bounds.z += dz;
      for (const building of district.buildings) {
        if (!building.position) continue;
        building.position.x += dx;
        building.position.z += dz;
      }
    }
    block.minX = x;
    block.minZ = z;
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
