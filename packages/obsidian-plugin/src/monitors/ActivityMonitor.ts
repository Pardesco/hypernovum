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

export interface ActivityCallbacks {
  onActivityStart?: (status: ActivityStatus) => void;
  onActivityUpdate?: (status: ActivityStatus) => void;
  onActivityStop?: () => void;
  onProjectChange?: (newProject: string | null, oldProject: string | null) => void;
}

/**
 * Monitors Claude Code activity via heartbeat status file.
 * Watches .hypervault-status.json in vault root for real-time updates.
 */
export class ActivityMonitor {
  private app: App;
  private callbacks: ActivityCallbacks;
  private pollInterval: number;
  private idleTimeout: number;
  private pollTimer: number | null = null;
  private lastStatus: ActivityStatus | null = null;
  private isActive = false;
  private statusFilePath = '.hypervault-status.json';

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
    console.log('[Hypervault] Activity monitor started');

    // Initial poll
    this.poll();
  }

  /** Stop monitoring */
  stop(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[Hypervault] Activity monitor stopped');
  }

  /** Check current activity status */
  private async poll(): Promise<void> {
    try {
      const status = await this.readStatusFile();

      if (!status) {
        // No status file - treat as idle
        if (this.isActive) {
          this.transitionToIdle();
        }
        return;
      }

      const now = Date.now();
      const timeSinceLastPing = now - status.lastPing;

      // Check if we should consider this idle (stale ping)
      if (timeSinceLastPing > this.idleTimeout || !status.active) {
        if (this.isActive) {
          this.transitionToIdle();
        }
        return;
      }

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

  /** Read and parse the status file (uses vault adapter to bypass file index) */
  private async readStatusFile(): Promise<ActivityStatus | null> {
    try {
      // Use vault adapter for direct disk access — getAbstractFileByPath() may not
      // index externally-created files (heartbeat.js writes directly to filesystem)
      const exists = await this.app.vault.adapter.exists(this.statusFilePath);
      if (!exists) return null;

      const content = await this.app.vault.adapter.read(this.statusFilePath);
      return JSON.parse(content) as ActivityStatus;
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
