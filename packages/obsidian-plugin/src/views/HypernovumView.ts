import { ItemView, WorkspaceLeaf, App, Notice, TFile, Menu, Modal, Setting } from 'obsidian';
import { existsSync } from 'fs';
import * as path from 'path';
import { SceneManager, BinPacker, BuildingRaycaster, KeyboardNav } from '@hypernovum/core';
import type { ProjectData, HypernovumSettings, BlockPosition, RaycastHit } from '@hypernovum/core';
import { ProjectParser } from '../parsers/ProjectParser';
import { MetadataExtractor } from '../parsers/MetadataExtractor';
import { ActivityMonitor, type ActivityStatus } from '../monitors/ActivityMonitor';
import { TerminalLauncher } from '../utils/TerminalLauncher';
import { generateAgentContext } from '../utils/AgentContext';
import type HypernovumPlugin from '../main';

export const VIEW_TYPE = 'hypernovum-view';

export class HypernovumView extends ItemView {
  private plugin: HypernovumPlugin;
  private sceneManager: SceneManager | null = null;
  private parser: ProjectParser;
  private binPacker: BinPacker;
  private metadataExtractor: MetadataExtractor | null = null;
  private raycaster: BuildingRaycaster | null = null;
  private keyboardNav: KeyboardNav | null = null;
  private activityMonitor: ActivityMonitor | null = null;
  private activityIndicator: HTMLElement | null = null;
  private projects: ProjectData[] = [];

  constructor(leaf: WorkspaceLeaf, app: App, plugin: HypernovumPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.parser = new ProjectParser(app);
    this.binPacker = new BinPacker();
  }

  get settings(): HypernovumSettings {
    return this.plugin.settings;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Hypernovum';
  }

  getIcon(): string {
    return 'box';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('hypernovum-container');

    // Initialize 3D scene with save callback and settings
    this.sceneManager = new SceneManager(container, {
      savedPositions: this.settings.blockPositions,
      onSaveLayout: (positions) => this.saveLayout(positions),
      settings: this.settings,
    });

    // Add legend overlay
    this.addLegend(container);

    // Add agent switcher overlay
    this.addAgentSwitcher(container);

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

    // Set up right-click context menu for buildings
    this.raycaster.setRightClickHandler((hit, event) => {
      this.showBuildingContextMenu(hit, event);
    });

    // Set up right-click on Neural Core orb
    this.raycaster.setOrbRightClickHandler((event) => {
      this.showOrbContextMenu(event);
    });

    // Set up focus-safe keyboard navigation
    this.keyboardNav = new KeyboardNav(this.sceneManager.getCanvas());
    this.keyboardNav.setHandlers({
      onCycleBlocked: () => this.cycleByStatus('blocked'),
      onCycleStale: () => this.cycleByStatus('paused'),
      onResetCamera: () => this.sceneManager?.resetCamera(),
      onDebugFlow: () => this.triggerRandomFlow(),
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

    // Watch for file modifications to trigger data flow animations
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile) {
          this.onFileModified(file.path);
        }
      })
    );

    // Initialize Claude Code activity monitor
    this.activityMonitor = new ActivityMonitor(this.app, {
      onActivityStart: (status) => this.onClaudeActivityStart(status),
      onActivityUpdate: (status) => this.onClaudeActivityUpdate(status),
      onActivityStop: () => this.onClaudeActivityStop(),
      onProjectChange: (newProject, oldProject) => {
        console.log('[Hypernovum] Project changed:', oldProject, '->', newProject);
      },
    });
    this.activityMonitor.start();

    // Add activity indicator overlay
    this.addActivityIndicator(container);

    // Add HUD title
    this.addHudTitle(container);
  }

  async onClose(): Promise<void> {
    this.metadataExtractor?.stopWatching();
    this.keyboardNav?.dispose();
    this.activityMonitor?.stop();

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

  private addAgentSwitcher(container: HTMLElement): void {
    const KNOWN_AGENTS = [
      { id: 'claude', name: 'Claude Code', command: 'claude', icon: '>', color: '#ff922b' },
      { id: 'gemini', name: 'Gemini CLI', command: 'gemini', icon: 'G', color: '#4d96ff' },
      { id: 'codex', name: 'GPT Codex', command: 'codex', icon: 'C', color: '#6bcb77' },
      { id: 'aider', name: 'Aider', command: 'aider', icon: 'A', color: '#ff6b6b' },
    ];

    const panel = document.createElement('div');
    panel.className = 'agents-panel';
    panel.innerHTML = `
      <div class="agents-header">
        <div>
          <span class="agents-title">AGENTS</span>
          <div class="agents-subtitle">Select an agent, click building, launch</div>
        </div>
      </div>
      <div class="agents-list"></div>
    `;

    const list = panel.querySelector('.agents-list') as HTMLElement;
    
    const renderAgents = () => {
      list.empty();
      const currentCommand = this.settings.agentCommand;
      const currentName = this.settings.agentName;
      
      const agentsToRender = [...KNOWN_AGENTS];
      const isKnown = KNOWN_AGENTS.some(a => a.command === currentCommand);
      
      if (!isKnown && currentCommand) {
        agentsToRender.push({
          id: 'custom',
          name: currentName || 'Custom Agent',
          command: currentCommand,
          icon: currentName ? currentName[0].toUpperCase() : '?',
          color: '#cc5de8'
        });
      }
      
      for (const agent of agentsToRender) {
        const item = document.createElement('div');
        item.className = 'agents-item' + (currentCommand === agent.command ? ' active' : '');
        item.innerHTML = `
          <div class="agents-icon-circle" style="background: ${agent.color}">${agent.icon}</div>
          <span class="agents-item-name">${agent.name}</span>
        `;
        if (currentCommand === agent.command) {
          item.style.borderLeftColor = agent.color;
        }
        item.addEventListener('click', async () => {
          this.plugin.settings.agentName = agent.name;
          this.plugin.settings.agentCommand = agent.command;
          await this.plugin.saveSettings();
          renderAgents();
        });
        list.appendChild(item);
      }
    };
    
    renderAgents();
    container.appendChild(panel);
  }

  private addLegend(container: HTMLElement): void {
    const legend = document.createElement('div');
    legend.className = 'hypernovum-legend';
    legend.innerHTML = `
      <div class="hypernovum-legend-section">
        <h4>Status (Color)</h4>
        <div class="hypernovum-legend-item">
          <div class="hypernovum-legend-color active"></div>
          <span>Active</span>
        </div>
        <div class="hypernovum-legend-item">
          <div class="hypernovum-legend-color blocked"></div>
          <span>Blocked</span>
        </div>
        <div class="hypernovum-legend-item">
          <div class="hypernovum-legend-color paused"></div>
          <span>Paused</span>
        </div>
        <div class="hypernovum-legend-item">
          <div class="hypernovum-legend-color complete"></div>
          <span>Complete</span>
        </div>
      </div>
      <div class="hypernovum-legend-section">
        <h4>Priority (Height)</h4>
        <div class="hypernovum-legend-item">
          <div class="hypernovum-legend-height">
            <div class="hypernovum-legend-bar" style="height: 16px;"></div>
          </div>
          <span>Critical</span>
        </div>
        <div class="hypernovum-legend-item">
          <div class="hypernovum-legend-height">
            <div class="hypernovum-legend-bar" style="height: 10px;"></div>
          </div>
          <span>High</span>
        </div>
        <div class="hypernovum-legend-item">
          <div class="hypernovum-legend-height">
            <div class="hypernovum-legend-bar" style="height: 6px;"></div>
          </div>
          <span>Medium</span>
        </div>
        <div class="hypernovum-legend-item">
          <div class="hypernovum-legend-height">
            <div class="hypernovum-legend-bar" style="height: 3px;"></div>
          </div>
          <span>Low</span>
        </div>
      </div>
    `;
    container.appendChild(legend);
  }

  private addControlsHint(container: HTMLElement): void {
    const controls = document.createElement('div');
    controls.className = 'hypernovum-controls';
    controls.innerHTML = `
      <kbd>Click</kbd> Open note<br>
      <kbd>Right-drag</kbd> Pan<br>
      <kbd>Scroll</kbd> Zoom
    `;
    container.appendChild(controls);
  }

  private addSaveButton(container: HTMLElement): void {
    const saveBtn = document.createElement('button');
    saveBtn.className = 'hypernovum-save-btn';
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

  /** Debug: Trigger a random data flow for testing */
  private triggerRandomFlow(): void {
    if (this.projects.length === 0 || !this.sceneManager) return;
    const randomProject = this.projects[Math.floor(Math.random() * this.projects.length)];
    console.log('[Hypernovum] Debug flow triggered for:', randomProject.title);
    this.sceneManager.triggerFlow(randomProject.path);
  }

  /** Handle file modifications to trigger data flow animations */
  private onFileModified(filePath: string): void {
    // Find project that matches this file path
    // Either the project's main note or a file within the project folder
    const project = this.projects.find(p => {
      // Direct match - the project note itself was modified
      if (filePath === p.path) return true;
      // Folder match - a file within the project's folder was modified
      // Project folders are named same as the note (without .md extension)
      const projectFolder = p.path.replace(/\.md$/, '/');
      return filePath.startsWith(projectFolder);
    });

    if (project && this.sceneManager) {
      this.sceneManager.triggerFlow(project.path);
    }
  }

  /** Add activity indicator overlay */
  private addActivityIndicator(container: HTMLElement): void {
    const indicator = document.createElement('div');
    indicator.className = 'hypernovum-activity-indicator';
    indicator.innerHTML = `
      <div class="activity-status">
        <span class="activity-dot"></span>
        <span class="activity-text">IDLE</span>
      </div>
      <div class="activity-project"></div>
      <div class="activity-action"></div>
    `;
    indicator.style.display = 'none'; // Hidden by default
    container.appendChild(indicator);
    this.activityIndicator = indicator;
  }

  /** Handle Claude Code activity start */
  private onClaudeActivityStart(status: ActivityStatus): void {
    console.log('[Hypernovum] Claude activity started:', status);

    this.updateActivityIndicator(status, true);

    if (!this.sceneManager || !status.project) return;

    // Try to find the project in our city
    const project = this.sceneManager.findProjectByName(status.project);
    if (project) {
      this.sceneManager.startStreaming(project.path);
    } else {
      console.log('[Hypernovum] No matching project found for:', status.project);
    }
  }

  /** Handle Claude Code activity update */
  private onClaudeActivityUpdate(status: ActivityStatus): void {
    this.updateActivityIndicator(status, true);

    // Check if project changed
    if (!this.sceneManager || !status.project) return;

    const currentStreamPath = this.sceneManager.isStreaming();
    const project = this.sceneManager.findProjectByName(status.project);

    if (project && !this.sceneManager.isStreaming()) {
      // Not currently streaming, start streaming to the new project
      this.sceneManager.startStreaming(project.path);
    }
  }

  /** Handle Claude Code activity stop */
  private onClaudeActivityStop(): void {
    console.log('[Hypernovum] Claude activity stopped');

    this.updateActivityIndicator(null, false);

    if (this.sceneManager) {
      this.sceneManager.stopStreaming();
    }
  }

  /** Update the activity indicator display */
  private updateActivityIndicator(status: ActivityStatus | null, active: boolean): void {
    if (!this.activityIndicator) return;

    if (active && status) {
      this.activityIndicator.style.display = 'block';
      this.activityIndicator.classList.add('active');

      const dot = this.activityIndicator.querySelector('.activity-dot') as HTMLElement;
      const text = this.activityIndicator.querySelector('.activity-text') as HTMLElement;
      const projectEl = this.activityIndicator.querySelector('.activity-project') as HTMLElement;
      const actionEl = this.activityIndicator.querySelector('.activity-action') as HTMLElement;

      if (dot) dot.classList.add('pulsing');
      if (text) text.textContent = 'STREAMING';
      if (projectEl) projectEl.textContent = status.project || '';
      if (actionEl) actionEl.textContent = status.action || '';
    } else {
      this.activityIndicator.classList.remove('active');

      const dot = this.activityIndicator.querySelector('.activity-dot') as HTMLElement;
      const text = this.activityIndicator.querySelector('.activity-text') as HTMLElement;

      if (dot) dot.classList.remove('pulsing');
      if (text) text.textContent = 'IDLE';

      // Hide after a short delay
      setTimeout(() => {
        if (this.activityIndicator && !this.activityMonitor?.isCurrentlyActive()) {
          this.activityIndicator.style.display = 'none';
        }
      }, 2000);
    }
  }

  /** Show context menu for right-clicked building */
  private showBuildingContextMenu(hit: RaycastHit, event: MouseEvent): void {
    const menu = new Menu();
    const project = hit.project;

    // Resolve the project directory path
    const projectPath = this.resolveProjectPath(project);

    const agentName = this.settings.agentName || 'Claude Code';
    menu.addItem((item) => {
      item
        .setTitle(`Launch ${agentName}`)
        .setIcon('terminal')
        .onClick(async () => {
          await this.launchAgentForProject(project, projectPath);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('📂 Open in Explorer')
        .setIcon('folder-open')
        .onClick(async () => {
          const result = await TerminalLauncher.openInExplorer(projectPath);
          if (result.success) {
            new Notice(`Opened ${project.title} folder`);
          } else {
            new Notice(`Failed to open folder: ${result.message}`);
          }
        });
    });

    menu.addSeparator();

    menu.addItem((item) => {
      item
        .setTitle('📝 Open Note')
        .setIcon('file-text')
        .onClick(() => {
          this.app.workspace.openLinkText(project.path, '', false);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('🎯 Focus Camera')
        .setIcon('crosshair')
        .onClick(() => {
          if (project.position && this.sceneManager) {
            this.sceneManager.focusOnPosition(project.position);
            this.sceneManager.setFocusedProject(project);
          }
        });
    });

    menu.showAtMouseEvent(event);
  }

  /** Resolve the best path for a project's working directory */
  private resolveProjectPath(project: ProjectData): string {
    const vaultBasePath = (this.app.vault.adapter as any).basePath as string;

    // Priority 1: Explicit projectDir from frontmatter
    if (project.projectDir) {
      // If it's an absolute path, use it directly
      if (path.isAbsolute(project.projectDir)) {
        if (existsSync(project.projectDir)) {
          return project.projectDir;
        }
      } else {
        // Relative to vault
        const resolved = path.join(vaultBasePath, project.projectDir);
        if (existsSync(resolved)) {
          return resolved;
        }
      }
    }

    // Priority 2: Folder with same name as note (without .md)
    const noteFolderPath = path.join(vaultBasePath, project.path.replace(/\.md$/, ''));
    if (existsSync(noteFolderPath)) {
      return noteFolderPath;
    }

    // Priority 3: Parent folder of the note
    const noteParentPath = path.join(vaultBasePath, path.dirname(project.path));
    if (existsSync(noteParentPath) && noteParentPath !== vaultBasePath) {
      return noteParentPath;
    }

    // Priority 4: Vault root
    return vaultBasePath;
  }

  /** Launch the configured agent for a project */
  private async launchAgentForProject(project: ProjectData, projectPath: string): Promise<void> {
    const agentName = this.settings.agentName || 'Claude Code';
    const agentCommand = this.settings.agentCommand || 'claude';
    new Notice(`Launching ${agentName} for ${project.title}...`);

    // Trigger visual launch effect (dramatic pulse + data flow)
    if (this.sceneManager) {
      this.sceneManager.triggerLaunchEffect(project.path);
    }

    // Write agent context before launching
    const vaultPath = (this.app.vault.adapter as any).basePath as string;
    generateAgentContext(projectPath, vaultPath);

    const result = await TerminalLauncher.launch({
      projectPath,
      command: agentCommand,
      projectName: project.title,
    });

    if (result.success) {
      new Notice(`Terminal launched for ${project.title}`);
    } else {
      new Notice(`Launch failed: ${result.message}`);
    }
  }

  /** Add neon HUD title at top center */
  private addHudTitle(container: HTMLElement): void {
    const title = document.createElement('div');
    title.className = 'hypernovum-hud-title';
    Object.assign(title.style, {
      position: 'absolute',
      top: '14px',
      left: '50%',
      transform: 'translateX(-50%)',
      fontFamily: 'monospace',
      fontSize: '16px',
      fontWeight: '700',
      letterSpacing: '6px',
      color: '#b366ff',
      textShadow: '0 0 12px #b366ff, 0 0 24px rgba(179,102,255,0.4)',
      background: 'rgba(10, 10, 20, 0.6)',
      border: '1px solid rgba(179, 102, 255, 0.2)',
      borderRadius: '4px',
      padding: '6px 18px',
      zIndex: '200',
      pointerEvents: 'none',
      userSelect: 'none',
    });

    const cursor = document.createElement('span');
    cursor.textContent = '\u2588';
    cursor.style.animation = 'cursor-blink 1.06s step-end infinite';
    title.textContent = 'HYPERNOVUM';
    title.appendChild(cursor);

    // Inject cursor blink keyframes if not already present
    if (!document.getElementById('hypernovum-cursor-anim')) {
      const style = document.createElement('style');
      style.id = 'hypernovum-cursor-anim';
      style.textContent = '@keyframes cursor-blink { 0%,50%{opacity:1} 50.01%,100%{opacity:0} }';
      document.head.appendChild(style);
    }

    container.appendChild(title);
  }

  /** Show context menu for right-clicked Neural Core orb */
  private showOrbContextMenu(event: MouseEvent): void {
    const menu = new Menu();
    const agentName = this.settings.agentName || 'Claude Code';

    menu.addItem((item) => {
      item
        .setTitle(`Launch ${agentName}...`)
        .setIcon('terminal')
        .onClick(async () => {
          await this.launchAgentFromOrb();
        });
    });

    menu.showAtMouseEvent(event);
  }

  /** Launch agent from orb — opens folder picker first */
  private async launchAgentFromOrb(): Promise<void> {
    const agentName = this.settings.agentName || 'Claude Code';

    // Try native Electron dialog (modern @electron/remote first, then legacy)
    const dialog = this.getElectronDialog();
    if (dialog) {
      try {
        const result = await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
          title: `Select folder for ${agentName}`,
        });

        if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
          return;
        }

        await this.launchAgentInFolder(result.filePaths[0]);
        return;
      } catch {
        // Dialog failed, fall through to modal
      }
    }

    // Fallback: text input modal
    new FolderInputModal(this.app, async (folderPath) => {
      await this.launchAgentInFolder(folderPath);
    }).open();
  }

  /** Try to get Electron's dialog API, or null if unavailable */
  private getElectronDialog(): any {
    try {
      // Modern Electron (Obsidian 1.5+): @electron/remote
      const remote = require('@electron/remote');
      if (remote?.dialog) return remote.dialog;
    } catch { /* not available */ }

    try {
      // Legacy Electron: electron.remote
      const electron = require('electron');
      const remote = electron.remote || (electron as any).default?.remote;
      if (remote?.dialog) return remote.dialog;
    } catch { /* not available */ }

    return null;
  }

  /** Shared launch logic for folder-based agent launch */
  private async launchAgentInFolder(folderPath: string): Promise<void> {
    const agentName = this.settings.agentName || 'Claude Code';
    const agentCommand = this.settings.agentCommand || 'claude';
    const projectName = path.basename(folderPath);
    new Notice(`Launching ${agentName} in ${projectName}...`);

    // Write agent context before launching
    const vaultPath = (this.app.vault.adapter as any).basePath as string;
    generateAgentContext(folderPath, vaultPath);

    const launchResult = await TerminalLauncher.launch({
      projectPath: folderPath,
      command: agentCommand,
      projectName,
    });

    if (launchResult.success) {
      new Notice(`Terminal launched in ${projectName}`);
    } else {
      new Notice(`Launch failed: ${launchResult.message}`);
    }
  }
}

/**
 * Simple modal that prompts the user for a folder path.
 * Used as fallback when Electron's native folder picker is unavailable.
 */
class FolderInputModal extends Modal {
  private onSubmit: (path: string) => void;
  private inputValue = '';

  constructor(app: App, onSubmit: (path: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Launch Agent' });
    contentEl.createEl('p', { text: 'Enter the project folder path:' });

    new Setting(contentEl)
      .setName('Folder path')
      .addText((text) => {
        text.setPlaceholder('/Users/you/projects/my-project');
        text.onChange((value) => { this.inputValue = value; });
        // Submit on Enter key
        text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.submit();
          }
        });
      });

    new Setting(contentEl)
      .addButton((btn) => {
        btn.setButtonText('Launch')
          .setCta()
          .onClick(() => this.submit());
      });
  }

  private submit(): void {
    const trimmed = this.inputValue.trim();
    if (!trimmed) {
      new Notice('Please enter a folder path');
      return;
    }
    if (!existsSync(trimmed)) {
      new Notice('Folder not found: ' + trimmed);
      return;
    }
    this.close();
    this.onSubmit(trimmed);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
