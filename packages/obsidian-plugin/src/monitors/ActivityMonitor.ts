import { App } from 'obsidian';

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

/** One agent's presence when the status file carries a fleet (agents array) */
export interface AgentPresence {
  id: string;
  name?: string;
  project: string | null;
  action: string | null;
  lastPing: number;
  active: boolean;
}

export interface ActivityCallbacks {
  onActivityStart?: (status: ActivityStatus) => void;
  onActivityUpdate?: (status: ActivityStatus) => void;
  onActivityStop?: () => void;
  onProjectChange?: (newProject: string | null, oldProject: string | null) => void;
  /** Called every poll with all fresh (active, recently pinged) agents */
  onFleetUpdate?: (agents: AgentPresence[]) => void;
}

/**
 * Monitors Claude Code activity via heartbeat status file.
 * Watches .hypernovum-status.json in vault root for real-time updates.
 */
export class ActivityMonitor {
  private app: App;
  private callbacks: ActivityCallbacks;
  private pollInterval: number;
  private idleTimeout: number;
  private pollTimer: number | null = null;
  private lastStatus: ActivityStatus | null = null;
  private isActive = false;
  private statusFilePath = '.hypernovum-status.json';

  constructor(
    app: App,
    callbacks: ActivityCallbacks,
    options?: {
      pollInterval?: number;  // How often to check file (ms)
      idleTimeout?: number;   // How long before considering idle (ms)
    }
  ) {
    this.app = app;
    this.callbacks = callbacks;
    this.pollInterval = options?.pollInterval ?? 500;  // Check every 500ms
    this.idleTimeout = options?.idleTimeout ?? 10000;  // Idle after 10s of no updates (Claude thinks between tool calls)
  }

  /** Start monitoring for activity */
  start(): void {
    if (this.pollTimer !== null) return;

    this.pollTimer = window.setInterval(() => this.poll(), this.pollInterval);

    // Initial poll
    this.poll();
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
      const raw = await this.readStatusFile();
      const now = Date.now();

      // Fleet extraction: agents array (multi-agent) or legacy single object
      const agents = this.extractAgents(raw);
      const fresh = agents.filter((a) => a.active && now - a.lastPing <= this.idleTimeout);
      this.callbacks.onFleetUpdate?.(fresh);

      if (fresh.length === 0) {
        if (this.isActive) {
          this.transitionToIdle();
        }
        return;
      }

      // Primary agent drives the legacy single-status callbacks
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

    } catch (err) {
      // File read error - ignore, might not exist yet
    }
  }

  /** Transition from active to idle state */
  private transitionToIdle(): void {
    this.isActive = false;
    this.lastStatus = null;
    this.callbacks.onActivityStop?.();
  }

  /** Normalize the status file into a list of agent presences */
  private extractAgents(raw: any): AgentPresence[] {
    if (!raw) return [];
    if (Array.isArray(raw.agents)) {
      return raw.agents.map((a: any, i: number) => ({
        id: String(a.id ?? `agent-${i}`),
        name: typeof a.name === 'string' ? a.name : undefined,
        project: typeof a.project === 'string' ? a.project : null,
        action: typeof a.action === 'string' ? a.action : null,
        lastPing: Number(a.lastPing) || 0,
        active: a.active !== false,
      }));
    }
    return [{
      id: 'default',
      project: typeof raw.project === 'string' ? raw.project : null,
      action: typeof raw.action === 'string' ? raw.action : null,
      lastPing: Number(raw.lastPing) || 0,
      active: raw.active !== false,
    }];
  }

  /** Read and parse the status file (uses vault adapter to bypass file index) */
  private async readStatusFile(): Promise<any | null> {
    try {
      // Use vault adapter for direct disk access — getAbstractFileByPath() may not
      // index externally-created files (heartbeat.js writes directly to filesystem)
      const exists = await this.app.vault.adapter.exists(this.statusFilePath);
      if (!exists) return null;

      const content = await this.app.vault.adapter.read(this.statusFilePath);
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /** Get current activity state */
  isCurrentlyActive(): boolean {
    return this.isActive;
  }

  /** Get last known status */
  getLastStatus(): ActivityStatus | null {
    return this.lastStatus;
  }

  /** Manually trigger activity (for testing) */
  simulateActivity(project: string, action: string = 'testing'): void {
    const status: ActivityStatus = {
      active: true,
      project,
      action,
      lastPing: Date.now()
    };

    this.lastStatus = status;
    this.isActive = true;
    this.callbacks.onActivityStart?.(status);
  }

  /** Manually stop activity (for testing) */
  simulateStop(): void {
    this.transitionToIdle();
  }
}
