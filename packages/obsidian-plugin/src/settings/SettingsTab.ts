import { App, PluginSettingTab, Setting } from 'obsidian';
import type HypernovumPlugin from '../main';
import { DEFAULT_SETTINGS as CORE_DEFAULTS } from '@hypernovum/core';
import type { BlockPosition, HypernovumSettings as CoreSettings } from '@hypernovum/core';

/** Known CLI agents — users can also enter a custom command */
const KNOWN_AGENTS = [
  { name: 'Claude Code', command: 'claude' },
  { name: 'Gemini CLI', command: 'gemini' },
  { name: 'GPT Codex', command: 'codex' },
  { name: 'Aider', command: 'aider' },
  { name: 'Custom...', command: '' },
];

/** Plugin-level settings extend core settings with agent configuration */
export interface HypernovumSettings extends CoreSettings {
  vaultMode: boolean;
  agentName: string;
  agentCommand: string;
}

export const DEFAULT_SETTINGS: HypernovumSettings = {
  ...CORE_DEFAULTS,
  agentName: 'Claude Code',
  agentCommand: 'claude',
  vaultMode: false,
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

    containerEl.createEl('h2', { text: 'Hypernovum Settings' });

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

    containerEl.createEl('h3', { text: 'Agent' });

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
            customSetting.settingEl.style.display = '';
          } else {
            const agent = KNOWN_AGENTS.find(a => a.command === value);
            this.plugin.settings.agentName = agent?.name || value;
            this.plugin.settings.agentCommand = value;
            customSetting.settingEl.style.display = 'none';
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
    customSetting.settingEl.style.display = isCustom ? '' : 'none';

    containerEl.createEl('h3', { text: 'Vault Mode' });

    new Setting(containerEl)
      .setName('Enable Vault Mode')
      .setDesc('Disable AI agent features and use Hypernovum as a pure 3D visualization and navigation tool.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.vaultMode).onChange(async (value) => {
          this.plugin.settings.vaultMode = value;
          await this.plugin.saveSettings();
        }),
      );

    containerEl.createEl('h3', { text: 'Visual Effects' });

    new Setting(containerEl)
      .setName('Procedural shaders')
      .setDesc('Enable GPU shaders for procedural windows and glitch effects. Reload view after changing.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableShaders).onChange(async (value) => {
          this.plugin.settings.enableShaders = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Bloom glow')
      .setDesc('Enable post-processing neon glow effect. Reload view after changing.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableBloom).onChange(async (value) => {
          this.plugin.settings.enableBloom = value;
          await this.plugin.saveSettings();
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
      .setDesc('Enable depth fog and enhanced grid for cyberpunk aesthetic. Reload view after changing.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableAtmosphere).onChange(async (value) => {
          this.plugin.settings.enableAtmosphere = value;
          await this.plugin.saveSettings();
        }),
      );
  }
}
