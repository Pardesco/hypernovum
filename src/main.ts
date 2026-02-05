import { Plugin } from 'obsidian';
import { HypervaultView, VIEW_TYPE } from './views/HypervaultView';
import { HypervaultSettings, DEFAULT_SETTINGS, SettingsTab } from './settings/SettingsTab';

export default class HypervaultPlugin extends Plugin {
  settings: HypervaultSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Register the 3D city view
    this.registerView(
      VIEW_TYPE,
      (leaf) => new HypervaultView(leaf, this.app, this),
    );

    // Ribbon icon
    this.addRibbonIcon('box', 'Open Hypervault', () => {
      this.activateView();
    });

    // Command palette entry
    this.addCommand({
      id: 'open-hypervault',
      name: 'Open Code City Dashboard',
      callback: () => this.activateView(),
    });

    // Settings tab
    this.addSettingTab(new SettingsTab(this.app, this));
  }

  async onunload(): Promise<void> {
    // View is automatically cleaned up by Obsidian
  }

  async activateView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);

    if (leaves.length === 0) {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE });
      }
    }

    const activeLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (activeLeaves.length > 0) {
      this.app.workspace.revealLeaf(activeLeaves[0]);
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
