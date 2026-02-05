/** Core data model for a project parsed from vault metadata */
export interface ProjectData {
  /** File path in the vault */
  path: string;
  /** Display title */
  title: string;
  /** Project status: active, blocked, paused, complete */
  status: string;
  /** Priority level: critical, high, medium, low */
  priority: string;
  /** Project stage: backlog, active, paused, complete */
  stage: string;
  /** Category/domain: work, personal, art, etc. */
  category: string;
  /** Scope/complexity score (e.g. note count or subtask count) */
  scope: number;
  /** Last modified timestamp (ms) */
  lastModified: number;
  /** Whether the project has recent activity */
  recentActivity: boolean;
  /** Health percentage 0-100 */
  health: number;
  /** Number of notes in the project */
  noteCount: number;
  /** Tech stack (e.g. ["Three.js", "TypeScript", "Vite"]) */
  stack?: string[];

  // Populated by layout engine
  position?: { x: number; y: number; z: number };
  dimensions?: { width: number; height: number; depth: number };
}

/** A district groups projects sharing the same stage + category */
export interface District {
  stage: string;
  category: string;
  buildings: ProjectData[];
  bounds: Bounds;
}

/** Bounding rectangle for a district zone */
export interface Bounds {
  x: number;
  z: number;
  width: number;
  depth: number;
}
