import { Notice, Plugin } from 'obsidian';
import { HypernovumView, VIEW_TYPE } from './views/HypernovumView';
import { HypernovumSettings, DEFAULT_SETTINGS, SettingsTab } from './settings/SettingsTab';
import { ProjectParser } from './parsers/ProjectParser';
import { prepareVaultForAgents } from './utils/VaultAgentSetup';
import { scanSkills } from './utils/SkillsScanner';

export default class HypernovumPlugin extends Plugin {
  settings: HypernovumSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Register the 3D city view
    this.registerView(
      VIEW_TYPE,
      (leaf) => new HypernovumView(leaf, this.app, this),
    );

    // Ribbon icon
    this.addRibbonIcon('box', 'Open Hypernovum', () => {
      this.activateView();
    });

    // Command palette entry
    this.addCommand({
      id: 'open-hypernovum',
      name: 'Open Code City Dashboard',
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: 'prepare-vault-for-agents',
      name: 'Prepare vault for AI agents',
      callback: () => this.prepareVaultForAgents(),
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

  /** Write/refresh the Hypernovum section of the vault-root AGENTS.md */
  async prepareVaultForAgents(): Promise<void> {
    try {
      const projects = await new ProjectParser(this.app).parseProjects(this.settings);
      const vaultPath = (this.app.vault.adapter as any).basePath as string;
      const skills = scanSkills(vaultPath);
      const result = await prepareVaultForAgents(this.app, projects, skills);
      new Notice(
        result.created
          ? `AGENTS.md created — ${result.projectCount} projects indexed for AI agents`
          : `AGENTS.md updated — ${result.projectCount} projects indexed for AI agents`,
      );
    } catch (error: any) {
      new Notice(`Failed to prepare vault: ${error?.message ?? error}`);
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
