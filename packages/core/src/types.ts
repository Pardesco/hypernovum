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
  /** Total task count (from frontmatter or checkbox parsing) */
  totalTasks?: number;
  /** Completed task count */
  completedTasks?: number;
  /** Tech stack (e.g. ["Three.js", "TypeScript", "Vite"]) */
  stack?: string[];
  /** Open research questions — rendered as quest markers and published to agents */
  questions?: string[];
  /** Resolved research questions (moved from questions: by agents or the user) */
  answeredQuestions?: string[];
  /** Absolute path to project directory (for terminal launch) */
  projectDir?: string;
  /** True when .hypernovum/MEMORY_CONTEXT.md exists for this project */
  hasMemoryContext?: boolean;
  /** Absolute path to memory context file when present */
  memoryContextPath?: string;
  /** Last collected read-only Git activity for this project */
  gitActivity?: WeatherData;

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

/** City activity state for Neural Core visualization */
export type CityState = 'IDLE' | 'STREAMING' | 'BULK_UPDATE' | 'ERROR';

/** An undirected knowledge link between two projects (from vault backlinks) */
export interface LinkEdge {
  /** Project note path (endpoint A) */
  from: string;
  /** Project note path (endpoint B) */
  to: string;
  /** Combined link count between the two projects */
  count: number;
}

/** Saved block position for user-arranged city layout */
export interface BlockPosition {
  category: string;
  offsetX: number;
  offsetZ: number;
}

/** Shared settings interface consumed by core rendering engine */
export interface HypernovumSettings {
  /** Frontmatter tag that identifies a note as a project */
  projectTag: string;
  /** Show building labels */
  showLabels: boolean;
  /** Enable shadow rendering */
  enableShadows: boolean;
  /** Maximum buildings to render */
  maxBuildings: number;
  /** Saved block positions (user-arranged layout) */
  blockPositions: BlockPosition[];
  /** Enable procedural GPU shaders for buildings */
  enableShaders: boolean;
  /** Enable bloom post-processing glow */
  enableBloom: boolean;
  /** Bloom glow intensity (0.3-2.0) */
  bloomIntensity: number;
  /** Enable atmospheric fog effect */
  enableAtmosphere: boolean;
  /** Enable read-only local Git activity overlay */
  enableGitActivity: boolean;
  /** Building silhouette system: 'classic' (current) or 'parametric' (TowerLoft, opt-in) */
  buildingStyle: 'classic' | 'parametric';
}

/**
 * Git-derived weather data for a project.
 * Defined in core so SceneManager can consume it without importing from desktop.
 * The desktop's GitWeather interface is a superset of this.
 */
export interface WeatherData {
  /** Identifier matching ProjectData.path or ProjectData.projectDir */
  projectPath: string;
  /** Commits in last 7 days — drives churn/overheat */
  commitsLast7d: number;
  /** Commits in last 30 days */
  commitsLast30d: number;
  /** Timestamp (ms) of most recent commit */
  lastCommitDate: number;
  /** True if working tree has uncommitted changes */
  hasUncommittedChanges: boolean;
  /** True if .git/MERGE_HEAD exists — drives glitch effect */
  hasMergeConflicts: boolean;
  /** Number of branches with no commits in 60+ days — drives decay */
  staleBranchCount: number;
  /** Normalized churn score 0-100 */
  churnScore: number;
  /** Active branch name when available */
  activeBranch?: string;
}

/**
 * Single source of truth for status colors (the former shader palette).
 * SceneManager, BuildingShader, and HighlightManager must all read from here —
 * the classic fallback materials previously used a dimmer divergent palette.
 */
export const STATUS_COLORS: Record<string, number> = {
  active: 0x00ff88,
  blocked: 0xff4444,
  paused: 0x4488ff,
  complete: 0xaa88ff,
};

export const STATUS_COLOR_DEFAULT = 0x888888;

export function statusColor(status: string): number {
  return STATUS_COLORS[status] ?? STATUS_COLOR_DEFAULT;
}

/** Default settings values */
export const DEFAULT_SETTINGS: HypernovumSettings = {
  projectTag: 'project',
  showLabels: true,
  enableShadows: true,
  maxBuildings: 300,
  blockPositions: [],
  enableShaders: false,
  enableBloom: false,
  bloomIntensity: 0.8,
  enableAtmosphere: false,
  enableGitActivity: true,
  buildingStyle: 'classic',
};
