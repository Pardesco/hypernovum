import { Notice, Plugin } from 'obsidian';
import { HypernovumView, VIEW_TYPE } from './views/HypernovumView';
import { HypernovumSettings, DEFAULT_SETTINGS, SettingsTab } from './settings/SettingsTab';
import { ProjectParser } from './parsers/ProjectParser';
import { prepareVaultForAgents } from './utils/VaultAgentSetup';
import { scanSkills } from './utils/SkillsScanner';
import { generateDailyBriefing } from './utils/BriefingGenerator';
import {
  getVaultBasePath,
  heartbeatPaths,
  installHeartbeatScript,
} from './utils/HeartbeatInstaller';
import { HeartbeatHooksModal } from './modals/HeartbeatHooksModal';
import { FirstRunModal } from './modals/FirstRunModal';

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
      void this.activateView();
    });

    // Command palette entries. Obsidian shows these prefixed with the plugin
    // name and expects sentence case, so no "Hypernovum:" prefix and no Title Case.
    this.addCommand({
      id: 'open-code-city',
      name: 'Open code city',
      callback: () => { void this.activateView(); },
    });

    this.addCommand({
      id: 'prepare-vault-for-agents',
      name: 'Prepare vault for AI agents',
      callback: () => { void this.prepareVaultForAgents(); },
    });

    this.addCommand({
      id: 'install-heartbeat-hooks',
      name: 'Install agent heartbeat hooks',
      callback: () => { void this.installHeartbeatHooks(); },
    });

    this.addCommand({
      id: 'generate-daily-briefing',
      name: 'Generate daily briefing',
      callback: () => { void this.generateDailyBriefing(); },
    });

    this.addCommand({
      id: 'toggle-vault-mode',
      name: 'Toggle vault mode',
      callback: () => { void this.toggleVaultMode(); },
    });

    this.registerViewCommands();

    // Settings tab
    this.addSettingTab(new SettingsTab(this.app, this));
  }

  /**
   * Commands for actions that previously only existed as HUD buttons or a
   * dropdown. Obsidian users bind hotkeys to everything, and a panel-only action
   * is effectively invisible to them.
   *
   * Each uses `checkCallback` so it only appears in the palette while a city view
   * is actually open.
   */
  private registerViewCommands(): void {
    const viewActions: { id: string; name: string; run: (view: HypernovumView) => void }[] = [
      { id: 'save-layout', name: 'Save city layout', run: (v) => v.commandSaveLayout() },
      { id: 'snapshot', name: 'Save city snapshot (PNG)', run: (v) => { void v.commandSnapshot(); } },
      { id: 'clear-filters', name: 'Clear search and filters', run: (v) => v.commandClearFilters() },
      { id: 'reset-camera', name: 'Reset camera', run: (v) => v.commandResetCamera() },
      { id: 'lens-status', name: 'Scan lens: status', run: (v) => v.commandSetLayer('status') },
      { id: 'lens-attention', name: 'Scan lens: needs attention', run: (v) => v.commandSetLayer('attention') },
      { id: 'lens-git', name: 'Scan lens: Git activity', run: (v) => v.commandSetLayer('git') },
      { id: 'lens-tasks', name: 'Scan lens: task progress', run: (v) => v.commandSetLayer('tasks') },
      { id: 'lens-recency', name: 'Scan lens: recency', run: (v) => v.commandSetLayer('recency') },
      { id: 'lens-stack', name: 'Scan lens: tech stack', run: (v) => v.commandSetLayer('stack') },
      { id: 'cycle-blocked', name: 'Go to next blocked project', run: (v) => v.commandCycleStatus('blocked') },
      { id: 'cycle-paused', name: 'Go to next paused project', run: (v) => v.commandCycleStatus('paused') },
      { id: 'trace-selection', name: 'Trace impact of selected project', run: (v) => v.commandTraceSelection() },
      { id: 'set-project-folder', name: 'Set project folder for selected project', run: (v) => { void v.commandSetProjectFolder(); } },
    ];

    for (const action of viewActions) {
      this.addCommand({
        id: action.id,
        name: action.name,
        checkCallback: (checking: boolean) => {
          const view = this.app.workspace.getActiveViewOfType(HypernovumView)
            ?? this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view as HypernovumView | undefined;
          if (!(view instanceof HypernovumView)) return false;
          if (!checking) action.run(view);
          return true;
        },
      });
    }
  }

  onunload(): void {
    // View is automatically cleaned up by Obsidian
  }

  /**
   * True when the agent layer may run local processes: git scans, the binary
   * probe, the activity monitor, terminal launches.
   *
   * Consent must be GRANTED, not merely "not denied" — otherwise the very first
   * view open would spawn processes before the user had been asked, which is the
   * thing the first-run prompt exists to prevent.
   */
  get agentFeaturesEnabled(): boolean {
    return !this.settings.vaultMode && this.settings.agentFeaturesConsent === 'granted';
  }

  async activateView(): Promise<void> {
    // Ask BEFORE the view exists. onOpen() starts git scans, the agent-binary
    // probe and the activity monitor, so prompting afterwards would mean the
    // local-process behaviour had already happened by the time the user could
    // decline it.
    await this.ensureConsent();

    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);

    if (existing.length === 0) {
      // Default to a main workspace tab: a 3D city in a ~300px sidebar is not the
      // product, and a collapsed sidebar leaf used to keep rendering invisibly.
      const leaf =
        this.settings.viewLocation === 'right'
          ? this.app.workspace.getRightLeaf(false)
          : this.app.workspace.getLeaf('tab');
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE, active: true });
      }
    }

    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (leaves.length > 0) {
      this.app.workspace.setActiveLeaf(leaves[0], { focus: true });
    }
  }

  /**
   * One-time prompt: agent features read Git metadata, probe for agent binaries,
   * and launch terminals. That's disclosed in the README, but the user should get
   * to choose it rather than have it default on.
   *
   * Resolves only once the choice is recorded, so callers can safely open the view
   * afterwards.
   */
  private consentInFlight: Promise<void> | null = null;

  /**
   * Resolve once a consent choice exists. Safe to call from anywhere the view can
   * start — including `HypernovumView.onOpen`, which is how a leaf restored at
   * Obsidian startup gets here without ever passing through `activateView()`.
   * Concurrent callers share one modal.
   */
  async ensureConsent(): Promise<void> {
    if (this.settings.agentFeaturesConsent !== 'unset') return;
    if (!this.consentInFlight) {
      this.consentInFlight = this.askFirstRunConsent().finally(() => {
        this.consentInFlight = null;
      });
    }
    await this.consentInFlight;
  }

  private askFirstRunConsent(): Promise<void> {
    return new Promise<void>((resolve) => {
      new FirstRunModal(this.app, async (choice) => {
        this.settings.agentFeaturesConsent = choice;
        // "Denied" means vault mode: visualization only, no process execution.
        this.settings.vaultMode = choice === 'denied';
        this.settings.enableGitActivity = choice === 'granted';
        await this.saveSettings();
        resolve();
      }).open();
    });
  }

  /** Write/refresh the Hypernovum section of the vault-root AGENTS.md */
  async prepareVaultForAgents(): Promise<void> {
    try {
      const projects = await new ProjectParser(this.app).parseProjects(this.settings);
      const vaultPath = getVaultBasePath(this.app);
      const skills = vaultPath ? scanSkills(vaultPath) : [];

      // The heartbeat script has to exist in the vault before AGENTS.md can point
      // agents at it — the repo copy never reaches an installed plugin.
      let heartbeat = null;
      try {
        await installHeartbeatScript(this.app);
        heartbeat = heartbeatPaths(this.app);
      } catch (error: unknown) {
        console.error('[Hypernovum] Heartbeat install failed:', error);
      }

      const result = await prepareVaultForAgents(this.app, projects, skills, heartbeat);
      new Notice(
        result.created
          ? `AGENTS.md created — ${result.projectCount} projects indexed for AI agents`
          : `AGENTS.md updated — ${result.projectCount} projects indexed for AI agents`,
      );
    } catch (error: unknown) {
      new Notice(`Failed to prepare vault: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Install the heartbeat script into the vault and show the resolved hook JSON.
   * This is what turns agent orbs / fleet / conflict detection on — without it
   * those features have nothing to read.
   */
  async installHeartbeatHooks(): Promise<void> {
    try {
      const result = await installHeartbeatScript(this.app);
      const paths = heartbeatPaths(this.app);
      if (!paths) {
        new Notice('Hypernovum needs a local vault folder for heartbeat hooks.');
        return;
      }
      new HeartbeatHooksModal(this.app, paths, result.action).open();
    } catch (error: unknown) {
      new Notice(`Failed to install heartbeat: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Write a data-digest briefing note (status, attention list, quests, git heat) */
  async generateDailyBriefing(): Promise<void> {
    try {
      const projects = await new ProjectParser(this.app).parseProjects(this.settings);
      const notePath = await generateDailyBriefing(this.app, projects, this.settings.outputFolder);
      await this.app.workspace.openLinkText(notePath, '', false);
      new Notice('Daily briefing generated');
    } catch (error: unknown) {
      new Notice(`Failed to generate briefing: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Flip vault mode and reload any open city view so it takes effect */
  async toggleVaultMode(): Promise<void> {
    await this.setVaultMode(!this.settings.vaultMode);
  }

  /** Set vault mode and reload open city views — the mode is applied at view open */
  async setVaultMode(value: boolean): Promise<void> {
    if (this.settings.vaultMode === value) return;
    this.settings.vaultMode = value;

    // Turning vault mode OFF is an explicit opt-in to the agent layer, so it
    // grants consent. Without this, anyone who picked "Visualization only" at
    // first run would be stuck: consent stays 'denied' forever and the vault-mode
    // toggle — the control the first-run modal points them at — would appear to do
    // nothing.
    if (!value) this.settings.agentFeaturesConsent = 'granted';

    await this.saveSettings();
    new Notice(`Hypernovum vault mode ${value ? 'ON' : 'OFF'}`);
    await this.reloadOpenViews();
  }

  /**
   * Reload any open city view so a setting applied at view-open (building style,
   * vault mode, shaders…) takes effect immediately instead of on next open.
   */
  async reloadOpenViews(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (leaves.length === 0) return;
    leaves.forEach((leaf) => leaf.detach());
    await this.activateView();
  }

  async loadSettings(): Promise<void> {
    const stored = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);

    // Migration: an install that predates the consent setting was already running
    // the agent layer, so carry that forward from its vault-mode choice. Without
    // this, upgrading would silently switch Git scans, agent presence, and the
    // launch actions off — and because a restored leaf never goes through
    // activateView(), the user would never even see the prompt explaining why.
    if (stored && (stored as Partial<HypernovumSettings>).agentFeaturesConsent === undefined) {
      this.settings.agentFeaturesConsent = this.settings.vaultMode ? 'denied' : 'granted';
      await this.saveSettings();
    }

    // Migration: parametric became the default in 0.4.2. Existing installs have
    // 'classic' persisted, so flipping DEFAULT_SETTINGS alone would leave every
    // current user on the old silhouettes forever. Nobody chose classic
    // deliberately — it WAS the default and picking it was a no-op, so anyone
    // who touched the setting chose parametric. Carry them over once, and
    // record it, so that someone who then switches back to classic stays there.
    const prior = stored as Partial<HypernovumSettings> | null;
    if (prior && !prior.buildingStyleMigrated) {
      if (prior.buildingStyle === 'classic') this.settings.buildingStyle = 'parametric';
      this.settings.buildingStyleMigrated = true;
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
