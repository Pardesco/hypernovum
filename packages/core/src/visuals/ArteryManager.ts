import * as THREE from 'three';
import { DataArtery } from './DataArtery';
import { NeuralCore } from './NeuralCore';
import type { CityState } from '../types';

interface ArteryManagerOptions {
  scene: THREE.Scene;
  maxArteries?: number;
  debounceMs?: number;
}

interface ActiveArtery {
  artery: DataArtery;
  path: string;
}

/** Manages lifecycle of data arteries between Neural Core and buildings */
export class ArteryManager {
  private scene: THREE.Scene;
  private activeArteries: Set<ActiveArtery> = new Set();
  private debounceTimers: Map<string, number> = new Map();
  private maxArteries: number;
  private debounceMs: number;

  // Persistent streaming state
  private streamingArtery: DataArtery | null = null;
  private streamingPath: string | null = null;
  private isStreaming = false;

  constructor(options: ArteryManagerOptions) {
    this.scene = options.scene;
    this.maxArteries = options.maxArteries ?? 20;
    this.debounceMs = options.debounceMs ?? 500;
  }

  /** Spawn an artery from core to building position (debounced per path) */
  spawnArtery(
    core: NeuralCore,
    buildingPosition: THREE.Vector3,
    path: string,
    buildingHeight: number = 10
  ): DataArtery | null {
    // Debounce check - don't spawn if recently spawned for this path
    const lastSpawn = this.debounceTimers.get(path);
    const now = performance.now();
    if (lastSpawn && now - lastSpawn < this.debounceMs) {
      return null;
    }

    // Max arteries check
    if (this.activeArteries.size >= this.maxArteries) {
      // Remove oldest artery to make room
      const oldest = this.activeArteries.values().next().value;
      if (oldest) {
        this.removeArtery(oldest);
      }
    }

    // Set debounce timer
    this.debounceTimers.set(path, now);

    // Calculate start and end points
    const startPoint = core.getConnectionPoint();
    const endPoint = buildingPosition.clone();
    endPoint.y = buildingHeight + 1; // Top of building + small offset

    // Create artery with color based on current state
    const stateColors: Record<CityState, number> = {
      IDLE: 0x00ffff,
      STREAMING: 0x00ffff,
      BULK_UPDATE: 0xffaa00,
      ERROR: 0xff4444,
    };

    const artery = new DataArtery({
      startPoint,
      endPoint,
      color: stateColors[core.getState()],
      duration: 3000, // 3 second animation
    });

    this.scene.add(artery);
    this.activeArteries.add({ artery, path });

    return artery;
  }

  /** Update all arteries, remove finished ones */
  update(delta: number, elapsed: number): void {
    // Update persistent streaming artery
    if (this.streamingArtery) {
      this.streamingArtery.update(delta, elapsed);
    }

    // Update and clean up regular arteries
    const toRemove: ActiveArtery[] = [];

    for (const entry of this.activeArteries) {
      const isActive = entry.artery.update(delta, elapsed);
      if (!isActive) {
        toRemove.push(entry);
      }
    }

    for (const entry of toRemove) {
      this.removeArtery(entry);
    }
  }

  /** Start persistent streaming to a building */
  startStream(
    core: NeuralCore,
    buildingPosition: THREE.Vector3,
    path: string,
    buildingHeight: number = 10
  ): void {
    // If already streaming to this path, do nothing
    if (this.streamingPath === path && this.streamingArtery) {
      return;
    }

    // Stop any existing stream
    this.stopStream();

    const startPoint = core.getConnectionPoint();
    const endPoint = buildingPosition.clone();
    endPoint.y = buildingHeight + 1;

    this.streamingArtery = new DataArtery({
      startPoint,
      endPoint,
      color: 0x00ffff,
      persistent: true,
    });

    this.scene.add(this.streamingArtery);
    this.streamingPath = path;
    this.isStreaming = true;
  }

  /** Stop persistent streaming */
  stopStream(): void {
    if (this.streamingArtery) {
      this.streamingArtery.fadeOut();
      // Move to regular arteries set for cleanup
      this.activeArteries.add({
        artery: this.streamingArtery,
        path: this.streamingPath || 'stream',
      });
      this.streamingArtery = null;
      this.streamingPath = null;
      this.isStreaming = false;
    }
  }

  /** Check if currently streaming */
  getIsStreaming(): boolean {
    return this.isStreaming;
  }

  /** Get the path currently being streamed to */
  getStreamingPath(): string | null {
    return this.streamingPath;
  }

  /** Get current city state based on activity */
  getCityState(): CityState {
    // Streaming takes precedence
    if (this.isStreaming) return 'STREAMING';

    const count = this.activeArteries.size;
    if (count === 0) return 'IDLE';
    if (count >= 5) return 'BULK_UPDATE';
    return 'STREAMING';
  }

  /** Get count of active arteries (excluding persistent stream) */
  getActiveCount(): number {
    return this.activeArteries.size + (this.isStreaming ? 1 : 0);
  }

  /** Remove and cleanup an artery */
  private removeArtery(entry: ActiveArtery): void {
    this.scene.remove(entry.artery);
    entry.artery.dispose();
    this.activeArteries.delete(entry);
  }

  /** Cleanup all arteries and resources */
  dispose(): void {
    for (const entry of this.activeArteries) {
      this.scene.remove(entry.artery);
      entry.artery.dispose();
    }
    this.activeArteries.clear();
    this.debounceTimers.clear();
  }
}
