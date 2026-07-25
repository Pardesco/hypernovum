import { App, PluginSettingTab, Setting } from 'obsidian';
import type HypernovumPlugin from '../main';
import { DEFAULT_SETTINGS as CORE_DEFAULTS } from '@hypernovum/core';
import type { BlockPosition, HypernovumSettings as CoreSettings } from '@hypernovum/core';

/** Known CLI agents — users can also enter a custom command */
const KNOWN_AGENTS = [
  { name: 'Claude Code', command: 'claude' },
  { name: 'GPT Codex', command: 'codex' },
  { name: 'Antigravity CLI', command: 'agy' },
  { name: 'Custom...', command: '' },
];

/** A saved lens preset: one-click layer + filter combination (consumed in Phase 3) */
export interface LensPreset {
  id: string;
  name: string;
  builtIn?: boolean;
  layer: string;
  statusFilter: string;
  priorityFilter: string;
  categoryFilter: string;
  searchQuery?: string;
  /** Edge types visible under this preset (typed edges arrive in Phase 4) */
  edgeTypes: string[];
}

/** Where `activateView` puts the city when nothing is open yet. */
export type ViewLocation = 'tab' | 'right';

/**
 * Whether the user has accepted the agent layer (local process execution, reads
 * outside the vault). 'unset' triggers the first-run prompt.
 */
export type AgentFeaturesConsent = 'unset' | 'granted' | 'denied';

/** Plugin-level settings extend core settings with agent configuration */
export interface HypernovumSettings extends CoreSettings {
  vaultMode: boolean;
  agentName: string;
  agentCommand: string;
  /** One-time "click selects / double-click opens" notice already shown */
  interactionHintShown: boolean;
  /** User-saved lens presets (per vault) */
  savedLenses: LensPreset[];
  /** Where the city opens: a main workspace tab (default) or the right sidebar */
  viewLocation: ViewLocation;
  /** First-run consent for the agent layer */
  agentFeaturesConsent: AgentFeaturesConsent;
  /** Vault folder for generated briefings and snapshots ('' = vault root) */
  outputFolder: string;
}

export const DEFAULT_SETTINGS: HypernovumSettings = {
  ...CORE_DEFAULTS,
  agentName: 'Claude Code',
  agentCommand: 'claude',
  vaultMode: false,
  interactionHintShown: false,
  savedLenses: [],
  viewLocation: 'tab',
  agentFeaturesConsent: 'unset',
  outputFolder: '',
};

export type { BlockPosition };

export class SettingsTab extends PluginSettingTab {
  plugin: HypernovumPlugin;

  constructor(app: App, plugin: HypernovumPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Project tag')
      .setDesc('Frontmatter tag or type value used to identify project notes.')
      .addText((text) =>
        text
          .setPlaceholder('project')
          .setValue(this.plugin.settings.projectTag)
          .onChange(async (value) => {
            this.plugin.settings.projectTag = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Open the city in')
      .setDesc('A main workspace tab gives the 3D view room to breathe. The right sidebar is cramped but stays docked.')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('tab', 'Main workspace tab')
          .addOption('right', 'Right sidebar')
          .setValue(this.plugin.settings.viewLocation)
          .onChange(async (value) => {
            this.plugin.settings.viewLocation = value as ViewLocation;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Show labels')
      .setDesc('Display building name labels above each building.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showLabels).onChange(async (value) => {
          this.plugin.settings.showLabels = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Enable shadows')
      .setDesc('Render shadows for buildings. Disable for better performance.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableShadows).onChange(async (value) => {
          this.plugin.settings.enableShadows = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Max buildings')
      .setDesc('Maximum number of buildings to render (affects performance).')
      .addSlider((slider) =>
        slider
          .setLimits(50, 500, 50)
          .setValue(this.plugin.settings.maxBuildings)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxBuildings = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Output folder')
      .setDesc('Vault folder for generated briefings and snapshots. Leave empty for the vault root.')
      .addText((text) =>
        text
          .setPlaceholder('Hypernovum')
          .setValue(this.plugin.settings.outputFolder)
          .onChange(async (value) => {
            this.plugin.settings.outputFolder = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Git activity layer')
      .setDesc('Read local Git metadata from projectDir folders to show stale, hot, dirty, and branch status. Runs read-only git commands on your machine.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableGitActivity).onChange(async (value) => {
          this.plugin.settings.enableGitActivity = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName('Agent launcher').setHeading();

    new Setting(containerEl)
      .setName('Agent')
      .setDesc('CLI agent to launch from the city. Right-click a building to launch it.')
      .addDropdown((dropdown) => {
        for (const agent of KNOWN_AGENTS) {
          dropdown.addOption(agent.command || '__custom__', agent.name);
        }
        // Set current value
        const isKnown = KNOWN_AGENTS.some(a => a.command && a.command === this.plugin.settings.agentCommand);
        dropdown.setValue(isKnown ? this.plugin.settings.agentCommand : '__custom__');
        dropdown.onChange(async (value) => {
          if (value === '__custom__') {
            // Show custom command input — don't clear existing custom command
            customSetting.settingEl.toggle(true);
          } else {
            const agent = KNOWN_AGENTS.find(a => a.command === value);
            this.plugin.settings.agentName = agent?.name || value;
            this.plugin.settings.agentCommand = value;
            customSetting.settingEl.toggle(false);
            await this.plugin.saveSettings();
          }
        });
      });

    const customSetting = new Setting(containerEl)
      .setName('Custom agent command')
      .setDesc('The CLI command to run (e.g. "aider", "cursor", "my-agent").')
      .addText((text) =>
        text
          .setPlaceholder('my-agent')
          .setValue(
            KNOWN_AGENTS.some(a => a.command && a.command === this.plugin.settings.agentCommand)
              ? ''
              : this.plugin.settings.agentCommand,
          )
          .onChange(async (value) => {
            this.plugin.settings.agentCommand = value.trim();
            this.plugin.settings.agentName = value.trim() || 'Custom Agent';
            await this.plugin.saveSettings();
          }),
      );

    // Hide custom input unless "Custom..." is selected
    const isCustom = !KNOWN_AGENTS.some(a => a.command && a.command === this.plugin.settings.agentCommand);
    customSetting.settingEl.toggle(isCustom);

    new Setting(containerEl)
      .setName('Prepare vault for AI agents')
      .setDesc('Write an AGENTS.md file at the vault root with the project schema and a live project inventory, so any CLI agent understands this vault. Also installs the heartbeat script. Safe to re-run; only the Hypernovum section is updated.')
      .addButton((btn) =>
        btn
          .setButtonText('Write AGENTS.md')
          .onClick(async () => {
            await this.plugin.prepareVaultForAgents();
          }),
      );

    new Setting(containerEl)
      .setName('Agent heartbeat hooks')
      .setDesc('Install the heartbeat script into this vault and show the hook JSON that makes agent sessions appear as live orbs in the city.')
      .addButton((btn) =>
        btn
          .setButtonText('Install and show hooks')
          .onClick(async () => {
            await this.plugin.installHeartbeatHooks();
          }),
      );

    new Setting(containerEl).setName('Vault mode').setHeading();

    new Setting(containerEl)
      .setName('Enable vault mode')
      .setDesc('Disable AI agent features and use Hypernovum as a pure 3D visualization and navigation tool. No local processes are run in this mode. Applies immediately — open city views reload.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.vaultMode).onChange(async (value) => {
          await this.plugin.setVaultMode(value);
        }),
      );

    new Setting(containerEl).setName('Visual effects').setHeading();

    new Setting(containerEl)
      .setName('Building style')
      .setDesc('Classic silhouettes, or Parametric (beta) data-true towers whose window rows equal their floor count. Applies immediately to open city views.')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('classic', 'Classic')
          .addOption('parametric', 'Parametric (beta)')
          .setValue(this.plugin.settings.buildingStyle)
          .onChange(async (value) => {
            this.plugin.settings.buildingStyle = value as 'classic' | 'parametric';
            await this.plugin.saveSettings();
            await this.plugin.reloadOpenViews(); // apply immediately
          });
      });

    // Derived from the three effect flags rather than stored separately, so it can
    // never disagree with them.
    const performanceMode =
      !this.plugin.settings.enableShaders &&
      !this.plugin.settings.enableBloom &&
      !this.plugin.settings.enableAtmosphere;

    new Setting(containerEl)
      .setName('Performance mode')
      .setDesc('Turn off procedural shaders, bloom, and fog together. Use this on integrated graphics or very large vaults.')
      .addToggle((toggle) =>
        toggle.setValue(performanceMode).onChange(async (value) => {
          const enabled = !value;
          this.plugin.settings.enableShaders = enabled;
          this.plugin.settings.enableBloom = enabled;
          this.plugin.settings.enableAtmosphere = enabled;
          await this.plugin.saveSettings();
          this.display(); // reflect the three toggles below
          await this.plugin.reloadOpenViews();
        }),
      );

    new Setting(containerEl)
      .setName('Procedural shaders')
      .setDesc('GPU shaders for procedural windows and glitch effects. Applies immediately to open city views.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableShaders).onChange(async (value) => {
          this.plugin.settings.enableShaders = value;
          await this.plugin.saveSettings();
          await this.plugin.reloadOpenViews();
        }),
      );

    new Setting(containerEl)
      .setName('Bloom glow')
      .setDesc('Post-processing neon glow. Applies immediately to open city views.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableBloom).onChange(async (value) => {
          this.plugin.settings.enableBloom = value;
          await this.plugin.saveSettings();
          await this.plugin.reloadOpenViews();
        }),
      );

    new Setting(containerEl)
      .setName('Bloom intensity')
      .setDesc('Strength of the bloom glow effect.')
      .addSlider((slider) =>
        slider
          .setLimits(0.3, 2.0, 0.1)
          .setValue(this.plugin.settings.bloomIntensity)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.bloomIntensity = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Atmospheric fog')
      .setDesc('Depth fog and enhanced grid for the cyberpunk look. Applies immediately to open city views.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableAtmosphere).onChange(async (value) => {
          this.plugin.settings.enableAtmosphere = value;
          await this.plugin.saveSettings();
          await this.plugin.reloadOpenViews();
        }),
      );
  }
}
