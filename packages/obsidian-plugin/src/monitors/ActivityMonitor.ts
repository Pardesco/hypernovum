import { App } from 'obsidian';
import {
  type AgentPresence,
  mergeFleet,
  parseSnapshotToPresence,
} from './fleetMerge';

export type { AgentPresence } from './fleetMerge';

/** Status file format written by heartbeat script */
export interface ActivityStatus {
  active: boolean;
  project: string | null;
  action: string | null;
  tool?: string | null;
  file?: string | null;
  lastPing: number;
  stoppedAt?: number;
}

export interface ActivityCallbacks {
  onActivityStart?: (status: ActivityStatus) => void;
  onActivityUpdate?: (status: ActivityStatus) => void;
  onActivityStop?: () => void;
  onProjectChange?: (newProject: string | null, oldProject: string | null) => void;
  /**
   * Called every poll with the full fleet, freshest-first, capped. Includes
   * stale/complete sessions so the registry (AGT-003) can drive the §10
   * lifecycle; consumers filter as needed.
   */
  onFleetUpdate?: (agents: AgentPresence[]) => void;
  /** Called when unreadable snapshot files were skipped this poll (degraded data). */
  onDegradedData?: (skippedCount: number) => void;
}

/**
 * Monitors agent activity via the heartbeat snapshots the hooks write to
 * <vault>/.hypernovum/agents/*.json.
 */
export class ActivityMonitor {
  private app: App;
  private callbacks: ActivityCallbacks;
  private pollInterval: number;
  private idleTimeout: number;
  private pollTimer: number | null = null;
  private lastStatus: ActivityStatus | null = null;
  private isActive = false;
  private agentsDirPath = '.hypernovum/agents';

  /**
   * Hands the interval id to the owning Component so Obsidian clears it even if
   * stop() is somehow missed — `registerInterval` is the documented lifecycle hook.
   */
  private registerInterval?: (id: number) => void;

  constructor(
    app: App,
    callbacks: ActivityCallbacks,
    options?: {
      pollInterval?: number;  // How often to check file (ms)
      idleTimeout?: number;   // How long before considering idle (ms)
      /** Usually `(id) => view.registerInterval(id)`. */
      registerInterval?: (id: number) => void;
    }
  ) {
    this.app = app;
    this.callbacks = callbacks;
    this.pollInterval = options?.pollInterval ?? 500;  // Check every 500ms
    this.idleTimeout = options?.idleTimeout ?? 10000;  // Idle after 10s of no updates (Claude thinks between tool calls)
    this.registerInterval = options?.registerInterval;
  }

  /** Start monitoring for activity */
  start(): void {
    if (this.pollTimer !== null) return;

    this.pollTimer = window.setInterval(() => { void this.poll(); }, this.pollInterval);
    this.registerInterval?.(this.pollTimer);

    // Initial poll
    void this.poll();
  }

  /** Stop monitoring */
  stop(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Check current activity status */
  private async poll(): Promise<void> {
    try {
      const now = Date.now();

      // Per-session snapshots in .hypernovum/agents/*.json
      const { presences, skipped } = await this.readAgentSnapshots();

      const agents = mergeFleet(presences);
      // Emit every poll (incl. 0) so consumers can clear a prior degraded state.
      this.callbacks.onDegradedData?.(skipped);

      // Full fleet (incl. stale/complete) drives the registry (AGT-003).
      this.callbacks.onFleetUpdate?.(agents);

      // Single-status callbacks + activity indicator use fresh only.
      const fresh = agents.filter((a) => a.active && now - a.lastPing <= this.idleTimeout);

      if (fresh.length === 0) {
        if (this.isActive) {
          this.transitionToIdle();
        }
        return;
      }

      // Primary agent drives the single-status callbacks
      const primary = fresh[0];
      const status: ActivityStatus = {
        active: true,
        project: primary.project,
        action: fresh.length > 1 ? `${fresh.length} agents active` : primary.action,
        lastPing: primary.lastPing,
      };

      // Active status with recent ping
      const wasActive = this.isActive;
      const oldProject = this.lastStatus?.project ?? null;
      const newProject = status.project;

      this.lastStatus = status;
      this.isActive = true;

      if (!wasActive) {
        // Just became active
        this.callbacks.onActivityStart?.(status);
      } else {
        // Still active - send update
        this.callbacks.onActivityUpdate?.(status);
      }

      // Check for project change
      if (oldProject !== newProject) {
        this.callbacks.onProjectChange?.(newProject, oldProject);
      }

    } catch {
      // File read error - ignore, might not exist yet
    }
  }

  /** Transition from active to idle state */
  private transitionToIdle(): void {
    this.isActive = false;
    this.lastStatus = null;
    this.callbacks.onActivityStop?.();
  }

  /**
   * List and parse .hypernovum/agents/*.json into presences. Unparseable
   * files are skipped and counted (degraded-data signal). Directory absent →
   * empty (no agent hooks installed yet).
   */
  private async readAgentSnapshots(): Promise<{ presences: AgentPresence[]; skipped: number }> {
    const presences: AgentPresence[] = [];
    let skipped = 0;
    try {
      const exists = await this.app.vault.adapter.exists(this.agentsDirPath);
      if (!exists) return { presences, skipped };

      const listing = await this.app.vault.adapter.list(this.agentsDirPath);
      for (const filePath of listing.files) {
        if (!filePath.endsWith('.json')) continue;
        try {
          const content = await this.app.vault.adapter.read(filePath);
          const parsed: unknown = JSON.parse(content);
          const presence = parseSnapshotToPresence(parsed);
          if (presence) presences.push(presence);
          else skipped++;
        } catch {
          skipped++; // torn write / bad JSON / vanished mid-read — skip
        }
      }
    } catch {
      // adapter.list failed — treat as no v2 data this poll
    }
    return { presences, skipped };
  }

  /** Get current activity state */
  isCurrentlyActive(): boolean {
    return this.isActive;
  }

  /** Get last known status */
  getLastStatus(): ActivityStatus | null {
    return this.lastStatus;
  }
}
