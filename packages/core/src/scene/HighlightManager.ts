import * as THREE from 'three';
import type { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { ProjectData, WeatherData } from '../types';
import type { InteractionStore } from '../stores/interactionStore';
import { resolveVisualState, type VisualState } from './visualState';

/**
 * Per-building scene object registry entry. Populated by
 * SceneManager.createBuilding; consumed by HighlightManager (state
 * application) and animate() (time modulation around applied baselines).
 */
export interface BuildingParts {
  path: string;
  project: ProjectData;
  building: THREE.Mesh;
  shaderMaterial: THREE.ShaderMaterial | null;
  edgeGlow: THREE.LineSegments;
  foundation: THREE.Mesh;
  foundationWireframe: THREE.LineSegments;
  label: CSS2DObject | null;
  /** Last applied visual state — animate() reads baselines from here */
  state: VisualState | null;
}

const FOUNDATION_BASE = 0x2a2a3a;
const FOUNDATION_HOVER = 0x3a3a5a;
const FOUNDATION_HOVER_EMISSIVE = 0x1a1a2a;

/**
 * The ONLY writer of building material values (color, emissive, opacity,
 * scale, edge-glow). Resolves composed VisualState per building on state
 * CHANGES (never per frame) and applies it to fallback materials, shader
 * uniforms, edge glows, foundations, and label CSS.
 */
export class HighlightManager {
  private parts: Map<string, BuildingParts>;
  private store: InteractionStore | null;
  private weather = new Map<string, WeatherData>();
  private lensColors: Map<string, number> | null = null;
  private connectedPaths = new Set<string>();
  private bloom: boolean;
  /** Dim-unrelated focus pass while a selection or trace overlay is active */
  focusDimEnabled = true;
  private unsubscribe: (() => void) | null = null;

  constructor(
    parts: Map<string, BuildingParts>,
    store: InteractionStore | null,
    options?: { bloom?: boolean },
  ) {
    this.parts = parts;
    this.store = store;
    this.bloom = options?.bloom ?? false;

    if (store) {
      this.unsubscribe = store.subscribe((s, prev) => {
        if (s.hoveredPath !== prev.hoveredPath) {
          this.refresh(prev.hoveredPath);
          this.refresh(s.hoveredPath);
        }
        // Selection and move mode affect the dim state of every building
        if (s.selectedPath !== prev.selectedPath || s.moveModePath !== prev.moveModePath) {
          this.refreshAll();
        }
      });
    }
  }

  setWeather(path: string, weather: WeatherData | null): void {
    if (weather) this.weather.set(path, weather);
    else this.weather.delete(path);
    this.refresh(path);
  }

  getWeather(path: string): WeatherData | undefined {
    return this.weather.get(path);
  }

  clearAllWeather(): void {
    this.weather.clear();
  }

  /** Lens color map (data-visualization layers). Null restores status colors. */
  setLensColors(colors: Map<string, number> | null): void {
    this.lensColors = colors;
    this.refreshAll();
  }

  /** Paths considered connected to the current selection (edge neighbors) */
  setConnectedPaths(paths: Set<string>): void {
    this.connectedPaths = paths;
    this.refreshAll();
  }

  refresh(path: string | null | undefined): void {
    if (!path) return;
    const entry = this.parts.get(path);
    if (!entry) return;
    this.apply(entry, this.resolveFor(entry));
  }

  refreshAll(): void {
    for (const entry of this.parts.values()) {
      this.apply(entry, this.resolveFor(entry));
    }
  }

  private resolveFor(entry: BuildingParts): VisualState {
    const s = this.store?.getState();
    const selected = s?.selectedPath === entry.path;
    const hovered = s?.hoveredPath === entry.path;
    const moveMode = s?.moveModePath === entry.path;
    const connected = this.connectedPaths.has(entry.path);
    const focusActive = this.focusDimEnabled && !!(s?.selectedPath || s?.traceImpact);
    const dimmed = focusActive && !selected && !hovered && !connected && !moveMode;

    const weather = this.weather.get(entry.path) ?? null;
    return resolveVisualState({
      status: entry.project.status,
      lensColor: this.lensColors?.get(entry.path) ?? null,
      weather,
      decayFactor: weather
        ? HighlightManager.timeDecay(weather.lastCommitDate)
        : HighlightManager.timeDecay(entry.project.lastModified),
      litPercent: HighlightManager.litPercent(entry.project),
      hovered,
      selected,
      connected,
      dimmed,
      moveMode,
      bloom: this.bloom,
    });
  }

  private apply(entry: BuildingParts, vs: VisualState): void {
    entry.state = vs;

    // --- Building material ---
    if (entry.shaderMaterial) {
      const u = entry.shaderMaterial.uniforms;
      (u.uColor.value as THREE.Color).setHex(vs.baseColor);
      u.uGlitch.value = vs.glitch;
      u.uDecay.value = vs.decay;
      u.uLitPercent.value = vs.litPercent;
      if (u.uDimFactor) u.uDimFactor.value = vs.dimFactor;
    } else {
      const mat = entry.building.material as THREE.MeshStandardMaterial;
      mat.color.setHex(vs.baseColor);
      mat.emissive.setHex(vs.emissiveColor);
      mat.emissiveIntensity = vs.emissiveBase;
      const wantTransparent = vs.opacity < 1;
      if (mat.transparent !== wantTransparent) {
        mat.transparent = wantTransparent;
        mat.needsUpdate = true;
      }
      mat.opacity = vs.opacity;
    }
    entry.building.scale.setScalar(vs.scale);

    // --- Edge glow ---
    const eg = entry.edgeGlow.material as THREE.LineBasicMaterial;
    eg.color.setHex(vs.baseColor).multiplyScalar(vs.edgeGlowColorScale);
    eg.opacity = vs.edgeGlowOpacity;

    // --- Foundation plinth ---
    const fm = entry.foundation.material as THREE.MeshStandardMaterial;
    if (vs.foundationBright) {
      fm.color.setHex(FOUNDATION_HOVER);
      fm.emissive.setHex(FOUNDATION_HOVER_EMISSIVE);
      fm.emissiveIntensity = 0.5;
    } else {
      fm.color.setHex(FOUNDATION_BASE);
      const tint = new THREE.Color(vs.baseColor).multiplyScalar(0.15);
      fm.color.add(tint);
      fm.emissive.setHex(0x000000);
    }
    const wantFTransparent = vs.opacity < 1;
    if (fm.transparent !== wantFTransparent) {
      fm.transparent = wantFTransparent;
      fm.needsUpdate = true;
    }
    fm.opacity = vs.opacity;

    const fw = entry.foundationWireframe.material as THREE.LineBasicMaterial;
    fw.opacity = 0.65 * vs.dimFactor;

    // --- Label ---
    if (entry.label) {
      entry.label.element.classList.toggle('hv-label-dimmed', vs.labelTier === 'hidden');
    }
  }

  /** Time-based decay tiers (previously inline in SceneManager.applyWeather) */
  static timeDecay(lastActivityMs: number): number {
    if (!lastActivityMs || lastActivityMs <= 0) return 0;
    const daysSince = (Date.now() - lastActivityMs) / (1000 * 60 * 60 * 24);
    if (daysSince <= 5) return 0.0;
    if (daysSince <= 14) return ((daysSince - 5) / 9) * 0.4;
    if (daysSince <= 30) return 0.4 + ((daysSince - 14) / 16) * 0.45;
    return Math.min(0.85 + ((daysSince - 30) / 60) * 0.15, 1.0);
  }

  /** Window-fill ratio (previously BuildingShader.calculateLitPercent) */
  static litPercent(project: ProjectData): number {
    if (project.totalTasks && project.totalTasks > 0) {
      return (project.completedTasks ?? 0) / project.totalTasks;
    }
    return project.recentActivity ? 0.6 : 0.1;
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.weather.clear();
    this.connectedPaths.clear();
    this.lensColors = null;
  }
}
