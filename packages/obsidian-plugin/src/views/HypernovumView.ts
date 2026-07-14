import { ItemView, WorkspaceLeaf, App, Notice, TFile, Menu, Modal, Setting, Platform } from 'obsidian';
import { existsSync } from 'fs';
import { exec } from 'child_process';
import * as path from 'path';
import { SceneManager, BinPacker, BuildingRaycaster, KeyboardNav } from '@hypernovum/core';
import type { ProjectData, BlockPosition, RaycastHit, LinkEdge } from '@hypernovum/core';
import { ProjectParser } from '../parsers/ProjectParser';
import { MetadataExtractor } from '../parsers/MetadataExtractor';
import { ActivityMonitor, type ActivityStatus, type AgentPresence } from '../monitors/ActivityMonitor';
import { GitActivityCollector } from '../monitors/GitActivityCollector';
import { TerminalLauncher } from '../utils/TerminalLauncher';
import { generateAgentContext } from '../utils/AgentContext';
import { scanSkills } from '../utils/SkillsScanner';
import type { HypernovumSettings } from '../settings/SettingsTab';
import type HypernovumPlugin from '../main';

export const VIEW_TYPE = 'hypernovum-view';

type VisualLayer = 'status' | 'git' | 'memory' | 'tasks' | 'recency' | 'stack';

/** Dim slate for buildings with no data in the active scan mode */
const NO_DATA_COLOR = 0x39415c;

/** Task completion ramp: danger red → amber → quest-complete green */
const TASK_RAMP = [0xff3355, 0xffaa22, 0x22ff88];

/** Recency thermal ramp: white-hot (today) → cold blue (60d+) */
const RECENCY_RAMP = [0xffe9a8, 0xff8844, 0xcc4477, 0x5f3a9e, 0x22335c];

/** Canonical colors for common stacks; anything else gets a stable hashed hue */
const STACK_COLORS: Record<string, number> = {
  typescript: 0x3f8fd6,
  javascript: 0xf7df1e,
  python: 0x4b8bbe,
  rust: 0xf74c00,
  go: 0x00add8,
  react: 0x61dafb,
  vue: 0x42b883,
  svelte: 0xff3e00,
  astro: 0xff5d01,
  node: 0x6cc24a,
  'node.js': 0x6cc24a,
  'three.js': 0x9c88ff,
  threejs: 0x9c88ff,
  'c#': 0x9b4f96,
  godot: 0x478cbf,
  unity: 0xd8d8d8,
  blender: 0xf5792a,
  swift: 0xf05138,
  kotlin: 0x7f52ff,
};

function lerpHex(a: number, b: number, t: number): number {
  const r = Math.round(((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t);
  const g = Math.round(((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = Math.round((a & 255) + ((b & 255) - (a & 255)) * t);
  return (r << 16) | (g << 8) | bl;
}

function rampHex(stops: number[], t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  const seg = clamped * (stops.length - 1);
  const i = Math.min(Math.floor(seg), stops.length - 2);
  return lerpHex(stops[i], stops[i + 1], seg - i);
}

function hslToHex(h: number, s: number, l: number): number {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
}

function stackColor(name: string): number {
  const key = name.trim().toLowerCase();
  if (STACK_COLORS[key] !== undefined) return STACK_COLORS[key];
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const hue = ((hash % 360) + 360) % 360;
  return hslToHex(hue, 0.65, 0.55);
}

function hexCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

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
  private gitCollector = new GitActivityCollector();
  private projects: ProjectData[] = [];
  private allProjects: ProjectData[] = [];
  private filteredProjects: ProjectData[] = [];
  private selectedProject: ProjectData | null = null;
  private searchQuery = '';
  private statusFilter = 'all';
  private priorityFilter = 'all';
  private categoryFilter = 'all';
  private visualLayer: VisualLayer = 'status';
  private showLinks = false;
  private inspectorPanel: HTMLElement | null = null;
  private statusSelect: HTMLSelectElement | null = null;
  private prioritySelect: HTMLSelectElement | null = null;
  private categorySelect: HTMLSelectElement | null = null;
  private layerSelect: HTMLSelectElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private summaryEl: HTMLElement | null = null;
  private emptyStateEl: HTMLElement | null = null;
  private hudTopLeft: HTMLElement | null = null;
  private legendEl: HTMLElement | null = null;
  private lastQuestCounts = new Map<string, number>();

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
    // Add CSS class for vault mode styling
    if (this.settings.vaultMode) {
      this.containerEl.addClass('vault-mode');
    } else {
      this.containerEl.removeClass('vault-mode');
    }
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
    this.addCommandPanel(container);
    this.addInspectorPanel(container);
    this.addEmptyState(container);

    // Add agent switcher overlay if not in Vault Mode
    if (!this.settings.vaultMode) {
      // Top-left overlays stack in a flex column so the agents panel and
      // activity indicator never overlap each other.
      this.hudTopLeft = document.createElement('div');
      this.hudTopLeft.className = 'hypernovum-hud-topleft';
      container.appendChild(this.hudTopLeft);
      this.addAgentSwitcher(this.hudTopLeft);
    } else {
      container.addClass('vault-mode-active');

      // In Vault Mode, let users right-click the background to create a new project district
      const canvas = this.sceneManager.getCanvas();
      canvas.addEventListener('contextmenu', (e: MouseEvent) => {
        if (e.defaultPrevented) return; // Raycaster hit a building or orb
        e.preventDefault();
        const menu = new Menu();
        menu.addItem((item) => {
          item
            .setTitle('Create New Project')
            .setIcon('folder-plus')
            .onClick(() => {
              new FolderInputModal(this.app, async (folderPath) => {
                try {
                  // Attempt to create the folder if it doesn't exist
                  let folderCreated = false;
                  if (!this.app.vault.getAbstractFileByPath(folderPath)) {
                    await this.app.vault.createFolder(folderPath);
                    folderCreated = true;
                  }
                  // Ensure we have a markdown note acting as the district center
                  const folderName = folderPath.split('/').pop() || 'New Project';
                  const notePath = `${folderPath}/${folderName}.md`;
                  if (!this.app.vault.getAbstractFileByPath(notePath)) {
                    const newNote = await this.app.vault.create(notePath, `---
type: project
title: ${folderName}
status: active
priority: medium
category: default
---
# ${folderName}
`);
                    this.app.workspace.openLinkText(newNote.path, '', false);
                    new Notice(`Created new project: ${folderName}`);
                  } else if (folderCreated) {
                     new Notice(`Created project folder: ${folderPath}`);
                  } else {
                     new Notice(`Project folder already exists: ${folderPath}`);
                  }
                } catch (error: any) {
                  new Notice(`Failed to create project: ${error?.message ?? error}`);
                }
              }).open();
            });
        });
        menu.showAtMouseEvent(e);
      });
    }


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
      this.selectProject(hit.project);
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

    // Initialize Claude Code activity monitor only if not in Vault Mode
    if (!this.settings.vaultMode) {
      this.activityMonitor = new ActivityMonitor(this.app, {
        onActivityStart: (status) => this.onClaudeActivityStart(status),
        onActivityUpdate: (status) => this.onClaudeActivityUpdate(status),
        onActivityStop: () => this.onClaudeActivityStop(),
        onProjectChange: (newProject, oldProject) => {
        },
        onFleetUpdate: (agents) => this.onFleetUpdate(agents),
      });
      this.activityMonitor.start();

      // Add activity indicator overlay
      this.addActivityIndicator(this.hudTopLeft ?? container);
    }

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
    this.allProjects = await this.parser.parseProjects(this.settings);

    await Promise.all(this.allProjects.map(async (project) => {
      const projectPath = this.resolveProjectPath(project);
      const memoryContextPath = path.join(projectPath, '.hypernovum', 'MEMORY_CONTEXT.md');

      if (existsSync(memoryContextPath)) {
        project.hasMemoryContext = true;
        project.memoryContextPath = memoryContextPath;
      }

      if (this.settings.enableGitActivity) {
        const gitActivity = await this.gitCollector.collect(projectPath);
        if (gitActivity) {
          project.gitActivity = gitActivity;
        }
      }
    }));

    // Detect quests resolved since the last parse — celebrate after rebuild
    const resolvedPaths: string[] = [];
    for (const project of this.allProjects) {
      const prev = this.lastQuestCounts.get(project.path) ?? 0;
      const open = project.questions?.length ?? 0;
      if (open < prev) resolvedPaths.push(project.path);
      this.lastQuestCounts.set(project.path, open);
    }

    this.updateFilterOptions();
    this.applyFiltersAndRebuild();

    // Emerald shockwave on every building whose quest count dropped
    for (const path of resolvedPaths) {
      this.sceneManager?.flashBuilding(path);
    }
  }

  private applyFiltersAndRebuild(): void {
    const query = this.searchQuery.toLowerCase().trim();
    this.filteredProjects = this.allProjects.filter((project) => {
      const fields = [
        project.title,
        project.path,
        project.status,
        project.priority,
        project.category,
        project.projectDir,
        ...(project.stack ?? []),
      ].filter(Boolean).join(' ').toLowerCase();

      return (!query || fields.includes(query))
        && (this.statusFilter === 'all' || project.status === this.statusFilter)
        && (this.priorityFilter === 'all' || project.priority === this.priorityFilter)
        && (this.categoryFilter === 'all' || project.category === this.categoryFilter)
        && (this.visualLayer !== 'memory' || project.hasMemoryContext);
    });

    this.projects = this.filteredProjects;
    // Run bin-packing layout
    const districts = this.binPacker.packDistricts(this.filteredProjects);

    // Create buildings in scene
    if (this.sceneManager) {
      this.sceneManager.clearAllWeather();
      this.sceneManager.buildCity(this.filteredProjects, districts);

      if (this.visualLayer === 'git') {
        this.filteredProjects.forEach((project) => {
          if (!project.gitActivity) return;
          this.sceneManager?.applyWeather(project.path, {
            ...project.gitActivity,
            projectPath: project.path,
          });
        });
      } else if (this.visualLayer === 'tasks' || this.visualLayer === 'recency' || this.visualLayer === 'stack') {
        this.sceneManager.applyLayerColors(this.computeLayerColors(this.visualLayer));
      }

      if (this.showLinks) {
        this.sceneManager.showLinkArcs(this.computeLinkEdges());
      }
    }

    this.updateSummary();
    this.updateInspector();
    this.updateEmptyState();
    this.renderLegend();
  }

  /**
   * Backlink edges between visible projects. A file belongs to a project if
   * it IS the project note or lives inside the project's folder; links whose
   * endpoints belong to two different projects become undirected edges.
   */
  private computeLinkEdges(): LinkEdge[] {
    const resolved = this.app.metadataCache.resolvedLinks as Record<string, Record<string, number>>;
    const projects = this.filteredProjects;
    const byNote = new Map(projects.map((p) => [p.path, p]));
    const owners = projects.map((p) => ({ prefix: p.path.replace(/\.md$/, '/'), project: p }));
    const ownerOf = (file: string): ProjectData | undefined =>
      byNote.get(file) ?? owners.find((o) => file.startsWith(o.prefix))?.project;

    const edges = new Map<string, LinkEdge>();
    for (const [source, targets] of Object.entries(resolved)) {
      const a = ownerOf(source);
      if (!a) continue;
      for (const [target, count] of Object.entries(targets)) {
        const b = ownerOf(target);
        if (!b || b === a) continue;
        const key = a.path < b.path ? `${a.path}|${b.path}` : `${b.path}|${a.path}`;
        const edge = edges.get(key) ?? { from: a.path, to: b.path, count: 0 };
        edge.count += count;
        edges.set(key, edge);
      }
    }
    return [...edges.values()];
  }

  /** Per-project colors for the data-visualization scan modes */
  private computeLayerColors(layer: 'tasks' | 'recency' | 'stack'): Map<string, number> {
    const map = new Map<string, number>();
    const now = Date.now();

    for (const project of this.filteredProjects) {
      let color = NO_DATA_COLOR;
      if (layer === 'tasks') {
        if (project.totalTasks && project.totalTasks > 0) {
          color = rampHex(TASK_RAMP, (project.completedTasks ?? 0) / project.totalTasks);
        }
      } else if (layer === 'recency') {
        const days = (now - project.lastModified) / 86400000;
        color = rampHex(RECENCY_RAMP, days / 60);
      } else {
        const primary = project.stack?.[0];
        if (primary) color = stackColor(primary);
      }
      map.set(project.path, color);
    }
    return map;
  }

  private updateFilterOptions(): void {
    const applyOptions = (select: HTMLSelectElement | null, values: string[], current: string) => {
      if (!select) return;
      const selected = values.includes(current) ? current : 'all';
      select.replaceChildren();
      values.forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value === 'all' ? 'All' : value;
        select.appendChild(option);
      });
      select.value = selected;
    };

    const statuses = ['all', ...Array.from(new Set(this.allProjects.map((p) => p.status).filter(Boolean))).sort()];
    const priorities = ['all', ...Array.from(new Set(this.allProjects.map((p) => p.priority).filter(Boolean))).sort()];
    const categories = ['all', ...Array.from(new Set(this.allProjects.map((p) => p.category).filter(Boolean))).sort()];

    applyOptions(this.statusSelect, statuses, this.statusFilter);
    applyOptions(this.prioritySelect, priorities, this.priorityFilter);
    applyOptions(this.categorySelect, categories, this.categoryFilter);
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
      { id: 'claude', name: 'Claude Code', command: 'claude', icon: '>', color: '#ff922b', installHint: 'npm i -g @anthropic-ai/claude-code' },
      { id: 'codex', name: 'GPT Codex', command: 'codex', icon: 'C', color: '#6bcb77', installHint: 'npm i -g @openai/codex' },
      { id: 'antigravity', name: 'Antigravity CLI', command: 'agy', icon: 'A', color: '#4d96ff', installHint: 'curl -fsSL https://antigravity.google/cli/install.sh | bash' },
    ];

    const panel = document.createElement('div');
    panel.className = 'agents-panel';
    panel.innerHTML = `
      <div class="agents-header">
        <div>
          <span class="agents-title">AGENTS</span>
          <div class="agents-subtitle">Right-click a building to launch</div>
        </div>
      </div>
      <div class="agents-list"></div>
      <div class="agents-abilities" style="display: none;">
        <div class="agents-abilities-header">ABILITIES &middot; <span class="abilities-count">0</span></div>
        <div class="agents-abilities-list"></div>
      </div>
      <div class="agents-not-installed" style="display: none;">
        <button class="agents-not-installed-toggle">
          Available to Install (<span class="not-installed-count">0</span>)
        </button>
        <div class="agents-not-installed-list" style="display: none; padding-bottom: 4px;"></div>
      </div>
      <button class="agents-prepare-btn" title="Write AGENTS.md at the vault root so agents understand your projects">Prepare vault &middot; AGENTS.md</button>
    `;

    const prepareBtn = panel.querySelector('.agents-prepare-btn') as HTMLButtonElement;
    prepareBtn.addEventListener('click', async () => {
      prepareBtn.disabled = true;
      await this.plugin.prepareVaultForAgents();
      prepareBtn.textContent = '✓ AGENTS.md updated';
      setTimeout(() => {
        prepareBtn.textContent = 'Prepare vault · AGENTS.md';
        prepareBtn.disabled = false;
      }, 2000);
    });

    const list = panel.querySelector('.agents-list') as HTMLElement;
    const notInstalledSection = panel.querySelector('.agents-not-installed') as HTMLElement;
    const toggleBtn = panel.querySelector('.agents-not-installed-toggle') as HTMLElement;
    const notInstalledList = panel.querySelector('.agents-not-installed-list') as HTMLElement;
    const countSpan = panel.querySelector('.not-installed-count') as HTMLElement;

    let showNotInstalled = false;
    toggleBtn.addEventListener('click', () => {
      showNotInstalled = !showNotInstalled;
      notInstalledList.style.display = showNotInstalled ? 'block' : 'none';
      toggleBtn.innerHTML = `${showNotInstalled ? '\u25BE' : '\u25B8'} Available to Install (<span class="not-installed-count">${countSpan.textContent}</span>)`;
    });

    const detectedMap: Record<string, boolean> = {};

    const checkCommand = (cmd: string): Promise<boolean> => {
      return new Promise((resolve) => {
        const check = Platform.isWin ? `where ${cmd}` : `which ${cmd}`;
        exec(check, { timeout: 2000 }, (error) => {
          resolve(!error);
        });
      });
    };

    const renderAgents = () => {
      list.empty();
      notInstalledList.empty();
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
          color: '#cc5de8',
          installHint: ''
        });
        detectedMap[currentCommand] = true; // Assume custom is valid if selected
      }

      const installed = agentsToRender.filter(a => detectedMap[a.command] !== false);
      const notInstalled = agentsToRender.filter(a => detectedMap[a.command] === false);

      // Render installed — DOM API, not innerHTML: agent.name/icon can come
      // from user settings (custom agent) and must land as text, not markup.
      for (const agent of installed) {
        const item = document.createElement('div');
        item.className = 'agents-item' + (currentCommand === agent.command ? ' active' : '');
        const iconCircle = item.createDiv({ cls: 'agents-icon-circle', text: agent.icon });
        iconCircle.style.background = agent.color;
        item.createSpan({ cls: 'agents-item-name', text: agent.name });
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

      // Render not installed
      if (notInstalled.length > 0) {
        notInstalledSection.style.display = 'block';
        countSpan.textContent = notInstalled.length.toString();
        toggleBtn.empty();
        toggleBtn.appendText(`${showNotInstalled ? '\u25BE' : '\u25B8'} Available to Install (`);
        toggleBtn.createSpan({ cls: 'not-installed-count', text: String(notInstalled.length) });
        toggleBtn.appendText(')');

        for (const agent of notInstalled) {
          const item = document.createElement('div');
          item.className = 'agents-item not-detected';
          const iconCircle = item.createDiv({ cls: 'agents-icon-circle', text: agent.icon });
          iconCircle.style.background = `${agent.color}55`;
          item.createSpan({ cls: 'agents-item-name', text: agent.name });
          const installBtn = item.createEl('button', {
            cls: 'agents-install-pill',
            text: 'Install',
            attr: { title: agent.installHint },
          });
          installBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(agent.installHint);
            installBtn.textContent = '\u2713 Copied';
            installBtn.style.borderColor = '#00cc66';
            installBtn.style.color = '#00cc66';
            setTimeout(() => { 
              installBtn.textContent = 'Install'; 
              installBtn.style.borderColor = '';
              installBtn.style.color = '';
            }, 1500);
          });
          
          notInstalledList.appendChild(item);
        }
      } else {
        notInstalledSection.style.display = 'none';
      }
    };
    
    // Initial render assuming all are detected until check finishes
    renderAgents();
    container.appendChild(panel);

    // Run async checks to detect installed agents
    Promise.all(KNOWN_AGENTS.map(async (agent) => {
      detectedMap[agent.command] = await checkCommand(agent.command);
    })).then(() => {
      renderAgents();
    });

    this.renderAbilities(panel);
  }

  /**
   * ABILITIES section — agent skills discovered from SKILL.md files
   * (vault .claude/skills/ and global ~/.claude/skills/). Click copies an
   * invocation phrase to paste into any agent prompt.
   */
  private renderAbilities(panel: HTMLElement): void {
    const section = panel.querySelector('.agents-abilities') as HTMLElement;
    const list = panel.querySelector('.agents-abilities-list') as HTMLElement;
    const count = panel.querySelector('.abilities-count') as HTMLElement;
    if (!section || !list || !count) return;

    const vaultPath = (this.app.vault.adapter as any).basePath as string;
    const skills = scanSkills(vaultPath);
    if (skills.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'block';
    count.textContent = String(skills.length);
    list.empty();

    for (const skill of skills) {
      const item = list.createDiv({ cls: 'agents-item ability' });
      item.createSpan({ cls: 'ability-gem', text: '◆' });
      item.createSpan({ cls: 'agents-item-name', text: skill.name });
      item.createSpan({ cls: 'ability-scope', text: skill.scope === 'vault' ? 'V' : 'G' });
      item.title = `${skill.description || skill.name}\n${skill.path}\nClick to copy invocation`;
      item.addEventListener('click', () => {
        navigator.clipboard.writeText(`Use the "${skill.name}" skill (${skill.path})`);
        const gem = item.querySelector('.ability-gem') as HTMLElement;
        if (gem) {
          gem.textContent = '✓';
          gem.classList.add('copied');
          setTimeout(() => {
            gem.textContent = '◆';
            gem.classList.remove('copied');
          }, 1200);
        }
      });
    }
  }

  private addLegend(container: HTMLElement): void {
    const legend = document.createElement('div');
    legend.className = 'hypernovum-legend';
    legend.innerHTML = `
      <div class="legend-kicker"></div>
      <div class="legend-body"></div>
    `;
    this.legendEl = legend;
    container.appendChild(legend);
    this.renderLegend();
  }

  /** Adaptive legend — reads out whatever the active scan mode encodes */
  private renderLegend(): void {
    if (!this.legendEl) return;
    const kicker = this.legendEl.querySelector('.legend-kicker') as HTMLElement;
    const body = this.legendEl.querySelector('.legend-body') as HTMLElement;
    if (!kicker || !body) return;

    const modeNames: Record<VisualLayer, string> = {
      status: 'STATUS',
      git: 'GIT ACTIVITY',
      memory: 'MEMORY',
      tasks: 'TASK PROGRESS',
      recency: 'RECENCY',
      stack: 'TECH STACK',
    };
    kicker.textContent = `SCAN · ${modeNames[this.visualLayer]}`;

    const chip = (color: string) =>
      `<span class="legend-chip" style="background:${color};box-shadow:0 0 6px ${color}88"></span>`;

    switch (this.visualLayer) {
      case 'git':
        body.innerHTML = `
          <div class="legend-section">
            <div class="legend-label">Signal &middot; Meaning</div>
            <div class="legend-list">
              <div class="legend-item">${chip('#ff6600')}Hot glow &mdash; high commit churn</div>
              <div class="legend-item">${chip('#dd3333')}Glitch &mdash; merge conflict</div>
              <div class="legend-item">${chip('#6b6b7a')}Dim &mdash; stale repository</div>
            </div>
            <div class="legend-note">Status colors still apply beneath signals</div>
          </div>
        `;
        break;

      case 'memory': {
        const ready = this.allProjects.filter((p) => p.hasMemoryContext).length;
        body.innerHTML = `
          <div class="legend-section">
            <div class="legend-label">Filter &middot; Memory</div>
            <div class="legend-list">
              <div class="legend-item">${chip('#66e0a3')}Memory-ready projects only</div>
            </div>
            <div class="legend-note">${ready} of ${this.allProjects.length} projects carry MEMORY_CONTEXT.md</div>
          </div>
        `;
        break;
      }

      case 'tasks':
        body.innerHTML = `
          <div class="legend-section">
            <div class="legend-label">Completion &middot; Color</div>
            <div class="legend-gradient" style="background:linear-gradient(to right,${TASK_RAMP.map(hexCss).join(',')})"></div>
            <div class="legend-range"><span>0%</span><span>100%</span></div>
            <div class="legend-list legend-footnote">
              <div class="legend-item">${chip(hexCss(NO_DATA_COLOR))}No tasks tracked</div>
            </div>
          </div>
        `;
        break;

      case 'recency':
        body.innerHTML = `
          <div class="legend-section">
            <div class="legend-label">Last Touched &middot; Heat</div>
            <div class="legend-gradient" style="background:linear-gradient(to right,${RECENCY_RAMP.map(hexCss).join(',')})"></div>
            <div class="legend-range"><span>Today</span><span>60d+</span></div>
          </div>
        `;
        break;

      case 'stack': {
        const counts = new Map<string, number>();
        for (const p of this.allProjects) {
          const primary = p.stack?.[0]?.trim();
          if (primary) counts.set(primary, (counts.get(primary) ?? 0) + 1);
        }
        const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
        const rows = top.map(([name, count]) =>
          `<div class="legend-item">${chip(hexCss(stackColor(name)))}${this.escapeHtml(name)} · ${count}</div>`
        ).join('');
        body.innerHTML = `
          <div class="legend-section">
            <div class="legend-label">Primary Stack &middot; Color</div>
            <div class="legend-list">
              ${rows || `<div class="legend-item">${chip(hexCss(NO_DATA_COLOR))}No stacks declared</div>`}
            </div>
            ${rows ? `<div class="legend-list legend-footnote"><div class="legend-item">${chip(hexCss(NO_DATA_COLOR))}No stack declared</div></div>` : ''}
          </div>
        `;
        break;
      }

      default:
        body.innerHTML = `
          <div class="legend-section">
            <div class="legend-label">Status &middot; Color</div>
            <div class="legend-grid">
              <div class="legend-item"><span class="legend-chip active"></span>Active</div>
              <div class="legend-item"><span class="legend-chip blocked"></span>Blocked</div>
              <div class="legend-item"><span class="legend-chip paused"></span>Paused</div>
              <div class="legend-item"><span class="legend-chip complete"></span>Complete</div>
            </div>
          </div>
          <div class="legend-section">
            <div class="legend-label">Priority &middot; Height</div>
            <div class="legend-skyline">
              <div class="legend-bars">
                <div class="legend-bar h1"></div>
                <div class="legend-bar h2"></div>
                <div class="legend-bar h3"></div>
                <div class="legend-bar h4"></div>
              </div>
              <div class="legend-range"><span>Low</span><span>Critical</span></div>
            </div>
          </div>
        `;
    }
  }

  private addControlsHint(container: HTMLElement): void {
    const controls = document.createElement('div');
    controls.className = 'hypernovum-controls';
    controls.innerHTML = `
      <div class="controls-row"><kbd>Click</kbd><span>Open note</span></div>
      <div class="controls-row"><kbd>Right-click</kbd><span>Actions menu</span></div>
      <div class="controls-row"><kbd>Dbl-click</kbd><span>Move building</span></div>
      <div class="controls-row"><kbd>Right-drag</kbd><span>Pan</span></div>
      <div class="controls-row"><kbd>Scroll</kbd><span>Zoom</span></div>
      <div class="controls-row"><kbd>B / S</kbd><span>Cycle blocked / stale</span></div>
      <div class="controls-row"><kbd>Space</kbd><span>Reset camera</span></div>
    `;
    container.appendChild(controls);
  }

  private addEmptyState(container: HTMLElement): void {
    const el = document.createElement('div');
    el.className = 'hypernovum-empty-state';
    el.style.display = 'none';
    this.emptyStateEl = el;
    container.appendChild(el);
  }

  private updateEmptyState(): void {
    const el = this.emptyStateEl;
    if (!el) return;

    const noProjects = this.allProjects.length === 0;
    const noMatches = !noProjects && this.filteredProjects.length === 0;

    if (!noProjects && !noMatches) {
      el.style.display = 'none';
      return;
    }

    el.empty();
    el.style.display = 'block';

    if (noProjects) {
      el.createDiv({ cls: 'empty-kicker', text: 'AWAITING CITY DATA' });
      el.createEl('h3', { text: 'No project notes found' });
      el.createEl('p', { text: 'Hypernovum builds the city from notes tagged as projects. Add this frontmatter to any note:' });
      el.createEl('pre', { text: '---\ntags: [project]\nstatus: active\npriority: high\ncategory: web-apps\n---' });
      const actions = el.createDiv({ cls: 'empty-actions' });
      const btn = actions.createEl('button', { text: 'Create sample project' });
      btn.addEventListener('click', () => this.createSampleProject());
      if (!this.settings.vaultMode) {
        const prepBtn = actions.createEl('button', { text: 'Prepare vault for agents' });
        prepBtn.addEventListener('click', () => this.plugin.prepareVaultForAgents());
      }
    } else {
      el.createDiv({ cls: 'empty-kicker', text: 'NO SIGNAL' });
      el.createEl('h3', { text: 'No projects match' });
      el.createEl('p', { text: 'The current search and filters exclude every project.' });
      const btn = el.createEl('button', { text: 'Clear filters' });
      btn.addEventListener('click', () => this.clearFilters());
    }
  }

  private async createSampleProject(): Promise<void> {
    const notePath = 'Sample Project.md';
    try {
      if (!this.app.vault.getAbstractFileByPath(notePath)) {
        await this.app.vault.create(notePath, `---
tags: [project]
title: Sample Project
status: active
priority: high
category: web-apps
stack: [TypeScript, Three.js]
---

# Sample Project

Duplicate this note and edit the frontmatter to add your own projects to the city.
`);
      }
      this.app.workspace.openLinkText(notePath, '', false);
      await this.buildCity();
    } catch (error: any) {
      new Notice(`Failed to create sample project: ${error?.message ?? error}`);
    }
  }

  private clearFilters(): void {
    this.searchQuery = '';
    this.statusFilter = 'all';
    this.priorityFilter = 'all';
    this.categoryFilter = 'all';
    this.visualLayer = 'status';
    if (this.searchInput) this.searchInput.value = '';
    if (this.statusSelect) this.statusSelect.value = 'all';
    if (this.prioritySelect) this.prioritySelect.value = 'all';
    if (this.categorySelect) this.categorySelect.value = 'all';
    if (this.layerSelect) this.layerSelect.value = 'status';
    this.applyFiltersAndRebuild();
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

    const snapBtn = document.createElement('button');
    snapBtn.className = 'hypernovum-save-btn hypernovum-snapshot-btn';
    snapBtn.textContent = 'Snapshot';
    snapBtn.title = 'Save a clean PNG of the city (no HUD) into the vault';
    snapBtn.addEventListener('click', () => this.captureSnapshot());
    container.appendChild(snapBtn);
  }

  /** Capture the city, composite a title card, and save as a PNG in the vault */
  private async captureSnapshot(): Promise<void> {
    if (!this.sceneManager) return;
    try {
      const dataUrl = this.sceneManager.captureSnapshot();
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('capture failed'));
        img.src = dataUrl;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      // Cinematic lower-third title card
      const barH = Math.max(54, Math.round(img.height * 0.09));
      const gradient = ctx.createLinearGradient(0, img.height - barH * 1.6, 0, img.height);
      gradient.addColorStop(0, 'rgba(6, 10, 18, 0)');
      gradient.addColorStop(1, 'rgba(6, 10, 18, 0.92)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, img.height - barH * 1.6, img.width, barH * 1.6);

      const pad = Math.round(barH * 0.42);
      ctx.fillStyle = '#b366ff';
      ctx.font = `700 ${Math.round(barH * 0.34)}px monospace`;
      ctx.shadowColor = '#b366ff';
      ctx.shadowBlur = 12;
      ctx.fillText('H Y P E R N O V U M', pad, img.height - pad);
      ctx.shadowBlur = 0;

      const date = new Date().toISOString().slice(0, 10);
      const stats = `${this.filteredProjects.length} PROJECTS · ${date}`;
      ctx.fillStyle = 'rgba(200, 215, 240, 0.75)';
      ctx.font = `${Math.round(barH * 0.22)}px monospace`;
      const statsWidth = ctx.measureText(stats).width;
      ctx.fillText(stats, img.width - statsWidth - pad, img.height - pad);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('encode failed');
      const notePath = `Hypernovum Snapshot ${date}.png`;
      await this.app.vault.adapter.writeBinary(notePath, await blob.arrayBuffer());
      new Notice(`Snapshot saved: ${notePath}`);
    } catch (error: any) {
      new Notice(`Snapshot failed: ${error?.message ?? error}`);
    }
  }

  private addCommandPanel(container: HTMLElement): void {
    const panel = document.createElement('div');
    panel.className = 'hypernovum-command-panel';
    panel.innerHTML = `
      <div class="command-panel-header">
        <span class="command-panel-title">PROJECTS</span>
        <span class="command-panel-summary">Loading...</span>
      </div>
      <input class="command-search" type="search" placeholder="Search projects" />
      <div class="command-row">
        <label>Layer</label>
        <select class="layer-select">
          <option value="status">Status</option>
          <option value="git">Git Activity</option>
          <option value="memory">Memory Ready</option>
          <option value="tasks">Task Progress</option>
          <option value="recency">Recency</option>
          <option value="stack">Tech Stack</option>
        </select>
      </div>
      <div class="command-filters">
        <select class="status-select"><option value="all">All status</option></select>
        <select class="priority-select"><option value="all">All priority</option></select>
        <select class="category-select"><option value="all">All categories</option></select>
      </div>
      <button class="links-toggle" title="Show vault backlinks between projects as knowledge arcs">NEURAL LINKS &middot; OFF</button>
    `;

    const searchInput = panel.querySelector('.command-search') as HTMLInputElement;
    const layerSelect = panel.querySelector('.layer-select') as HTMLSelectElement;
    this.searchInput = searchInput;
    this.layerSelect = layerSelect;
    this.statusSelect = panel.querySelector('.status-select') as HTMLSelectElement;
    this.prioritySelect = panel.querySelector('.priority-select') as HTMLSelectElement;
    this.categorySelect = panel.querySelector('.category-select') as HTMLSelectElement;
    this.summaryEl = panel.querySelector('.command-panel-summary') as HTMLElement;

    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      this.applyFiltersAndRebuild();
    });

    layerSelect.addEventListener('change', () => {
      this.visualLayer = layerSelect.value as VisualLayer;
      this.applyFiltersAndRebuild();
    });

    this.statusSelect.addEventListener('change', () => {
      this.statusFilter = this.statusSelect?.value ?? 'all';
      this.applyFiltersAndRebuild();
    });

    this.prioritySelect.addEventListener('change', () => {
      this.priorityFilter = this.prioritySelect?.value ?? 'all';
      this.applyFiltersAndRebuild();
    });

    this.categorySelect.addEventListener('change', () => {
      this.categoryFilter = this.categorySelect?.value ?? 'all';
      this.applyFiltersAndRebuild();
    });

    const linksToggle = panel.querySelector('.links-toggle') as HTMLButtonElement;
    linksToggle.addEventListener('click', () => {
      this.showLinks = !this.showLinks;
      linksToggle.textContent = `NEURAL LINKS · ${this.showLinks ? 'ON' : 'OFF'}`;
      linksToggle.classList.toggle('active', this.showLinks);
      if (this.showLinks) {
        this.sceneManager?.showLinkArcs(this.computeLinkEdges());
      } else {
        this.sceneManager?.clearLinkArcs();
      }
    });

    container.appendChild(panel);
  }

  private addInspectorPanel(container: HTMLElement): void {
    const panel = document.createElement('div');
    panel.className = 'hypernovum-project-inspector';
    panel.innerHTML = '<div class="inspector-empty">Select a project</div>';
    this.inspectorPanel = panel;
    container.appendChild(panel);
  }

  private selectProject(project: ProjectData): void {
    this.selectedProject = project;

    if (project.position && this.sceneManager) {
      this.sceneManager.setFocusedProject(project);
    }

    this.updateInspector();
  }

  private updateSummary(): void {
    if (!this.summaryEl) return;
    const gitCount = this.allProjects.filter((p) => p.gitActivity).length;
    const memoryCount = this.allProjects.filter((p) => p.hasMemoryContext).length;
    const questCount = this.allProjects.reduce((sum, p) => sum + (p.questions?.length ?? 0), 0);
    const questPart = questCount > 0 ? ` | ◆ ${questCount} quests` : '';
    this.summaryEl.textContent = `${this.filteredProjects.length}/${this.allProjects.length} shown | ${gitCount} git | ${memoryCount} memory${questPart}`;
  }

  private updateInspector(): void {
    if (!this.inspectorPanel) return;

    if (!this.selectedProject) {
      this.renderCityOverview();
      return;
    }

    const project = this.selectedProject;
    const projectPath = this.resolveProjectPath(project);
    const git = project.gitActivity;
    const memoryState = project.hasMemoryContext ? 'Ready' : 'Not found';

    this.inspectorPanel.innerHTML = `
      <div class="inspector-header">
        <span class="inspector-kicker">PROJECT</span>
        <button class="inspector-close" title="Back to city overview">✕</button>
        <h3>${this.escapeHtml(project.title)}</h3>
      </div>
      <div class="inspector-grid">
        <div><span>Status</span><strong>${this.escapeHtml(project.status)}</strong></div>
        <div><span>Priority</span><strong>${this.escapeHtml(project.priority)}</strong></div>
        <div><span>Category</span><strong>${this.escapeHtml(project.category)}</strong></div>
        <div><span>Memory</span><strong>${memoryState}</strong></div>
      </div>
      <div class="inspector-section">
        <span class="section-label">Git Signals</span>
        <div class="signal-row"><span>Branch</span><strong>${this.escapeHtml(git?.activeBranch ?? 'n/a')}</strong></div>
        <div class="signal-row"><span>Last commit</span><strong>${git?.lastCommitDate ? this.formatRelativeTime(git.lastCommitDate) : 'n/a'}</strong></div>
        <div class="signal-row"><span>30d commits</span><strong>${git?.commitsLast30d ?? 0}</strong></div>
        <div class="signal-row"><span>Working tree</span><strong>${git?.hasUncommittedChanges ? 'Changed' : 'Clean'}</strong></div>
      </div>
      ${project.questions && project.questions.length > 0 ? `
      <div class="inspector-section">
        <span class="section-label">Open Quests${project.answeredQuestions?.length ? ` · ${project.answeredQuestions.length} resolved` : ''}</span>
        ${project.questions.map((q) => `<div class="quest-row"><span class="quest-gem">◆</span>${this.escapeHtml(q)}</div>`).join('')}
      </div>` : ''}
      <div class="inspector-path">${this.escapeHtml(projectPath)}</div>
      <div class="inspector-actions">
        <button data-action="note">Open Note</button>
        <button data-action="folder">Folder</button>
        <button data-action="agent">Launch Agent</button>
        <button data-action="context">Context</button>
        <button data-action="focus">Focus</button>
      </div>
    `;

    this.inspectorPanel.querySelector('.inspector-close')?.addEventListener('click', () => {
      this.selectedProject = null;
      this.updateInspector();
    });

    this.inspectorPanel.querySelector('[data-action="note"]')?.addEventListener('click', () => {
      this.app.workspace.openLinkText(project.path, '', false);
    });

    this.inspectorPanel.querySelector('[data-action="folder"]')?.addEventListener('click', async () => {
      const result = await TerminalLauncher.openInExplorer(projectPath);
      new Notice(result.success ? `Opened ${project.title} folder` : `Failed to open folder: ${result.message}`);
    });

    this.inspectorPanel.querySelector('[data-action="agent"]')?.addEventListener('click', async () => {
      await this.launchAgentForProject(project, projectPath);
    });

    this.inspectorPanel.querySelector('[data-action="context"]')?.addEventListener('click', () => {
      this.copyAgentContext(project, projectPath);
    });

    this.inspectorPanel.querySelector('[data-action="focus"]')?.addEventListener('click', () => {
      if (project.position && this.sceneManager) {
        this.sceneManager.focusOnPosition(project.position);
        this.sceneManager.setFocusedProject(project);
      }
    });
  }

  /** District analytics readout shown when no building is selected */
  private renderCityOverview(): void {
    if (!this.inspectorPanel) return;
    const projects = this.filteredProjects;

    if (projects.length === 0) {
      this.inspectorPanel.innerHTML = '<div class="inspector-empty">No projects in view</div>';
      return;
    }

    const active = projects.filter((p) => p.status === 'active').length;
    const blocked = projects.filter((p) => p.status === 'blocked').length;
    const quests = projects.reduce((sum, p) => sum + (p.questions?.length ?? 0), 0);
    const commits30d = projects.reduce((sum, p) => sum + (p.gitActivity?.commitsLast30d ?? 0), 0);

    const districts = new Map<string, ProjectData[]>();
    for (const p of projects) {
      const list = districts.get(p.category) ?? [];
      list.push(p);
      districts.set(p.category, list);
    }
    const districtRows = [...districts.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([category, list]) => {
        const activeCount = list.filter((p) => p.status === 'active').length;
        const questCount = list.reduce((sum, p) => sum + (p.questions?.length ?? 0), 0);
        const questPart = questCount > 0 ? ` · ◆${questCount}` : '';
        return `<div class="signal-row"><span>${this.escapeHtml(category)}</span><strong>${list.length} · ${activeCount} active${questPart}</strong></div>`;
      })
      .join('');

    this.inspectorPanel.innerHTML = `
      <div class="inspector-header">
        <span class="inspector-kicker">CITY OVERVIEW</span>
        <h3>${projects.length} projects</h3>
      </div>
      <div class="inspector-grid">
        <div><span>Active</span><strong>${active}</strong></div>
        <div><span>Blocked</span><strong>${blocked}</strong></div>
        <div><span>Open quests</span><strong>${quests}</strong></div>
        <div><span>30d commits</span><strong>${commits30d}</strong></div>
      </div>
      <div class="inspector-section">
        <span class="section-label">Districts</span>
        ${districtRows}
      </div>
      <div class="inspector-empty">Select a building for details</div>
    `;
  }

  private copyAgentContext(project: ProjectData, projectPath: string): void {
    const vaultPath = (this.app.vault.adapter as any).basePath as string;
    generateAgentContext(projectPath, vaultPath, {
      project,
      weather: project.gitActivity ?? null,
      memoryContextPath: project.memoryContextPath ?? null,
    });

    const setupPath = path.join(projectPath, '.hypernovum', 'SETUP.md');
    navigator.clipboard.writeText(setupPath);
    new Notice('Agent context path copied');
  }

  private formatRelativeTime(epochMs: number): string {
    const elapsedMs = Date.now() - epochMs;
    const days = Math.floor(elapsedMs / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return '1 day ago';
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    return months === 1 ? '1 month ago' : `${months} months ago`;
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char] ?? char));
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

  /** Render one orbiting orb per active agent (fleet presence) */
  private onFleetUpdate(agents: AgentPresence[]): void {
    if (!this.sceneManager) return;
    this.sceneManager.updateAgentPresence(
      agents.map((a) => ({
        id: a.id,
        projectPath: a.project
          ? this.sceneManager?.findProjectByName(a.project)?.path ?? null
          : null,
      })),
    );
  }

  /** Handle Claude Code activity start */
  private onClaudeActivityStart(status: ActivityStatus): void {

    this.updateActivityIndicator(status, true);

    if (!this.sceneManager || !status.project) return;

    // Try to find the project in our city
    const project = this.sceneManager.findProjectByName(status.project);
    if (project) {
      this.sceneManager.startStreaming(project.path);
    } else {
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
        .setTitle('Inspect project')
        .setIcon('panel-right')
        .onClick(() => {
          this.selectProject(project);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Open folder')
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
        .setTitle('Open note')
        .setIcon('file-text')
        .onClick(() => {
          this.app.workspace.openLinkText(project.path, '', false);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Focus camera')
        .setIcon('crosshair')
        .onClick(() => {
          if (project.position && this.sceneManager) {
            this.sceneManager.focusOnPosition(project.position);
            this.selectProject(project);
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
    generateAgentContext(projectPath, vaultPath, {
      project,
      weather: project.gitActivity ?? null,
      memoryContextPath: project.memoryContextPath ?? null,
    });

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
    // All styling lives in styles.css (.hypernovum-hud-title).
    title.className = 'hypernovum-hud-title';

    const cursor = document.createElement('span');
    cursor.textContent = '\u2588';
    // Keyframes + animation live in styles.css (.hypernovum-cursor) \u2014 never
    // inject <style> into document.head; it leaks across plugin reloads.
    cursor.className = 'hypernovum-cursor';
    title.textContent = 'HYPERNOVUM';
    title.appendChild(cursor);

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


