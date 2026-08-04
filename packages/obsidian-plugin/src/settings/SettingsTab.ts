import { App, PluginSettingTab, Setting } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
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
  /** The 0.4.2 classic→parametric default flip has already been applied once */
  buildingStyleMigrated: boolean;
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
  buildingStyleMigrated: false,
};

export type { BlockPosition };

/** Reopening a view is the only way these take effect; say so once, in one place. */
const ON_REOPEN = ' Applies to city views opened after the change.';

export class SettingsTab extends PluginSettingTab {
  plugin: HypernovumPlugin;

  constructor(app: App, plugin: HypernovumPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /** True when the configured command isn't one of the presets. */
  private usingCustomAgent(): boolean {
    return !KNOWN_AGENTS.some((a) => a.command && a.command === this.plugin.settings.agentCommand);
  }

  /**
   * Declarative settings (Obsidian 1.13+). Returning a non-empty array makes
   * the tab render from these definitions instead of `display()`, and — the
   * actual reason to do this — puts every setting into Obsidian's settings
   * search. `display()` below is kept verbatim as the pre-1.13 fallback, which
   * `minAppVersion: 1.6.0` still permits; older clients simply never call this.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: 'Project tag',
        desc: 'Frontmatter tag or type value used to identify project notes.' + ON_REOPEN,
        aliases: ['frontmatter', 'detection', 'type'],
        control: { type: 'text', key: 'projectTag', placeholder: 'project' },
      },
      {
        name: 'Open the city in',
        desc: 'A main workspace tab gives the 3D view room to breathe. The right sidebar is cramped but stays docked.' + ON_REOPEN,
        aliases: ['sidebar', 'tab', 'location'],
        control: {
          type: 'dropdown',
          key: 'viewLocation',
          options: { tab: 'Main workspace tab', right: 'Right sidebar' },
        },
      },
      {
        name: 'Show labels',
        desc: 'Display building name labels above each building.' + ON_REOPEN,
        control: { type: 'toggle', key: 'showLabels' },
      },
      {
        name: 'Enable shadows',
        desc: 'Render shadows for buildings. Disable for better performance.' + ON_REOPEN,
        control: { type: 'toggle', key: 'enableShadows' },
      },
      {
        name: 'Max buildings',
        desc: 'Maximum number of buildings to render (affects performance).' + ON_REOPEN,
        aliases: ['performance', 'limit'],
        control: { type: 'slider', key: 'maxBuildings', min: 50, max: 500, step: 50 },
      },
      {
        name: 'Output folder',
        desc: 'Vault folder for generated briefings and snapshots. Leave empty for the vault root.',
        aliases: ['briefing', 'snapshot'],
        control: { type: 'text', key: 'outputFolder', placeholder: 'Hypernovum' },
      },
      {
        name: 'Git activity layer',
        desc: 'Read local Git metadata from projectDir folders to show stale, hot, dirty, and branch status. Runs read-only git commands on your machine.' + ON_REOPEN,
        aliases: ['git', 'commits', 'branch'],
        control: { type: 'toggle', key: 'enableGitActivity' },
      },
      {
        type: 'group',
        heading: 'Agent launcher',
        items: [
          {
            name: 'Agent',
            desc: 'CLI agent to launch from the city. Right-click a building to launch it.',
            aliases: ['claude', 'codex', 'antigravity', 'cli'],
            control: {
              type: 'dropdown',
              key: 'agentSelection',
              options: Object.fromEntries(
                KNOWN_AGENTS.map((a) => [a.command || '__custom__', a.name]),
              ),
            },
          },
          {
            name: 'Custom agent command',
            desc: 'The CLI command to run (e.g. "aider", "cursor", "my-agent").',
            visible: () => this.usingCustomAgent(),
            control: { type: 'text', key: 'agentCommand', placeholder: 'my-agent' },
          },
          {
            name: 'Prepare vault for AI agents',
            desc: 'Write an AGENTS.md file at the vault root with the project schema and a live project inventory, so any CLI agent understands this vault. Also installs the heartbeat script. Safe to re-run; only the Hypernovum section is updated.',
            aliases: ['AGENTS.md'],
            action: () => { void this.plugin.prepareVaultForAgents(); },
          },
          {
            name: 'Agent heartbeat hooks',
            desc: 'Install the heartbeat script into this vault and show the hook JSON that makes agent sessions appear as live orbs in the city.',
            aliases: ['heartbeat', 'hooks', 'presence'],
            action: () => { void this.plugin.installHeartbeatHooks(); },
          },
        ],
      },
      {
        type: 'group',
        heading: 'Vault mode',
        items: [
          {
            name: 'Enable vault mode',
            desc: 'Disable AI agent features and use Hypernovum as a pure 3D visualization and navigation tool. No local processes are run in this mode. Applies immediately — open city views reload.',
            aliases: ['privacy', 'offline', 'consent'],
            control: { type: 'toggle', key: 'vaultMode' },
          },
        ],
      },
      {
        type: 'group',
        heading: 'Visual effects',
        items: [
          {
            name: 'Building style',
            desc: 'Parametric towers carry real massing and window rows equal to their floor count; Classic is the original silhouette set. Applies immediately to open city views.',
            aliases: ['parametric', 'classic', 'towers'],
            control: {
              type: 'dropdown',
              key: 'buildingStyle',
              options: { parametric: 'Parametric', classic: 'Classic' },
            },
          },
          {
            name: 'Performance mode',
            desc: 'Turn off procedural shaders, bloom, and fog together. Use this on integrated graphics or very large vaults.',
            aliases: ['gpu', 'slow', 'lag'],
            control: { type: 'toggle', key: 'performanceMode' },
          },
          {
            name: 'Procedural shaders',
            desc: 'GPU shaders for procedural windows and glitch effects. Applies immediately to open city views.',
            control: { type: 'toggle', key: 'enableShaders' },
          },
          {
            name: 'Bloom glow',
            desc: 'Post-processing neon glow. Applies immediately to open city views.',
            control: { type: 'toggle', key: 'enableBloom' },
          },
          {
            name: 'Bloom intensity',
            desc: 'Strength of the bloom glow effect.' + ON_REOPEN,
            control: { type: 'slider', key: 'bloomIntensity', min: 0.3, max: 2.0, step: 0.1 },
          },
          {
            name: 'Atmospheric fog',
            desc: 'Depth fog and enhanced grid for the cyberpunk look. Applies immediately to open city views.',
            control: { type: 'toggle', key: 'enableAtmosphere' },
          },
        ],
      },
    ];
  }

  /**
   * Re-run `getSettingDefinitions()` and re-render, so `visible` predicates and
   * derived values pick up a change.
   *
   * Only 1.13+ calls `setControlValue` at all, so reaching here already implies
   * `update()` exists — but `minAppVersion` is 1.6.0, so feature-detect rather
   * than assert it.
   */
  private refreshDefinitions(): void {
    const update = (this as { update?: () => void }).update;
    if (typeof update === 'function') update.call(this);
  }

  /**
   * Two of the keys above are virtual — they don't exist in stored settings:
   * `agentSelection` (the preset dropdown, derived from agentCommand) and
   * `performanceMode` (derived from the three effect flags, so it can never
   * disagree with them).
   */
  getControlValue(key: string): unknown {
    const s = this.plugin.settings;
    if (key === 'agentSelection') {
      return this.usingCustomAgent() ? '__custom__' : s.agentCommand;
    }
    if (key === 'performanceMode') {
      return !s.enableShaders && !s.enableBloom && !s.enableAtmosphere;
    }
    return (s as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.plugin.settings;

    switch (key) {
      case 'agentSelection': {
        // Choosing "Custom..." clears the command so the dropdown keeps showing
        // Custom and the text field below appears — otherwise the derived value
        // would snap straight back to the previously selected preset.
        if (value === '__custom__') {
          s.agentCommand = '';
          s.agentName = 'Custom Agent';
        } else {
          const agent = KNOWN_AGENTS.find((a) => a.command === value);
          s.agentCommand = String(value);
          s.agentName = agent?.name ?? String(value);
        }
        await this.plugin.saveSettings();
        this.refreshDefinitions(); // reveal/hide the custom command field
        return;
      }

      case 'agentCommand': {
        const command = String(value).trim();
        s.agentCommand = command;
        s.agentName = command || 'Custom Agent';
        await this.plugin.saveSettings();
        return;
      }

      case 'performanceMode': {
        const enabled = !value;
        s.enableShaders = enabled;
        s.enableBloom = enabled;
        s.enableAtmosphere = enabled;
        await this.plugin.saveSettings();
        this.refreshDefinitions(); // the three toggles below are derived from this
        await this.plugin.reloadOpenViews();
        return;
      }

      // Owns its own persistence + view reload, and the consent migration.
      case 'vaultMode':
        await this.plugin.setVaultMode(Boolean(value));
        this.refreshDefinitions(); // agent-layer settings may now be inert
        return;

      case 'outputFolder':
        s.outputFolder = String(value).trim();
        await this.plugin.saveSettings();
        return;

      default:
        (s as unknown as Record<string, unknown>)[key] = value;
        await this.plugin.saveSettings();
        // These four are the ones the scene can adopt without a reopen.
        if (key === 'buildingStyle' || key === 'enableShaders' || key === 'enableBloom' || key === 'enableAtmosphere') {
          if (key !== 'buildingStyle') this.refreshDefinitions(); // may have flipped performance mode
          await this.plugin.reloadOpenViews();
        }
    }
  }

  /**
   * Imperative fallback for Obsidian older than 1.13. Not called when
   * `getSettingDefinitions()` returns a non-empty array — keep the two in sync.
   *
   * Lint reports this override as deprecated, and it is: 1.13 deprecated
   * `display()` in favour of `getSettingDefinitions()`, which is implemented
   * above. The warning is accepted rather than suppressed, and stays correct
   * to act on — delete this method the day `minAppVersion` reaches 1.13.
   */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Project tag')
      .setDesc('Frontmatter tag or type value used to identify project notes.' +
        ' Applies to city views opened after the change.')
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
      .setDesc('A main workspace tab gives the 3D view room to breathe. The right sidebar is cramped but stays docked.' +
        ' Applies to city views opened after the change.')
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
      .setDesc('Display building name labels above each building.' + ' Applies to city views opened after the change.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showLabels).onChange(async (value) => {
          this.plugin.settings.showLabels = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Enable shadows')
      .setDesc('Render shadows for buildings. Disable for better performance.' + ' Applies to city views opened after the change.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableShadows).onChange(async (value) => {
          this.plugin.settings.enableShadows = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Max buildings')
      .setDesc('Maximum number of buildings to render (affects performance).' + ' Applies to city views opened after the change.')
      .addSlider((slider) =>
        slider
          .setLimits(50, 500, 50)
          .setValue(this.plugin.settings.maxBuildings)
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
      .setDesc('Read local Git metadata from projectDir folders to show stale, hot, dirty, and branch status. Runs read-only git commands on your machine.' +
        ' Applies to city views opened after the change.')
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
      .setDesc('Parametric towers carry real massing and window rows equal to their floor count; Classic is the original silhouette set. Applies immediately to open city views.')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('parametric', 'Parametric')
          .addOption('classic', 'Classic')
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
      .setDesc('Strength of the bloom glow effect.' + ' Applies to city views opened after the change.')
      .addSlider((slider) =>
        slider
          .setLimits(0.3, 2.0, 0.1)
          .setValue(this.plugin.settings.bloomIntensity)
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
