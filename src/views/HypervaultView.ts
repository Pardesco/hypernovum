import { ItemView, WorkspaceLeaf, App, Notice } from 'obsidian';
import { SceneManager } from './SceneManager';
import { ProjectParser } from '../parsers/ProjectParser';
import { MetadataExtractor } from '../parsers/MetadataExtractor';
import { BinPacker } from '../layout/BinPacker';
import { BuildingRaycaster } from '../interactions/Raycaster';
import { KeyboardNav } from '../interactions/KeyboardNav';
import type { HypervaultSettings, BlockPosition } from '../settings/SettingsTab';
import type { ProjectData } from '../types';
import type HypervaultPlugin from '../main';

export const VIEW_TYPE = 'hypervault-view';

export class HypervaultView extends ItemView {
  private plugin: HypervaultPlugin;
  private sceneManager: SceneManager | null = null;
  private parser: ProjectParser;
  private binPacker: BinPacker;
  private metadataExtractor: MetadataExtractor | null = null;
  private raycaster: BuildingRaycaster | null = null;
  private keyboardNav: KeyboardNav | null = null;
  private projects: ProjectData[] = [];

  constructor(leaf: WorkspaceLeaf, app: App, plugin: HypervaultPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.parser = new ProjectParser(app);
    this.binPacker = new BinPacker();
  }

  get settings(): HypervaultSettings {
    return this.plugin.settings;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Hypervault';
  }

  getIcon(): string {
    return 'box';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('hypervault-container');

    // Initialize 3D scene with save callback and settings
    this.sceneManager = new SceneManager(container, {
      savedPositions: this.settings.blockPositions,
      onSaveLayout: (positions) => this.saveLayout(positions),
      settings: this.settings,
    });

    // Add legend overlay
    this.addLegend(container);

    // Add controls hint
    this.addControlsHint(container);

    // Add save layout button
    this.addSaveButton(container);

    // Set up raycaster for click-to-navigate
    this.raycaster = new BuildingRaycaster(
      this.sceneManager.getCamera(),
      this.sceneManager.getScene(),
      this.sceneManager.getCanvas(),
    );
    this.raycaster.setClickHandler((hit) => {
      // Open the clicked project's note in Obsidian
      this.app.workspace.openLinkText(hit.project.path, '', false);
    });

    // Set up focus-safe keyboard navigation
    this.keyboardNav = new KeyboardNav(this.sceneManager.getCanvas());
    this.keyboardNav.setHandlers({
      onCycleBlocked: () => this.cycleByStatus('blocked'),
      onCycleStale: () => this.cycleByStatus('paused'),
      onResetCamera: () => this.sceneManager?.resetCamera(),
    });

    // Parse projects and build city
    await this.buildCity();

    // Watch for vault changes and rebuild on update
    this.metadataExtractor = new MetadataExtractor(
      this.app,
      () => this.buildCity(),
      2000,
    );
    this.metadataExtractor.startWatching();
  }

  async onClose(): Promise<void> {
    this.metadataExtractor?.stopWatching();
    this.keyboardNav?.dispose();

    if (this.sceneManager) {
      this.sceneManager.dispose();
      this.sceneManager = null;
    }
  }

  private async buildCity(): Promise<void> {
    // Parse vault metadata into project data
    this.projects = await this.parser.parseProjects(this.settings);

    // Run bin-packing layout
    const districts = this.binPacker.packDistricts(this.projects);

    // Create buildings in scene
    if (this.sceneManager) {
      this.sceneManager.buildCity(this.projects, districts);
    }
  }

  private cycleByStatus(status: string): void {
    const matching = this.projects.filter((p) => p.status === status);
    if (matching.length === 0 || !this.sceneManager) return;

    // Cycle through matching projects
    const current = this.sceneManager.getFocusedProject();
    let nextIndex = 0;
    if (current) {
      const currentIdx = matching.findIndex((p) => p.path === current.path);
      if (currentIdx >= 0) {
        nextIndex = (currentIdx + 1) % matching.length;
      }
    }

    const target = matching[nextIndex];
    if (target.position) {
      this.sceneManager.focusOnPosition(target.position);
      this.sceneManager.setFocusedProject(target);
    }
  }

  private addLegend(container: HTMLElement): void {
    const legend = document.createElement('div');
    legend.className = 'hypervault-legend';
    legend.innerHTML = `
      <div class="hypervault-legend-section">
        <h4>Status (Color)</h4>
        <div class="hypervault-legend-item">
          <div class="hypervault-legend-color active"></div>
          <span>Active</span>
        </div>
        <div class="hypervault-legend-item">
          <div class="hypervault-legend-color blocked"></div>
          <span>Blocked</span>
        </div>
        <div class="hypervault-legend-item">
          <div class="hypervault-legend-color paused"></div>
          <span>Paused</span>
        </div>
        <div class="hypervault-legend-item">
          <div class="hypervault-legend-color complete"></div>
          <span>Complete</span>
        </div>
      </div>
      <div class="hypervault-legend-section">
        <h4>Priority (Height)</h4>
        <div class="hypervault-legend-item">
          <div class="hypervault-legend-height">
            <div class="hypervault-legend-bar" style="height: 16px;"></div>
          </div>
          <span>Critical</span>
        </div>
        <div class="hypervault-legend-item">
          <div class="hypervault-legend-height">
            <div class="hypervault-legend-bar" style="height: 10px;"></div>
          </div>
          <span>High</span>
        </div>
        <div class="hypervault-legend-item">
          <div class="hypervault-legend-height">
            <div class="hypervault-legend-bar" style="height: 6px;"></div>
          </div>
          <span>Medium</span>
        </div>
        <div class="hypervault-legend-item">
          <div class="hypervault-legend-height">
            <div class="hypervault-legend-bar" style="height: 3px;"></div>
          </div>
          <span>Low</span>
        </div>
      </div>
    `;
    container.appendChild(legend);
  }

  private addControlsHint(container: HTMLElement): void {
    const controls = document.createElement('div');
    controls.className = 'hypervault-controls';
    controls.innerHTML = `
      <kbd>Click</kbd> Open note<br>
      <kbd>Right-drag</kbd> Pan<br>
      <kbd>Scroll</kbd> Zoom
    `;
    container.appendChild(controls);
  }

  private addSaveButton(container: HTMLElement): void {
    const saveBtn = document.createElement('button');
    saveBtn.className = 'hypervault-save-btn';
    saveBtn.textContent = 'Save Layout';
    saveBtn.addEventListener('click', () => {
      if (this.sceneManager) {
        this.sceneManager.triggerSave();
      }
    });
    container.appendChild(saveBtn);
  }

  private async saveLayout(positions: BlockPosition[]): Promise<void> {
    this.plugin.settings.blockPositions = positions;
    await this.plugin.saveSettings();
    new Notice('City layout saved!');
  }
}
