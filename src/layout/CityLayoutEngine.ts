import { BinPacker } from './BinPacker';
import type { ProjectData, District } from '../types';

/**
 * High-level layout orchestrator.
 * Coordinates bin-packing with optional layout modes
 * (e.g., by stage, by category, or custom groupings).
 */
export class CityLayoutEngine {
  private binPacker: BinPacker;

  constructor() {
    this.binPacker = new BinPacker();
  }

  /**
   * Lay out all projects into a city grid.
   * Returns the district map for optional district labeling / debug rendering.
   */
  layout(projects: ProjectData[]): Map<string, District> {
    return this.binPacker.packDistricts(projects);
  }
}
