import { App, PluginSettingTab, Setting } from 'obsidian';
import type HypervaultPlugin from '../main';
import { DEFAULT_SETTINGS } from '@hypervault/core';
import type { BlockPosition, HypervaultSettings } from '@hypervault/core';

// Re-export for backward compatibility within the plugin package
export { DEFAULT_SETTINGS };
export type { BlockPosition, HypervaultSettings };

export class SettingsTab extends PluginSettingTab {
  plugin: HypervaultPlugin;

  constructor(app: App, plugin: HypervaultPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Hypervault Settings' });

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
