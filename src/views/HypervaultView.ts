import { ItemView, WorkspaceLeaf, App } from 'obsidian';
import { SceneManager } from './SceneManager';
import { ProjectParser } from '../parsers/ProjectParser';
import { MetadataExtractor } from '../parsers/MetadataExtractor';
import { BinPacker } from '../layout/BinPacker';
import { BuildingRaycaster } from '../interactions/Raycaster';
import { KeyboardNav } from '../interactions/KeyboardNav';
import type { HypervaultSettings } from '../settings/SettingsTab';
import type { ProjectData } from '../types';

export const VIEW_TYPE = 'hypervault-view';

export class HypervaultView extends ItemView {
  private settings: HypervaultSettings;
  private sceneManager: SceneManager | null = null;
  private parser: ProjectParser;
  private binPacker: BinPacker;
  private metadataExtractor: MetadataExtractor | null = null;
  private raycaster: BuildingRaycaster | null = null;
  private keyboardNav: KeyboardNav | null = null;
  private projects: ProjectData[] = [];

  constructor(leaf: WorkspaceLeaf, app: App, settings: HypervaultSettings) {
    super(leaf);
    this.settings = settings;
    this.parser = new ProjectParser(app);
    this.binPacker = new BinPacker();
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

    // Initialize 3D scene
    this.sceneManager = new SceneManager(container);

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
}
