import { ItemView, WorkspaceLeaf, App } from 'obsidian';
import { SceneManager } from './SceneManager';
import { ProjectParser } from '../parsers/ProjectParser';
import { BinPacker } from '../layout/BinPacker';
import { VisualEncoder } from '../renderers/VisualEncoder';
import { CityMapController } from '../interactions/MapController';
import { KeyboardNav } from '../interactions/KeyboardNav';
import { Raycaster } from '../interactions/Raycaster';
import type { HypervaultSettings } from '../settings/SettingsTab';
import type { ProjectData } from '../types';

export const VIEW_TYPE = 'hypervault-view';

export class HypervaultView extends ItemView {
  private settings: HypervaultSettings;
  private sceneManager: SceneManager | null = null;
  private parser: ProjectParser;
  private binPacker: BinPacker;

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

    // Parse projects and build city
    await this.buildCity();
  }

  async onClose(): Promise<void> {
    if (this.sceneManager) {
      this.sceneManager.dispose();
      this.sceneManager = null;
    }
  }

  private async buildCity(): Promise<void> {
    // Parse vault metadata into project data
    const projects = await this.parser.parseProjects(this.settings);

    // Run bin-packing layout
    const districts = this.binPacker.packDistricts(projects);

    // Create buildings in scene
    if (this.sceneManager) {
      this.sceneManager.buildCity(projects, districts);
    }
  }
}
