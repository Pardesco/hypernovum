import { ItemView, WorkspaceLeaf, App, Notice, TFile, Menu, Modal, Setting, Platform, debounce } from 'obsidian';
import { existsSync, statSync } from 'fs';
import { execFile } from 'child_process';
import * as path from 'path';
import { SceneManager, BinPacker, BuildingRaycaster, KeyboardNav, createInteractionStore } from '@hypernovum/core';
import type { ProjectData, BlockPosition, RaycastHit, GraphEdge, EdgeType, TraceImpactResult } from '@hypernovum/core';
import { collectImpact } from '@hypernovum/core';
import { DependencyScanner } from '../monitors/DependencyScanner';
import { resolveProjectRef, type DependencyScanResult } from '../monitors/dependencyMatch';
import { SessionReader } from '../monitors/SessionReader';
import type { SessionDigest } from '../monitors/sessionDigest';
import { filterProjects } from '../utils/projectFilter';
import { ProjectParser } from '../parsers/ProjectParser';
import { MetadataExtractor } from '../parsers/MetadataExtractor';
import { ActivityMonitor, type ActivityStatus, type AgentPresence } from '../monitors/ActivityMonitor';
import { AgentRegistry, type AgentSession } from '../monitors/AgentRegistry';
import { detectConflicts, type ConflictRecord } from '../monitors/ConflictDetector';
import {
  computeWarnings,
  topWarningPerProject,
  warningBadgeCount,
  topSeverityByProject,
  type WarningItem,
  type WarningSeverity,
} from '../monitors/WarningAggregator';
import {
  BUILT_IN_LENSES,
  stateToPreset,
  presetToState,
  nextPresetId,
  type LensState,
} from '../utils/lensPresets';
import type { LensPreset } from '../settings/SettingsTab';
import { GitActivityCollector } from '../monitors/GitActivityCollector';
import { TerminalLauncher } from '../utils/TerminalLauncher';
import { mapLimit } from '../utils/concurrency';
import { generateAgentContext } from '../utils/AgentContext';
import { scanSkills } from '../utils/SkillsScanner';
import { getVaultBasePath, heartbeatPaths } from '../utils/HeartbeatInstaller';
import {
  DIR_SOURCE_LABEL,
  resolveProjectDir,
  samePath,
  type ResolvedProjectDir,
} from '../utils/projectPaths';
import { createBinaryVaultFile } from '../utils/vaultFiles';
import type { HypernovumSettings } from '../settings/SettingsTab';
import type HypernovumPlugin from '../main';

export const VIEW_TYPE = 'hypernovum-view';

type VisualLayer = 'status' | 'git' | 'memory' | 'tasks' | 'recency' | 'stack' | 'attention';

interface DirectoryDialog {
  showOpenDialog(options: {
    properties: Array<'openDirectory' | 'createDirectory'>;
    title: string;
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

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

/** Colored legend swatch. The glow colour is data-derived, so it stays in JS. */
function appendLegendChip(parent: HTMLElement, color: string): HTMLElement {
  const chip = parent.createSpan({ cls: 'legend-chip' });
  chip.setCssProps({
    '--hypernovum-legend-color': color,
    '--hypernovum-legend-glow': `${color}88`,
  });
  return chip;
}

function appendLegendItem(parent: HTMLElement, color: string, text: string): HTMLElement {
  const item = parent.createDiv({ cls: 'legend-item' });
  appendLegendChip(item, color);
  item.appendText(text);
  return item;
}

function appendOption(select: HTMLSelectElement, value: string, text: string): HTMLOptionElement {
  return select.createEl('option', { text, attr: { value } });
}

/**
 * True when the path exists AND is a directory. `existsSync` alone matched files
 * too, so a note called `Thing` next to `Thing.md` could be handed back as a
 * project "directory".
 */
function isDirectory(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
}

/** Markers that make a directory a project root in its own right. */
const PROJECT_ROOT_MARKERS = [
  '.git',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'Gemfile',
  'composer.json',
  '.hypernovum',
];

/**
 * True when the directory looks like a project of its own.
 *
 * Used to reject a plain notes folder as a project directory: without it, every
 * note in `Projects/` resolved to `Projects/` itself and unrelated projects shared
 * one repo's Git data and one agent working directory.
 */
function isProjectRoot(absolutePath: string): boolean {
  return PROJECT_ROOT_MARKERS.some((marker) => existsSync(path.join(absolutePath, marker)));
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
  /** Live agent session registry (§10 lifecycle), fed by the fleet monitor */
  private agentRegistry = new AgentRegistry((p) => this.resolveAgentProjectPath(p));
  /** Latest registry snapshot — drives orbs, inspector Agents section, conflicts */
  private fleetSessions: AgentSession[] = [];
  /** Latest deterministic conflicts (recomputed, throttled) */
  private conflicts: ConflictRecord[] = [];
  private lastConflictRun = 0;
  /** Latest §11 warnings + the count of unreadable data files this poll */
  private warnings: WarningItem[] = [];
  private degradedCount = 0;
  private attentionBadge: HTMLElement | null = null;
  private presetSelect: HTMLSelectElement | null = null;
  private presetDeleteBtn: HTMLButtonElement | null = null;
  private gitCollector = new GitActivityCollector();
  private projects: ProjectData[] = [];
  private allProjects: ProjectData[] = [];
  private filteredProjects: ProjectData[] = [];
  /** Single source of truth for selection/hover/move-mode (shared with SceneManager) */
  private interactionStore = createInteractionStore();

  /** Selected project resolved from the store — paths survive rebuilds, objects don't */
  private get selectedProject(): ProjectData | null {
    const path = this.interactionStore.getState().selectedPath;
    if (!path) return null;
    return this.allProjects.find((p) => p.path === path) ?? null;
  }
  private searchQuery = '';
  private statusFilter = 'all';
  private priorityFilter = 'all';
  private categoryFilter = 'all';
  private visualLayer: VisualLayer = 'status';
  /** Active edge types (EDG-006). Default: agents on, structural edges off. */
  private edgeTypes = new Set<EdgeType>(['agent-working-on']);
  /** Structural edges (backlink/blocked-by/depends-on), recomputed on rebuild. */
  private structuralEdges: GraphEdge[] = [];
  private depScanner = new DependencyScanner();
  private depScan = new Map<string, DependencyScanResult>();
  /** allProjects with projectDir resolved to absolute — for conflict normalization */
  private conflictProjects: ProjectData[] = [];
  private edgeChips: HTMLButtonElement[] = [];
  private sessionReader = new SessionReader();
  /** Active trace-impact overlay result (IMP-002), null when not tracing. */
  private traceResult: TraceImpactResult | null = null;
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
  /** Absolute vault path, or null when the vault isn't on a local filesystem. */
  private vaultBase: string | null = null;
  /**
   * Resolved working directory per project note path, recomputed each rebuild.
   * `null` means "couldn't determine one" — previously this silently became the
   * vault root, which handed every project the vault's Git stats.
   */
  private projectDirs = new Map<string, ResolvedProjectDir | null>();
  /**
   * Hash of the last inspector render. The fleet poller ticks every 500ms and
   * used to rebuild the whole panel unconditionally, which dropped clicks and
   * killed text selection.
   */
  private inspectorSignature: string | null = null;
  /**
   * Cached last-session digests. Reading them walks a directory and parses JSONL,
   * which must not happen on every inspector render.
   */
  private sessionDigestCache = new Map<string, { at: number; digest: SessionDigest | null }>();
  private static readonly SESSION_DIGEST_TTL_MS = 10_000;
  /** Observes whether the leaf is on screen — gates the render loop. */
  private visibilityObserver: IntersectionObserver | null = null;

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
    // A leaf restored at startup arrives here without going through
    // activateView(), so this is the backstop that guarantees a consent choice
    // exists before anything below can touch the filesystem or spawn a process.
    await this.plugin.ensureConsent();

    // Add CSS class for vault mode styling
    if (this.settings.vaultMode) {
      this.containerEl.addClass('vault-mode');
    } else {
      this.containerEl.removeClass('vault-mode');
    }
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('hypernovum-container');

    // Fail visibly rather than showing a black rectangle when WebGL is off
    // (hardware acceleration disabled, blocklisted GPU, remote session).
    if (!SceneManager.isWebGLAvailable()) {
      this.renderWebGLUnavailable(container);
      return;
    }

    // Initialize 3D scene with save callback and settings
    this.sceneManager = new SceneManager(container, {
      savedPositions: this.settings.blockPositions,
      onSaveLayout: (positions) => {
        void this.saveLayout(positions);
      },
      settings: this.settings,
      interactionStore: this.interactionStore,
    });

    // Add legend overlay
    this.addLegend(container);
    this.addCommandPanel(container);
    this.addInspectorPanel(container);
    this.addEmptyState(container);

    // Add agent switcher overlay only when the agent layer is actually enabled
    // (vault mode off AND first-run consent granted).
    if (this.plugin.agentFeaturesEnabled) {
      // Top-left overlays stack in a flex column so the agents panel and
      // activity indicator never overlap each other.
      this.hudTopLeft = container.createDiv({ cls: 'hypernovum-hud-topleft' });
      this.addAgentSwitcher(this.hudTopLeft);
    } else {
      container.addClass('vault-mode-active');
      // The background context menu is registered AFTER the raycaster (below), so
      // its `defaultPrevented` check can actually see a building/orb hit.
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
    // Click = focus, double-click = open, empty space = deselect
    this.raycaster.setSelectHandler((hit) => {
      this.selectProject(hit.project);
    });
    this.raycaster.setOpenHandler((hit) => {
      void this.app.workspace.openLinkText(hit.project.path, '', false);
    });
    this.raycaster.setEmptyClickHandler(() => {
      this.interactionStore.getState().clearSelection();
    });
    // Clicks that end a block/building drag must not change selection
    this.raycaster.setClickGuard(() => this.sceneManager?.wasRecentlyDragging() ?? false);

    // Set up right-click context menu for buildings
    this.raycaster.setRightClickHandler((hit, event) => {
      this.showBuildingContextMenu(hit, event);
    });

    // Set up right-click on Neural Core orb
    this.raycaster.setOrbRightClickHandler((event) => {
      this.showOrbContextMenu(event);
    });

    // Vault-mode background menu. Registered AFTER the raycaster on purpose:
    // contextmenu listeners fire in registration order, so registering it earlier
    // meant `defaultPrevented` was always false and right-clicking a building
    // opened BOTH this menu and the building menu.
    if (!this.plugin.agentFeaturesEnabled) {
      this.registerDomEvent(this.sceneManager.getCanvas(), 'contextmenu', (e: MouseEvent) => {
        if (e.defaultPrevented) return; // Raycaster hit a building or orb
        e.preventDefault();
        this.showCreateProjectMenu(e);
      });
    }

    // Set up focus-safe keyboard navigation
    this.keyboardNav = new KeyboardNav(this.sceneManager.getCanvas());
    this.keyboardNav.setHandlers({
      onCycleBlocked: () => this.cycleByStatus('blocked'),
      onCycleStale: () => this.cycleByStatus('paused'),
      onResetCamera: () => this.sceneManager?.resetCamera(),
      onDebugFlow: () => this.triggerRandomFlow(),
      onEscape: () => {
        // Priority: exit move mode → clear selection
        if (this.sceneManager?.exitMoveModeIfActive()) return;
        this.interactionStore.getState().clearSelection();
      },
    });

    // Inspector mirrors the selection — single subscription, no manual calls
    this.registerStoreSubscription();

    // Parse projects and build city
    await this.buildCity();

    // Watch for vault changes and rebuild on update
    this.metadataExtractor = new MetadataExtractor(
      this.app,
      () => {
        void this.buildCity();
      },
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

    // Poll for agent presence only when the agent layer is enabled. Gating on
    // consent too matters because Obsidian can restore this leaf on startup
    // without going through activateView(), so the prompt may not have run yet.
    if (this.plugin.agentFeaturesEnabled) {
      this.activityMonitor = new ActivityMonitor(this.app, {
        onActivityStart: (status) => this.onClaudeActivityStart(status),
        onActivityUpdate: (status) => this.onClaudeActivityUpdate(status),
        onActivityStop: () => this.onClaudeActivityStop(),
        onFleetUpdate: (agents) => this.onFleetUpdate(agents),
        onDegradedData: (n) => { this.degradedCount = n; },
      }, {
        registerInterval: (id) => this.registerInterval(id),
      });
      this.activityMonitor.start();

      // Add activity indicator overlay
      this.addActivityIndicator(this.hudTopLeft ?? container);
    }

    // Add HUD title
    this.addHudTitle(container);

    // Stop rendering when the view isn't on screen (P1-2).
    this.setupRenderGating(container);

    // One-time notice for the 0.4 interaction-model change
    if (!this.settings.interactionHintShown) {
      new Notice('Hypernovum: Click selects · Double-click opens · Move via right-click', 10000);
      this.plugin.settings.interactionHintShown = true;
      await this.plugin.saveSettings();
    }
  }

  async onClose(): Promise<void> {
    this.metadataExtractor?.stopWatching();
    this.keyboardNav?.dispose();
    this.activityMonitor?.stop();
    this.agentRegistry.clear();
    this.storeUnsubscribe?.();
    this.storeUnsubscribe = null;
    this.visibilityObserver?.disconnect();
    this.visibilityObserver = null;

    if (this.sceneManager) {
      this.sceneManager.dispose();
      this.sceneManager = null;
    }
  }

  /** Vault-mode background menu: create a new project district from empty ground. */
  private showCreateProjectMenu(event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item
        .setTitle('Create new project')
        .setIcon('folder-plus')
        .onClick(() => {
          new FolderInputModal(this.app, (folderPath) => {
            void this.createProjectFromFolder(folderPath);
          }).open();
        });
    });
    menu.showAtMouseEvent(event);
  }

  private async createProjectFromFolder(folderPath: string): Promise<void> {
    try {
      let folderCreated = false;
      if (!this.app.vault.getAbstractFileByPath(folderPath)) {
        await this.app.vault.createFolder(folderPath);
        folderCreated = true;
      }

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
        await this.app.workspace.openLinkText(newNote.path, '', false);
        new Notice(`Created new project: ${folderName}`);
      } else if (folderCreated) {
        new Notice(`Created project folder: ${folderPath}`);
      } else {
        new Notice(`Project folder already exists: ${folderPath}`);
      }
    } catch (error: unknown) {
      new Notice(`Failed to create project: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Explain a missing WebGL context instead of leaving an empty black panel. */
  private renderWebGLUnavailable(container: HTMLElement): void {
    const panel = container.createDiv({ cls: 'hypernovum-webgl-missing' });
    panel.createDiv({ cls: 'empty-kicker', text: 'NO SIGNAL' });
    panel.createEl('h3', { text: 'WebGL is unavailable' });
    panel.createEl('p', {
      text:
        'Hypernovum renders with WebGL, which this Obsidian window cannot start. ' +
        'This is almost always hardware acceleration being switched off.',
    });
    const steps = panel.createEl('ul');
    steps.createEl('li', { text: 'Settings → Appearance → turn on hardware acceleration, then restart Obsidian.' });
    steps.createEl('li', { text: 'On a remote/virtual desktop, GPU access may not be available at all.' });
    steps.createEl('li', { text: 'Otherwise, update your graphics drivers.' });

    const retry = panel.createEl('button', { text: 'Try again' });
    retry.addEventListener('click', () => {
      void this.plugin.reloadOpenViews();
    });
  }

  /**
   * Pause the render loop whenever the view isn't actually on screen.
   *
   * An IntersectionObserver covers a collapsed sidebar or a background tab (the
   * leaf stays in the DOM, so rAF keeps firing); `visibilitychange` covers a
   * minimised or hidden window. Without this, opening the city once left a 60fps
   * WebGL scene rendering invisibly until Obsidian restarted.
   */
  private setupRenderGating(container: HTMLElement): void {
    const sync = (visible: boolean) => {
      this.sceneManager?.setRenderingEnabled(visible && !document.hidden);
    };

    this.visibilityObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) sync(entry.isIntersecting);
      },
      { threshold: 0 },
    );
    this.visibilityObserver.observe(container);

    // The observer's first callback can land while the container still has zero
    // area during initial layout, which would report "not visible" and park the
    // loop before it ever started. Seed the state explicitly.
    sync(container.isShown());

    // registerDomEvent so Obsidian removes the listener with the view.
    this.registerDomEvent(document, 'visibilitychange', () => {
      const onScreen = container.isShown();
      sync(onScreen);
    });

    // Obsidian moves leaves between sidebar and main area without unmounting.
    this.registerEvent(
      this.app.workspace.on('layout-change', () => sync(container.isShown())),
    );
  }

  private static readonly PRIORITY_RANK: Record<string, number> = {
    critical: 4, high: 3, medium: 2, low: 1,
  };

  // --- Command surface (F5) -------------------------------------------------
  // HUD-only actions are also commands so they're hotkey-bindable, which is what
  // Obsidian users expect of any panel action.

  /** Save the current district layout (same path as the HUD button). */
  commandSaveLayout(): void {
    this.sceneManager?.triggerSave();
  }

  /** Write a cinematic PNG snapshot of the city into the vault. */
  async commandSnapshot(): Promise<void> {
    await this.captureSnapshot();
  }

  /** Clear search + every filter. */
  commandClearFilters(): void {
    this.clearFilters();
  }

  /** Switch the active scan lens. */
  commandSetLayer(layer: VisualLayer): void {
    this.visualLayer = layer;
    if (this.layerSelect) this.layerSelect.value = layer;
    this.applyView();
  }

  /** Reset the camera to the default overview framing. */
  commandResetCamera(): void {
    this.sceneManager?.resetCamera();
  }

  /** Cycle the camera through projects with a given status. */
  commandCycleStatus(status: string): void {
    this.cycleByStatus(status);
  }

  /** Trace impact for the current selection. */
  commandTraceSelection(): void {
    const project = this.selectedProject;
    if (!project) {
      new Notice('Select a project first');
      return;
    }
    this.enterTraceImpact(project);
  }

  /** Set the project folder for the current selection. */
  async commandSetProjectFolder(): Promise<void> {
    const project = this.selectedProject;
    if (!project) {
      new Notice('Select a project first');
      return;
    }
    await this.promptForProjectDir(project);
  }

  private async buildCity(): Promise<void> {
    // Parse vault metadata into project data
    this.allProjects = await this.parser.parseProjects(this.settings);

    // Enforce maxBuildings so oversized vaults degrade predictably (PERF-003):
    // keep the top-N by priority then recency, and tell the user what was cut.
    const cap = this.settings.maxBuildings;
    if (cap > 0 && this.allProjects.length > cap) {
      const total = this.allProjects.length;
      this.allProjects.sort((a, b) => {
        const pr = (HypernovumView.PRIORITY_RANK[b.priority] ?? 0) - (HypernovumView.PRIORITY_RANK[a.priority] ?? 0);
        if (pr !== 0) return pr;
        return (b.lastModified ?? 0) - (a.lastModified ?? 0);
      });
      this.allProjects = this.allProjects.slice(0, cap);
      new Notice(`Hypernovum: showing ${cap} of ${total} projects — raise "Max buildings" in settings`, 8000);
    }

    // Resolve every project's working directory once per rebuild. Cleared first so
    // frontmatter edits (or a newly created folder) are picked up.
    this.projectDirs.clear();
    this.vaultBase = getVaultBasePath(this.app);
    const resolvedDir = new Map<string, string | null>(
      this.allProjects.map((p) => [p.path, this.projectDirOf(p)]),
    );

    // Memory context is per directory, and several notes can share one. Reading it
    // touches files outside the vault, so it belongs to the agent layer the
    // first-run prompt gates.
    if (this.plugin.agentFeaturesEnabled) {
      for (const project of this.allProjects) {
        const dir = resolvedDir.get(project.path);
        if (!dir) continue;
        const memoryContextPath = path.join(dir, '.hypernovum', 'MEMORY_CONTEXT.md');
        if (existsSync(memoryContextPath)) {
          project.hasMemoryContext = true;
          project.memoryContextPath = memoryContextPath;
        }
      }
    }

    // Git scans are per DIRECTORY, not per project: each scan forks 8 `git`
    // processes and many notes resolve to the same repo, so scanning per project
    // meant hundreds of redundant spawns per rebuild. mapLimit still caps how
    // many repos are scanned at once.
    // Gated on consent as well as the setting: spawning `git` is local process
    // execution, and a restored leaf can reach here before the first-run prompt.
    if (this.settings.enableGitActivity && this.plugin.agentFeaturesEnabled) {
      const uniqueDirs = [...new Set([...resolvedDir.values()].filter((d): d is string => !!d))];
      const byDir = new Map<string, Awaited<ReturnType<GitActivityCollector['collect']>>>();
      await mapLimit(uniqueDirs, 8, async (dir) => {
        byDir.set(dir, await this.gitCollector.collect(dir));
      });
      for (const project of this.allProjects) {
        const dir = resolvedDir.get(project.path);
        const gitActivity = dir ? byDir.get(dir) : null;
        if (gitActivity) project.gitActivity = gitActivity;
      }
    }

    // Conflict detection normalizes agent file paths against the *resolved* dir,
    // not the raw frontmatter value.
    this.conflictProjects = this.allProjects.map((p) => ({
      ...p,
      projectDir: resolvedDir.get(p.path) ?? undefined,
    }));

    // Dependency scan (EDG-004): manifest + frontmatter depends_on → sibling edges.
    // Projects without a resolved directory can still declare deps in frontmatter.
    //
    // With the agent layer disabled we withhold the directory, which makes the
    // scanner skip every package.json read (it no-ops on an empty projectDir) while
    // frontmatter-declared dependencies — pure vault data — still produce edges.
    const scanDirs = this.plugin.agentFeaturesEnabled;
    this.depScan = this.depScanner.scan(this.allProjects.map((p) => ({
      path: p.path,
      title: p.title,
      projectDir: scanDirs ? resolvedDir.get(p.path) ?? '' : '',
      dependsOn: p.dependsOn,
      noDeps: p.noDeps,
    })));

    // Detect quests resolved since the last parse — celebrate after rebuild
    const resolvedPaths: string[] = [];
    for (const project of this.allProjects) {
      const prev = this.lastQuestCounts.get(project.path) ?? 0;
      const open = project.questions?.length ?? 0;
      if (open < prev) resolvedPaths.push(project.path);
      this.lastQuestCounts.set(project.path, open);
    }

    this.updateFilterOptions();
    this.rebuildCity();

    // Emerald shockwave on every building whose quest count dropped
    for (const path of resolvedPaths) {
      this.sceneManager?.flashBuilding(path);
    }
  }

  /**
   * Full rebuild — repack the layout from ALL projects. Only on vault-data
   * change (PERF-002): the layout is stable across filter/search/lens changes,
   * so filtered-out buildings leave gaps instead of the city re-packing.
   */
  private rebuildCity(): void {
    if (this.sceneManager) {
      const districts = this.binPacker.packDistricts(this.allProjects);
      this.sceneManager.clearAllWeather();
      this.sceneManager.buildCity(this.allProjects, districts);
    }
    this.applyView();
  }

  /** Apply filters/search/lens as a visibility + retint pass — no repack. */
  private applyView(): void {
    this.filteredProjects = filterProjects(this.allProjects, {
      query: this.searchQuery.toLowerCase().trim(),
      status: this.statusFilter,
      priority: this.priorityFilter,
      category: this.categoryFilter,
      memoryOnly: this.visualLayer === 'memory',
    });

    this.projects = this.filteredProjects;

    if (this.sceneManager) {
      // Show the filtered set, hide the rest — no repack, layout stays put.
      this.sceneManager.applyVisibility(new Set(this.filteredProjects.map((p) => p.path)));
      this.sceneManager.clearAllWeather();

      // Warnings drive the attention lens + badge; recompute before applying.
      this.recomputeWarnings();
      // Clear any prior attention lens unless we're re-applying it below.
      if (this.visualLayer !== 'attention') this.sceneManager.setAttentionLens(null);

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
      } else if (this.visualLayer === 'attention') {
        this.sceneManager.setAttentionLens(this.attentionLensColors());
      }

      // Recompute structural edges (backlink/blocked/depends) + render all.
      this.structuralEdges = this.computeStructuralEdges();
      this.refreshEdges();
    }

    // Selection must survive rebuilds only if the project is still visible
    const selectedPath = this.interactionStore.getState().selectedPath;
    if (selectedPath && !this.filteredProjects.some((p) => p.path === selectedPath)) {
      this.interactionStore.getState().clearSelection();
    } else {
      // Edges may have changed with the rebuild — refresh the connected set
      this.updateConnectedPaths(selectedPath);
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
  /** Vault backlinks between projects as undirected GraphEdges (EDG-002). */
  private computeLinkEdges(): GraphEdge[] {
    const resolved = this.app.metadataCache.resolvedLinks as Record<string, Record<string, number>>;
    const projects = this.filteredProjects;
    const byNote = new Map(projects.map((p) => [p.path, p]));
    const owners = projects.map((p) => ({ prefix: p.path.replace(/\.md$/, '/'), project: p }));
    const ownerOf = (file: string): ProjectData | undefined =>
      byNote.get(file) ?? owners.find((o) => file.startsWith(o.prefix))?.project;

    const edges = new Map<string, GraphEdge>();
    for (const [source, targets] of Object.entries(resolved)) {
      const a = ownerOf(source);
      if (!a) continue;
      for (const [target, count] of Object.entries(targets)) {
        const b = ownerOf(target);
        if (!b || b === a) continue;
        const key = a.path < b.path ? `${a.path}|${b.path}` : `${b.path}|${a.path}`;
        const edge = edges.get(key) ?? {
          from: a.path, to: b.path, type: 'backlink' as const,
          direction: 'undirected' as const, source: 'deterministic' as const, weight: 0,
        };
        edge.weight = (edge.weight ?? 0) + count;
        edges.set(key, edge);
      }
    }
    return [...edges.values()];
  }

  // --- Typed graph edge assembly (Phase 4) ---

  /** Structural edges (backlink + blocked-by + depends-on) among visible projects. */
  private computeStructuralEdges(): GraphEdge[] {
    const edges: GraphEdge[] = this.computeLinkEdges(); // backlinks (undirected)
    const visible = new Set(this.filteredProjects.map((p) => p.path));
    const refList = this.filteredProjects.map((p) => ({ path: p.path, title: p.title }));

    for (const p of this.filteredProjects) {
      // blocked-by: directed blocker → blocked (p is blocked by each ref)
      for (const ref of p.blockedBy ?? []) {
        const blocker = resolveProjectRef(ref, refList);
        if (blocker && blocker !== p.path && visible.has(blocker)) {
          edges.push({ from: blocker, to: p.path, type: 'blocked-by', direction: 'directed', source: 'deterministic', meta: { via: 'frontmatter' } });
        }
      }
      // depends-on: directed dependent → dependency
      for (const dep of this.depScan.get(p.path)?.dependsOn ?? []) {
        if (dep.targetPath !== p.path && visible.has(dep.targetPath)) {
          edges.push({ from: p.path, to: dep.targetPath, type: 'depends-on', direction: 'directed', source: 'deterministic', meta: { via: dep.via } });
        }
      }
    }
    return edges;
  }

  private static readonly LIVE_AGENT_STATES = new Set([
    'starting', 'planning', 'reading', 'editing', 'running', 'testing', 'reviewing', 'waiting', 'blocked',
  ]);

  /** agent-working-on edges: neural core → each project with a live session. */
  private agentEdges(): GraphEdge[] {
    const edges: GraphEdge[] = [];
    const seen = new Set<string>();
    for (const s of this.fleetSessions) {
      if (!s.projectPath || !HypernovumView.LIVE_AGENT_STATES.has(s.state) || seen.has(s.projectPath)) continue;
      seen.add(s.projectPath);
      edges.push({ from: 'core', to: s.projectPath, type: 'agent-working-on', direction: 'directed', source: 'deterministic', meta: { agentId: s.sessionId } });
    }
    return edges;
  }

  private agentEdgeSignature(): string {
    return this.agentEdges().map((e) => e.to).sort().join('|');
  }
  private lastAgentSig = '';

  private syncEdgeChips(): void {
    for (const chip of this.edgeChips) {
      chip.classList.toggle('active', this.edgeTypes.has(chip.dataset.edge as EdgeType));
    }
  }

  /** Push the current edge set to the scene and apply the active type filter. */
  private refreshEdges(): void {
    if (!this.sceneManager) return;
    this.sceneManager.showLinkArcs([...this.structuralEdges, ...this.agentEdges()]);
    this.sceneManager.setEdgeVisibleTypes(this.edgeTypes);
    this.lastAgentSig = this.agentEdgeSignature();
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
        appendOption(select, value, value === 'all' ? 'All' : value);
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

    const panel = container.createDiv({ cls: 'agents-panel' });
    const header = panel.createDiv({ cls: 'agents-header' });
    const heading = header.createDiv();
    heading.createSpan({ cls: 'agents-title', text: 'AGENTS' });
    heading.createDiv({ cls: 'agents-subtitle', text: 'Right-click a building to launch' });
    const list = panel.createDiv({ cls: 'agents-list' });
    const abilitiesSection = panel.createDiv({ cls: 'agents-abilities' });
    abilitiesSection.hidden = true;
    const abilitiesHeader = abilitiesSection.createDiv({ cls: 'agents-abilities-header' });
    abilitiesHeader.appendText('ABILITIES · ');
    abilitiesHeader.createSpan({ cls: 'abilities-count', text: '0' });
    abilitiesSection.createDiv({ cls: 'agents-abilities-list' });
    const notInstalledSection = panel.createDiv({ cls: 'agents-not-installed' });
    notInstalledSection.hidden = true;
    const toggleBtn = notInstalledSection.createEl('button', { cls: 'agents-not-installed-toggle' });
    toggleBtn.appendText('Available to Install (');
    let countSpan = toggleBtn.createSpan({ cls: 'not-installed-count', text: '0' });
    toggleBtn.appendText(')');
    const notInstalledList = notInstalledSection.createDiv({ cls: 'agents-not-installed-list' });
    notInstalledList.hidden = true;
    const prepareBtn = panel.createEl('button', {
      cls: 'agents-prepare-btn',
      text: 'Prepare vault · AGENTS.md',
      attr: { title: 'Write AGENTS.md at the vault root so agents understand your projects' },
    });
    prepareBtn.addEventListener('click', () => {
      prepareBtn.disabled = true;
      void this.plugin.prepareVaultForAgents()
        .then(() => {
          prepareBtn.textContent = '✓ AGENTS.md updated';
          window.setTimeout(() => {
            prepareBtn.textContent = 'Prepare vault · AGENTS.md';
            prepareBtn.disabled = false;
          }, 2000);
        })
        .catch((error: unknown) => {
          prepareBtn.disabled = false;
          new Notice(`Could not prepare vault: ${error instanceof Error ? error.message : String(error)}`);
        });
    });

    let showNotInstalled = false;
    toggleBtn.addEventListener('click', () => {
      showNotInstalled = !showNotInstalled;
      notInstalledList.hidden = !showNotInstalled;
      const count = countSpan.textContent ?? '0';
      toggleBtn.empty();
      toggleBtn.appendText(`${showNotInstalled ? '\u25BE' : '\u25B8'} Available to Install (`);
      countSpan = toggleBtn.createSpan({ cls: 'not-installed-count', text: count });
      toggleBtn.appendText(')');
    });

    const detectedMap: Record<string, boolean> = {};

    // Probe with execFile, not exec: exec spawns a shell, and a shell isn't needed
    // to ask where a binary lives. Skipped entirely unless the agent layer is
    // enabled — no local process should run before the user has opted in.
    const checkCommand = (cmd: string): Promise<boolean> => {
      if (!this.plugin.agentFeaturesEnabled) return Promise.resolve(false);
      return new Promise((resolve) => {
        const probe = Platform.isWin ? 'where' : 'which';
        execFile(probe, [cmd], { timeout: 2000, windowsHide: true }, (error: unknown) => {
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
        const item = list.createDiv({ cls: 'agents-item' });
        item.classList.toggle('active', currentCommand === agent.command);
        item.setCssProps({ '--hypernovum-agent-color': agent.color });
        const iconCircle = item.createDiv({ cls: 'agents-icon-circle', text: agent.icon });
        iconCircle.setCssProps({ '--hypernovum-agent-color': agent.color });
        item.createSpan({ cls: 'agents-item-name', text: agent.name });
        item.addEventListener('click', () => {
          this.plugin.settings.agentName = agent.name;
          this.plugin.settings.agentCommand = agent.command;
          void this.plugin.saveSettings().then(renderAgents).catch((error: unknown) => {
            new Notice(`Could not save agent selection: ${error instanceof Error ? error.message : String(error)}`);
          });
        });
      }

      // Render not installed
      if (notInstalled.length > 0) {
        notInstalledSection.hidden = false;
        countSpan.textContent = notInstalled.length.toString();
        toggleBtn.empty();
        toggleBtn.appendText(`${showNotInstalled ? '\u25BE' : '\u25B8'} Available to Install (`);
        countSpan = toggleBtn.createSpan({ cls: 'not-installed-count', text: String(notInstalled.length) });
        toggleBtn.appendText(')');

        for (const agent of notInstalled) {
          const item = notInstalledList.createDiv({ cls: 'agents-item not-detected' });
          const iconCircle = item.createDiv({ cls: 'agents-icon-circle', text: agent.icon });
          iconCircle.setCssProps({ '--hypernovum-agent-color': `${agent.color}55` });
          item.createSpan({ cls: 'agents-item-name', text: agent.name });
          const installBtn = item.createEl('button', {
            cls: 'agents-install-pill',
            text: 'Install',
            attr: { title: agent.installHint },
          });
          installBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            void navigator.clipboard.writeText(agent.installHint).catch(() => {
              new Notice('Could not copy the install command.');
            });
            installBtn.textContent = '\u2713 Copied';
            installBtn.classList.add('copied');
            window.setTimeout(() => {
              installBtn.textContent = 'Install';
              installBtn.classList.remove('copied');
            }, 1500);
          });
        }
      } else {
        notInstalledSection.hidden = true;
      }
    };
    
    // Initial render assuming all are detected until check finishes
    renderAgents();
    // Run async checks to detect installed agents
    void Promise.all(KNOWN_AGENTS.map(async (agent) => {
      detectedMap[agent.command] = await checkCommand(agent.command);
    })).then(() => {
      renderAgents();
    }).catch((error: unknown) => {
      new Notice(`Could not detect installed agents: ${error instanceof Error ? error.message : String(error)}`);
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

    const vaultPath = getVaultBasePath(this.app);
    const skills = vaultPath ? scanSkills(vaultPath) : [];
    if (skills.length === 0) {
      section.hidden = true;
      return;
    }

    section.hidden = false;
    count.textContent = String(skills.length);
    list.empty();

    for (const skill of skills) {
      const item = list.createDiv({ cls: 'agents-item ability' });
      item.createSpan({ cls: 'ability-gem', text: '◆' });
      item.createSpan({ cls: 'agents-item-name', text: skill.name });
      item.createSpan({ cls: 'ability-scope', text: skill.scope === 'vault' ? 'V' : 'G' });
      item.title = `${skill.description || skill.name}\n${skill.path}\nClick to copy invocation`;
      item.addEventListener('click', () => {
        void navigator.clipboard.writeText(`Use the "${skill.name}" skill (${skill.path})`).catch(() => {
          new Notice('Could not copy the skill invocation.');
        });
        const gem = item.querySelector('.ability-gem') as HTMLElement;
        if (gem) {
          gem.textContent = '✓';
          gem.classList.add('copied');
          window.setTimeout(() => {
            gem.textContent = '◆';
            gem.classList.remove('copied');
          }, 1200);
        }
      });
    }
  }

  private addLegend(container: HTMLElement): void {
    const legend = container.createDiv({ cls: 'hypernovum-legend' });
    legend.createDiv({ cls: 'legend-kicker' });
    legend.createDiv({ cls: 'legend-body' });
    this.legendEl = legend;
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
      attention: 'NEEDS ATTENTION',
      git: 'GIT ACTIVITY',
      memory: 'MEMORY',
      tasks: 'TASK PROGRESS',
      recency: 'RECENCY',
      stack: 'TECH STACK',
    };
    kicker.textContent = `SCAN · ${modeNames[this.visualLayer]}`;

    body.empty();

    switch (this.visualLayer) {
      case 'attention': {
        const count = warningBadgeCount(this.warnings);
        const section = body.createDiv({ cls: 'legend-section' });
        section.createDiv({ cls: 'legend-label', text: 'Severity · Color' });
        const list = section.createDiv({ cls: 'legend-list' });
        appendLegendItem(list, '#ff4444', 'High — conflict / blocked / failed');
        appendLegendItem(list, '#ffaa33', 'Medium — dirty / behind / waiting');
        appendLegendItem(list, '#5a6b82', 'Low — stale');
        section.createDiv({
          cls: 'legend-note',
          text: count > 0
            ? `${count} item${count === 1 ? '' : 's'} need attention`
            : 'City is healthy — nothing needs you',
        });
        break;
      }

      case 'git': {
        const section = body.createDiv({ cls: 'legend-section' });
        section.createDiv({ cls: 'legend-label', text: 'Signal · Meaning' });
        const list = section.createDiv({ cls: 'legend-list' });
        appendLegendItem(list, '#ff6600', 'Hot glow — high commit churn');
        appendLegendItem(list, '#dd3333', 'Glitch — merge conflict');
        appendLegendItem(list, '#6b6b7a', 'Dim — stale repository');
        section.createDiv({ cls: 'legend-note', text: 'Status colors still apply beneath signals' });
        break;
      }

      case 'memory': {
        const ready = this.allProjects.filter((p) => p.hasMemoryContext).length;
        const section = body.createDiv({ cls: 'legend-section' });
        section.createDiv({ cls: 'legend-label', text: 'Filter · Memory' });
        const list = section.createDiv({ cls: 'legend-list' });
        appendLegendItem(list, '#66e0a3', 'Memory-ready projects only');
        section.createDiv({
          cls: 'legend-note',
          text: `${ready} of ${this.allProjects.length} projects carry MEMORY_CONTEXT.md`,
        });
        break;
      }

      case 'tasks': {
        const section = body.createDiv({ cls: 'legend-section' });
        section.createDiv({ cls: 'legend-label', text: 'Completion · Color' });
        section.createDiv({ cls: 'legend-gradient' }).setCssProps({
          '--hypernovum-legend-gradient': `linear-gradient(to right,${TASK_RAMP.map(hexCss).join(',')})`,
        });
        const range = section.createDiv({ cls: 'legend-range' });
        range.createSpan({ text: '0%' });
        range.createSpan({ text: '100%' });
        const list = section.createDiv({ cls: 'legend-list legend-footnote' });
        appendLegendItem(list, hexCss(NO_DATA_COLOR), 'No tasks tracked');
        break;
      }

      case 'recency': {
        const section = body.createDiv({ cls: 'legend-section' });
        section.createDiv({ cls: 'legend-label', text: 'Last touched · Heat' });
        section.createDiv({ cls: 'legend-gradient' }).setCssProps({
          '--hypernovum-legend-gradient': `linear-gradient(to right,${RECENCY_RAMP.map(hexCss).join(',')})`,
        });
        const range = section.createDiv({ cls: 'legend-range' });
        range.createSpan({ text: 'Today' });
        range.createSpan({ text: '60d+' });
        break;
      }

      case 'stack': {
        // Stack names come from note frontmatter, so this legend is built with DOM
        // APIs rather than an interpolated template.
        const counts = new Map<string, number>();
        for (const p of this.allProjects) {
          const primary = p.stack?.[0]?.trim();
          if (primary) counts.set(primary, (counts.get(primary) ?? 0) + 1);
        }
        const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

        const section = body.createDiv({ cls: 'legend-section' });
        section.createDiv({ cls: 'legend-label', text: 'Primary Stack · Color' });
        const list = section.createDiv({ cls: 'legend-list' });

        if (top.length === 0) {
          const item = list.createDiv({ cls: 'legend-item' });
          appendLegendChip(item, hexCss(NO_DATA_COLOR));
          item.appendText('No stacks declared');
        } else {
          for (const [name, count] of top) {
            const item = list.createDiv({ cls: 'legend-item' });
            appendLegendChip(item, hexCss(stackColor(name)));
            item.appendText(`${name} · ${count}`);
          }
          const footnote = section.createDiv({ cls: 'legend-list legend-footnote' });
          const item = footnote.createDiv({ cls: 'legend-item' });
          appendLegendChip(item, hexCss(NO_DATA_COLOR));
          item.appendText('No stack declared');
        }
        break;
      }

      default: {
        const statusSection = body.createDiv({ cls: 'legend-section' });
        statusSection.createDiv({ cls: 'legend-label', text: 'Status · Color' });
        const grid = statusSection.createDiv({ cls: 'legend-grid' });
        for (const [status, label] of [
          ['active', 'Active'],
          ['blocked', 'Blocked'],
          ['paused', 'Paused'],
          ['complete', 'Complete'],
        ] as const) {
          const item = grid.createDiv({ cls: 'legend-item' });
          item.createSpan({ cls: `legend-chip ${status}` });
          item.appendText(label);
        }

        const prioritySection = body.createDiv({ cls: 'legend-section' });
        prioritySection.createDiv({ cls: 'legend-label', text: 'Priority · Height' });
        const skyline = prioritySection.createDiv({ cls: 'legend-skyline' });
        const bars = skyline.createDiv({ cls: 'legend-bars' });
        for (const height of ['h1', 'h2', 'h3', 'h4']) {
          bars.createDiv({ cls: `legend-bar ${height}` });
        }
        const range = skyline.createDiv({ cls: 'legend-range' });
        range.createSpan({ text: 'Low' });
        range.createSpan({ text: 'Critical' });
        break;
      }
    }
  }

  private addControlsHint(container: HTMLElement): void {
    const controls = container.createDiv({ cls: 'hypernovum-controls' });
    for (const [key, action] of [
      ['Click', 'Select'],
      ['Dbl-click', 'Open note'],
      ['Right-click', 'Actions menu'],
      ['Esc', 'Deselect / exit move'],
      ['Right-drag', 'Pan'],
      ['Scroll', 'Zoom'],
      ['B / S', 'Cycle blocked / stale'],
      ['Space', 'Reset camera'],
    ] as const) {
      const row = controls.createDiv({ cls: 'controls-row' });
      row.createEl('kbd', { text: key });
      row.createSpan({ text: action });
    }
  }

  private addEmptyState(container: HTMLElement): void {
    const el = container.createDiv({ cls: 'hypernovum-empty-state' });
    el.hidden = true;
    this.emptyStateEl = el;
  }

  private updateEmptyState(): void {
    const el = this.emptyStateEl;
    if (!el) return;

    const noProjects = this.allProjects.length === 0;
    const noMatches = !noProjects && this.filteredProjects.length === 0;

    if (!noProjects && !noMatches) {
      el.hidden = true;
      return;
    }

    el.empty();
    el.hidden = false;

    if (noProjects) {
      el.createDiv({ cls: 'empty-kicker', text: 'AWAITING CITY DATA' });
      el.createEl('h3', { text: 'No project notes found' });
      el.createEl('p', { text: 'Hypernovum builds the city from notes tagged as projects. Add this frontmatter to any note:' });
      el.createEl('pre', { text: '---\ntags: [project]\nstatus: active\npriority: high\ncategory: web-apps\n---' });
      const actions = el.createDiv({ cls: 'empty-actions' });
      const btn = actions.createEl('button', { text: 'Create sample project' });
      btn.addEventListener('click', () => {
        void this.createSampleProject();
      });
      if (!this.settings.vaultMode) {
        const prepBtn = actions.createEl('button', { text: 'Prepare vault for agents' });
        prepBtn.addEventListener('click', () => {
          void this.plugin.prepareVaultForAgents();
        });
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
      await this.app.workspace.openLinkText(notePath, '', false);
      await this.buildCity();
    } catch (error: unknown) {
      new Notice(`Failed to create sample project: ${error instanceof Error ? error.message : String(error)}`);
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
    this.applyView();
  }

  private addSaveButton(container: HTMLElement): void {
    const saveBtn = container.createEl('button', { cls: 'hypernovum-save-btn', text: 'Save layout' });
    saveBtn.addEventListener('click', () => {
      if (this.sceneManager) {
        this.sceneManager.triggerSave();
      }
    });
    const snapBtn = container.createEl('button', {
      cls: 'hypernovum-save-btn hypernovum-snapshot-btn',
      text: 'Snapshot',
      attr: { title: 'Save a clean PNG of the city (no HUD) into the vault' },
    });
    snapBtn.addEventListener('click', () => { void this.captureSnapshot(); });
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

      const canvas = createEl('canvas');
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

      // Vault API + a configurable folder + de-duplicated name: this used to
      // writeBinary straight to the vault root under a fixed per-day filename,
      // which skipped Obsidian's index and silently replaced the previous shot.
      const savedPath = await createBinaryVaultFile(
        this.app,
        this.settings.outputFolder,
        `Hypernovum Snapshot ${date}`,
        '.png',
        await blob.arrayBuffer(),
      );
      new Notice(`Snapshot saved: ${savedPath}`);
    } catch (error: unknown) {
      new Notice(`Snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private addCommandPanel(container: HTMLElement): void {
    const panel = container.createDiv({ cls: 'hypernovum-command-panel' });
    const header = panel.createDiv({ cls: 'command-panel-header' });
    header.createSpan({ cls: 'command-panel-title', text: 'PROJECTS' });
    const attentionBadge = header.createEl('button', {
      cls: 'attention-badge',
      text: '⚠ 0',
      attr: { title: 'Needs attention — click for the triage lens' },
    });
    attentionBadge.hidden = true;
    const summary = header.createSpan({ cls: 'command-panel-summary', text: 'Loading...' });
    const searchInput = panel.createEl('input', {
      cls: 'command-search',
      attr: { type: 'search', placeholder: 'Search projects' },
    });

    const layerRow = panel.createDiv({ cls: 'command-row' });
    layerRow.createEl('label', { text: 'Layer' });
    const layerSelect = layerRow.createEl('select', { cls: 'layer-select' });
    for (const [value, label] of [
      ['status', 'Status'],
      ['attention', 'Needs attention'],
      ['git', 'Git activity'],
      ['memory', 'Memory ready'],
      ['tasks', 'Task progress'],
      ['recency', 'Recency'],
      ['stack', 'Tech stack'],
    ] as const) appendOption(layerSelect, value, label);

    const presetRow = panel.createDiv({ cls: 'command-row' });
    presetRow.createEl('label', { text: 'Preset' });
    const presetControls = presetRow.createDiv({ cls: 'preset-controls' });
    const presetSelect = presetControls.createEl('select', { cls: 'preset-select' });
    const presetSave = presetControls.createEl('button', {
      cls: 'preset-save',
      text: 'Save view',
      attr: { title: 'Save the current view as a preset' },
    });
    const presetDelete = presetControls.createEl('button', {
      cls: 'preset-delete',
      text: 'Delete',
      attr: { title: 'Delete the selected preset' },
    });
    presetDelete.hidden = true;

    const filters = panel.createDiv({ cls: 'command-filters' });
    const statusSelect = filters.createEl('select', { cls: 'status-select' });
    appendOption(statusSelect, 'all', 'All status');
    const prioritySelect = filters.createEl('select', { cls: 'priority-select' });
    appendOption(prioritySelect, 'all', 'All priority');
    const categorySelect = filters.createEl('select', { cls: 'category-select' });
    appendOption(categorySelect, 'all', 'All categories');

    const edgeToggles = panel.createDiv({
      cls: 'edge-toggles',
      attr: { title: 'Show typed project-graph edges' },
    });
    edgeToggles.createSpan({ cls: 'edge-toggles-label', text: 'EDGES' });
    const edgeChips: HTMLButtonElement[] = [];
    for (const [type, label] of [
      ['backlink', 'Backlinks'],
      ['depends-on', 'Deps'],
      ['blocked-by', 'Blocked'],
      ['agent-working-on', 'Agents'],
    ] as const) {
      edgeChips.push(edgeToggles.createEl('button', {
        cls: 'edge-chip',
        text: label,
        attr: { 'data-edge': type },
      }));
    }
    const vaultToggle = panel.createEl('button', {
      cls: 'vault-mode-toggle',
      text: 'VAULT MODE · OFF',
      attr: { title: 'Vault mode: pure 3D visualization, no AI agent features. Reloads the view.' },
    });

    this.searchInput = searchInput;
    this.layerSelect = layerSelect;
    this.statusSelect = statusSelect;
    this.prioritySelect = prioritySelect;
    this.categorySelect = categorySelect;
    this.summaryEl = summary;
    this.attentionBadge = attentionBadge;

    this.attentionBadge.addEventListener('click', () => {
      this.visualLayer = 'attention';
      if (this.layerSelect) this.layerSelect.value = 'attention';
      this.applyView();
    });

    // Lens presets (LENS-001)
    this.presetSelect = presetSelect;
    this.presetDeleteBtn = presetDelete;
    this.renderPresetOptions();
    this.presetSelect.addEventListener('change', () => this.onPresetSelected());
    presetSave.addEventListener('click', () => this.saveCurrentLens());
    this.presetDeleteBtn.addEventListener('click', () => {
      void this.deleteSelectedPreset();
    });

    // Debounce so a rebuild fires once per typing pause, not per keystroke (PERF-001).
    const debouncedSearch = debounce(() => this.applyView(), 200, false);
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      debouncedSearch();
    });

    layerSelect.addEventListener('change', () => {
      this.visualLayer = layerSelect.value as VisualLayer;
      this.applyView();
    });

    statusSelect.addEventListener('change', () => {
      this.statusFilter = statusSelect.value;
      this.applyView();
    });

    prioritySelect.addEventListener('change', () => {
      this.priorityFilter = prioritySelect.value;
      this.applyView();
    });

    categorySelect.addEventListener('change', () => {
      this.categoryFilter = categorySelect.value;
      this.applyView();
    });

    // Edge-type toggle chips (EDG-006)
    this.edgeChips = edgeChips;
    this.syncEdgeChips();
    for (const chip of this.edgeChips) {
      chip.addEventListener('click', () => {
        const type = chip.dataset.edge as EdgeType;
        if (this.edgeTypes.has(type)) this.edgeTypes.delete(type);
        else this.edgeTypes.add(type);
        this.syncEdgeChips();
        this.sceneManager?.setEdgeVisibleTypes(this.edgeTypes);
        this.updateConnectedPaths(this.interactionStore.getState().selectedPath);
      });
    }

    vaultToggle.textContent = `VAULT MODE · ${this.settings.vaultMode ? 'ON' : 'OFF'}`;
    vaultToggle.classList.toggle('active', this.settings.vaultMode);
    vaultToggle.addEventListener('click', () => {
      // Reloads the view; the fresh view renders the new state
      void this.plugin.toggleVaultMode();
    });
  }

  private addInspectorPanel(container: HTMLElement): void {
    const panel = container.createDiv({ cls: 'hypernovum-project-inspector' });
    panel.createDiv({ cls: 'inspector-empty', text: 'Select a project' });
    this.inspectorPanel = panel;
  }

  private storeUnsubscribe: (() => void) | null = null;

  /** INT-007: inspector state flows from the store; no manual update calls */
  private registerStoreSubscription(): void {
    this.storeUnsubscribe?.();
    this.storeUnsubscribe = this.interactionStore.subscribe((state, prev) => {
      if (state.selectedPath !== prev.selectedPath) {
        // A selection away from the trace origin exits trace mode (§ IMP-002).
        if (this.traceResult && state.selectedPath !== this.traceResult.origin) this.exitTrace();
        this.updateConnectedPaths(state.selectedPath);
        this.updateInspector();
      }
      // Esc / empty-space clear traceImpact in the store — mirror to the scene.
      if (state.traceImpact !== prev.traceImpact && !state.traceImpact) this.exitTrace();
    });
  }

  /**
   * Neighbors of the selection (across visible typed edges, EDG-008) stay
   * readable while the rest of the city dims. Recomputed on selection change,
   * edge-type toggle, fleet change, and rebuild.
   */
  private updateConnectedPaths(selectedPath: string | null): void {
    if (!this.sceneManager) return;
    const connected = selectedPath ? this.sceneManager.edgeNeighborsOf(selectedPath) : new Set<string>();
    this.sceneManager.setConnectedPaths(connected);
  }

  private selectProject(project: ProjectData): void {
    this.interactionStore.getState().select(project.path);
  }

  // Attention-lens severity colors: red / amber / slate.
  private static readonly ATTENTION_COLORS: Record<WarningSeverity, number> = {
    high: 0xff4444,
    medium: 0xffaa33,
    low: 0x5a6b82,
  };

  /** Recompute §11 warnings from the current projects/sessions/conflicts + badge. */
  private recomputeWarnings(): void {
    this.warnings = computeWarnings(this.allProjects, this.fleetSessions, this.conflicts, this.degradedCount);
    this.updateAttentionBadge();
  }

  private updateAttentionBadge(): void {
    if (!this.attentionBadge) return;
    const count = warningBadgeCount(this.warnings);
    this.attentionBadge.hidden = count === 0;
    this.attentionBadge.textContent = `⚠ ${count}`;
    this.attentionBadge.classList.toggle('attention-high', this.warnings.some((w) => w.severity === 'high'));
  }

  /**
   * Actionable warning rows (TRI-003), built with DOM APIs and wired inline.
   * `showProject` prefixes the project title.
   *
   * These carry vault-authored text (project titles, warning messages) — exactly
   * the input Obsidian's guidelines say must not reach `innerHTML`.
   * `createSpan({ text })` can't be coaxed into markup at all, escaped or not.
   */
  private appendWarningRows(parent: HTMLElement, items: WarningItem[], showProject: boolean): void {
    for (const w of items) {
      const row = parent.createDiv({ cls: `warning-row warning-${w.severity}` });
      row.createSpan({ cls: 'warning-dot' });
      const body = row.createDiv({ cls: 'warning-body' });
      if (showProject) {
        const proj = w.projectPath
          ? this.allProjects.find((p) => p.path === w.projectPath)?.title ?? ''
          : '';
        if (proj) body.createSpan({ cls: 'warning-proj', text: proj });
      }
      body.createSpan({ cls: 'warning-msg', text: w.message });

      const btn = row.createEl('button', { cls: 'warning-action', text: w.action.label });
      const kind = w.action.kind;
      const projectPath = w.projectPath ?? null;
      btn.addEventListener('click', () => this.runWarningAction(kind, projectPath));
    }
  }

  /** `<span>label</span><strong>value</strong>` row used throughout the inspector. */
  private appendSignalRow(parent: HTMLElement, label: string, value: string): void {
    const row = parent.createDiv({ cls: 'signal-row' });
    row.createSpan({ text: label });
    row.createEl('strong', { text: value });
  }

  /** Titled inspector section; returns the section element for further children. */
  private createSection(parent: HTMLElement, label: string, cls = ''): HTMLElement {
    const section = parent.createDiv({
      cls: cls ? `inspector-section ${cls}` : 'inspector-section',
    });
    section.createSpan({ cls: 'section-label', text: label });
    return section;
  }

  /** Clickable row that focuses another project when clicked. */
  private appendFocusRow(
    parent: HTMLElement,
    targetPath: string,
    decorate: (row: HTMLElement) => void,
  ): void {
    const row = parent.createDiv({ cls: 'dep-row' });
    decorate(row);
    row.addEventListener('click', () => this.runWarningAction('focus', targetPath));
  }

  private runWarningAction(kind: string, path: string | null): void {
    const project = path ? this.allProjects.find((p) => p.path === path) : null;
    switch (kind) {
      case 'focus':
      case 'show-conflict':
        if (project) {
          this.interactionStore.getState().select(project.path);
          if (project.position && this.sceneManager) {
            this.sceneManager.focusOnPosition(project.position);
            this.sceneManager.setFocusedProject(project);
          }
        }
        break;
      case 'open-note':
        if (project) void this.app.workspace.openLinkText(project.path, '', false);
        break;
      case 'launch-agent': {
        if (!project || !this.plugin.agentFeaturesEnabled) break;
        const dir = this.requireProjectDir(project);
        if (dir) void this.launchAgentForProject(project, dir);
        break;
      }
      case 'open-terminal': {
        if (!project || !this.plugin.agentFeaturesEnabled) break;
        const dir = this.requireProjectDir(project);
        if (dir) void this.openTerminalForProject(project, dir);
        break;
      }
    }
  }

  // --- Lens presets (LENS-001) ---

  private allPresets(): LensPreset[] {
    return [...BUILT_IN_LENSES, ...this.settings.savedLenses];
  }

  private renderPresetOptions(): void {
    if (!this.presetSelect) return;

    // Saved preset names are user input, so these options are built as elements.
    const select = this.presetSelect;
    select.empty();
    select.createEl('option', { value: '', text: 'Presets…' });

    const defaults = select.createEl('optgroup');
    defaults.label = 'Defaults';
    for (const p of BUILT_IN_LENSES) {
      defaults.createEl('option', { value: p.id, text: p.name });
    }

    if (this.settings.savedLenses.length > 0) {
      const saved = select.createEl('optgroup');
      saved.label = 'Saved';
      for (const p of this.settings.savedLenses) {
        saved.createEl('option', { value: p.id, text: p.name });
      }
    }

    select.value = '';
    if (this.presetDeleteBtn) this.presetDeleteBtn.hidden = true;
  }

  private currentLensState(): LensState {
    return {
      layer: this.visualLayer,
      statusFilter: this.statusFilter,
      priorityFilter: this.priorityFilter,
      categoryFilter: this.categoryFilter,
      searchQuery: this.searchQuery,
      edgeTypes: [...this.edgeTypes],
    };
  }

  private onPresetSelected(): void {
    const id = this.presetSelect?.value ?? '';
    if (!id) { if (this.presetDeleteBtn) this.presetDeleteBtn.hidden = true; return; }
    const preset = this.allPresets().find((p) => p.id === id);
    if (!preset) return;
    this.applyLensPreset(preset);
    // Only custom (non-builtin) presets are deletable.
    if (this.presetDeleteBtn) this.presetDeleteBtn.hidden = !!preset.builtIn;
  }

  private applyLensPreset(preset: LensPreset): void {
    const s = presetToState(preset);
    this.visualLayer = s.layer as VisualLayer;
    // A category that no longer exists falls back to 'all' silently.
    const catExists = this.categorySelect?.querySelector(`option[value="${CSS.escape(s.categoryFilter)}"]`) != null;
    this.statusFilter = s.statusFilter;
    this.priorityFilter = s.priorityFilter;
    this.categoryFilter = catExists || s.categoryFilter === 'all' ? s.categoryFilter : 'all';
    this.searchQuery = s.searchQuery;
    this.edgeTypes = new Set(s.edgeTypes as EdgeType[]);
    this.syncEdgeChips();

    // Sync UI controls to the applied state.
    if (this.layerSelect) this.layerSelect.value = this.visualLayer;
    if (this.statusSelect) this.statusSelect.value = this.statusFilter;
    if (this.prioritySelect) this.prioritySelect.value = this.priorityFilter;
    if (this.categorySelect) this.categorySelect.value = this.categoryFilter;
    if (this.searchInput) this.searchInput.value = this.searchQuery;

    this.applyView(); // recomputes + renders edges, applies edgeTypes
  }

  private saveCurrentLens(): void {
    new TextInputModal(
      this.app,
      { title: 'Save lens preset', label: 'Preset name', placeholder: 'e.g. Blocked work', cta: 'Save' },
      (name) => {
        void this.persistCurrentLens(name);
      },
    ).open();
  }

  private async persistCurrentLens(name: string): Promise<void> {
    const id = nextPresetId(this.settings.savedLenses);
    this.plugin.settings.savedLenses.push(stateToPreset(id, name, this.currentLensState()));
    await this.plugin.saveSettings();
    this.renderPresetOptions();
    if (this.presetSelect) this.presetSelect.value = id;
    if (this.presetDeleteBtn) this.presetDeleteBtn.hidden = false;
    new Notice(`Saved lens "${name}"`);
  }

  private async deleteSelectedPreset(): Promise<void> {
    const id = this.presetSelect?.value ?? '';
    const idx = this.settings.savedLenses.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const [removed] = this.plugin.settings.savedLenses.splice(idx, 1);
    await this.plugin.saveSettings();
    this.renderPresetOptions();
    new Notice(`Deleted lens "${removed.name}"`);
  }

  /** Per-project severity color map for the Needs-Attention lens (visible projects only). */
  private attentionLensColors(): Map<string, number> {
    const severity = topSeverityByProject(this.warnings);
    const colors = new Map<string, number>();
    for (const p of this.filteredProjects) {
      const sev = severity.get(p.path);
      if (sev) colors.set(p.path, HypernovumView.ATTENTION_COLORS[sev]);
    }
    return colors;
  }

  private updateSummary(): void {
    if (!this.summaryEl) return;
    const gitCount = this.allProjects.filter((p) => p.gitActivity).length;
    const memoryCount = this.allProjects.filter((p) => p.hasMemoryContext).length;
    const questCount = this.allProjects.reduce((sum, p) => sum + (p.questions?.length ?? 0), 0);
    const questPart = questCount > 0 ? ` | ◆ ${questCount} quests` : '';
    this.summaryEl.textContent = `${this.filteredProjects.length}/${this.allProjects.length} shown | ${gitCount} git | ${memoryCount} memory${questPart}`;
  }

  /** State chip reusing the agent-state CSS classes. */
  private appendAgentStateChip(parent: HTMLElement, state: string): void {
    parent.createSpan({ cls: `agent-state agent-state-${state}`, text: state });
  }

  /** Inspector "Agents" section for one project (AGT-009). */
  private appendAgentsSection(parent: HTMLElement, projectPath: string): void {
    const sessions = this.agentRegistry.sessionsForProject(projectPath);
    const section = this.createSection(parent, 'Agents');

    if (sessions.length === 0) {
      section.createDiv({ cls: 'inspector-empty-inline', text: 'No agent activity' });
      return;
    }

    const active = sessions.filter((s) => s.state !== 'complete');
    const completed = sessions.filter((s) => s.state === 'complete');

    if (active.length === 0) {
      section.createDiv({ cls: 'inspector-empty-inline', text: 'No active agents' });
    }

    for (const s of active) {
      const row = section.createDiv({ cls: 'agent-row' });
      const head = row.createDiv({ cls: 'agent-row-head' });
      head.createEl('strong', { text: s.name });
      this.appendAgentStateChip(head, s.state);

      const file = s.file ? (s.file.split(/[\\/]/).pop() ?? '') : '';
      const sub = [s.action ?? '', file].filter(Boolean).join(' · ');
      if (sub) row.createDiv({ cls: 'agent-row-sub', text: sub });

      row.createDiv({
        cls: 'agent-row-meta',
        text: `started ${this.formatRelativeTime(s.sessionStart)}`,
      });
    }

    if (completed.length > 0) {
      section.createDiv({
        cls: 'agent-completed',
        text: `${completed.length} completed session${completed.length > 1 ? 's' : ''} · last 24h`,
      });
    }
  }

  private titleOf(path: string): string {
    return this.allProjects.find((p) => p.path === path)?.title ?? path;
  }

  // --- Trace impact (IMP-002) ---

  private enterTraceImpact(project: ProjectData): void {
    const result = collectImpact(this.structuralEdges, project.path);
    this.traceResult = result;
    const up = new Set(result.upstream.map((n) => n.path));
    const down = new Set(result.downstream.map((n) => n.path));
    if (up.size === 0 && down.size === 0) {
      new Notice('No known dependencies or dependents');
      this.traceResult = null;
      return;
    }
    this.interactionStore.getState().select(project.path);
    this.interactionStore.getState().setTraceImpact({ originPath: project.path });
    this.sceneManager?.setTraceImpact(project.path, up, down);
    this.updateInspector();
  }

  private exitTrace(): void {
    if (!this.traceResult) return;
    this.traceResult = null;
    this.sceneManager?.setTraceImpact(null, new Set(), new Set());
    if (this.interactionStore.getState().traceImpact) this.interactionStore.getState().setTraceImpact(null);
    this.updateInspector();
  }

  /** Trace-impact result list for the origin's inspector (grouped by direction). */
  private appendTraceImpact(parent: HTMLElement, projectPath: string): void {
    const r = this.traceResult;
    if (!r || r.origin !== projectPath) return;

    const liveAgents = new Set(
      this.fleetSessions.filter((s) => s.projectPath).map((s) => s.projectPath!),
    );

    const section = parent.createDiv({ cls: 'inspector-section trace-section' });
    const label = section.createSpan({ cls: 'section-label', text: 'Trace Impact ' });
    const exit = label.createEl('button', { cls: 'trace-exit', text: '✕' });
    exit.setAttribute('title', 'Exit trace (Esc)');
    exit.addEventListener('click', (e) => {
      e.stopPropagation();
      this.exitTrace();
    });

    const group = (groupLabel: string, nodes: { path: string; depth: number }[]): void => {
      if (nodes.length === 0) return;
      const wrap = section.createDiv({ cls: 'trace-group' });
      wrap.createDiv({ cls: 'trace-group-label', text: groupLabel });
      for (const n of nodes) {
        this.appendFocusRow(wrap, n.path, (row) => {
          row.createSpan({ cls: 'trace-depth', text: String(n.depth) });
          row.appendText(this.titleOf(n.path));
          if (liveAgents.has(n.path)) row.createSpan({ cls: 'trace-agent', text: '●' });
        });
      }
    };

    group('Upstream · dependencies', r.upstream);
    group('Downstream · dependents', r.downstream);

    if (r.truncated) {
      section.createDiv({
        cls: 'inspector-empty-inline',
        text: 'Results truncated (depth/size cap)',
      });
    }
  }

  private formatDuration(ms: number): string {
    const min = Math.round(ms / 60000);
    if (min < 1) return '<1m';
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  /**
   * Last-session digest for a project (SES-002/003), read from JSONL and cached.
   *
   * The read walks a directory and parses files, so it must not happen on every
   * inspector render — the fleet poller calls that twice a second.
   */
  private sessionDigestFor(project: ProjectData, now: number): SessionDigest | null {
    const cached = this.sessionDigestCache.get(project.path);
    if (cached && now - cached.at < HypernovumView.SESSION_DIGEST_TTL_MS) {
      return cached.digest;
    }

    const vaultBase = this.vaultBase ?? getVaultBasePath(this.app);
    if (!vaultBase) return null;

    const sessionsDir = path.join(vaultBase, '.hypernovum', 'sessions');
    const dirBase = this.projectDirOf(project)?.split(/[\\/]/).pop()?.toLowerCase();
    const digest = this.sessionReader.readLatestForProject(sessionsDir, (proj) => {
      if (!proj) return false;
      const p = proj.toLowerCase();
      return p === project.title.toLowerCase() || p === dirBase;
    }) ?? null;

    this.sessionDigestCache.set(project.path, { at: now, digest });
    return digest;
  }

  /** Session section for the project inspector. */
  private appendSessionDigest(parent: HTMLElement, project: ProjectData, now: number): void {
    const digest = this.sessionDigestFor(project, now);
    if (!digest) return;

    const files = digest.filesTouched.length;
    // Commits that landed inside the session window (from cached recentCommits).
    const commits = (project.gitActivity?.recentCommits ?? [])
      .filter((c) => c.ts >= digest.startT && c.ts <= digest.endT + 60_000).length;
    const parts = [
      digest.name ?? 'Session',
      this.formatDuration(digest.durationMs),
      `${files} file${files === 1 ? '' : 's'}`,
    ];
    if (commits > 0) parts.push(`${commits} commit${commits === 1 ? '' : 's'}`);

    const section = this.createSection(parent, 'Session');
    this.appendSignalRow(section, 'Last session', parts.join(' · '));

    // Plan-vs-action lite (SES-003): only when the agent declared plannedFiles.
    if (digest.plannedFiles && digest.plannedFiles.length) {
      this.appendSignalRow(
        section,
        'Plan vs action',
        `planned ${digest.plannedFiles.length} · touched ${files}`,
      );
    }
  }

  /** Depends on / Used by / Blocked by / Blocks sections for one project (EDG-007). */
  private appendDependencySections(parent: HTMLElement, projectPath: string): void {
    const deps: string[] = [], usedBy: string[] = [], blockedBy: string[] = [], blocks: string[] = [];
    for (const e of this.structuralEdges) {
      if (e.type === 'depends-on') {
        if (e.from === projectPath) deps.push(e.to);
        else if (e.to === projectPath) usedBy.push(e.from);
      } else if (e.type === 'blocked-by') {
        if (e.to === projectPath) blockedBy.push(e.from);   // blocker → blocked (this)
        else if (e.from === projectPath) blocks.push(e.to);
      }
    }

    const group = (label: string, paths: string[]): void => {
      const uniq = [...new Set(paths)];
      if (uniq.length === 0) return;
      const section = this.createSection(parent, label);
      for (const p of uniq) {
        this.appendFocusRow(section, p, (row) => {
          row.createSpan({ cls: 'dep-arrow', text: '→' });
          row.appendText(this.titleOf(p));
        });
      }
    };

    group('Depends on', deps);
    group('Used by', usedBy);
    group('Blocked by', blockedBy);
    group('Blocks', blocks);
  }

  /** A project's full warning list (TRI-003), actionable, severity-ordered. */
  private appendProjectWarnings(parent: HTMLElement, projectPath: string): void {
    const relevant = this.warnings.filter((w) => w.projectPath === projectPath);
    if (relevant.length === 0) return;
    const section = this.createSection(parent, 'Attention');
    this.appendWarningRows(section, relevant, false);
  }

  /**
   * Fingerprint of everything the inspector displays.
   *
   * The fleet poller fires every 500ms and used to call updateInspector()
   * unconditionally, which tore down and rebuilt the whole panel twice a second:
   * mousedown and mouseup landed on different nodes so buttons dropped clicks,
   * text could never be selected, and scroll position reset constantly. Now a
   * render only happens when this string changes.
   *
   * The minute bucket is deliberate: relative timestamps ("2 days ago") need to
   * refresh, but at most once a minute rather than 120 times.
   */
  private inspectorSignatureFor(project: ProjectData | null, now: number): string {
    const minuteBucket = Math.floor(now / 60_000);
    if (!project) {
      const warnKey = topWarningPerProject(this.warnings)
        .map((w) => `${w.projectPath}:${w.severity}:${w.message}`)
        .join('|');
      const feedKey = this.fleetSessions.map((s) => `${s.sessionId}:${s.state}:${s.lastPing}`).join('|');
      // Every number the overview prints has to be in here. Fingerprinting only
      // path/status/category left the quest total, the 30-day commit count and the
      // recent-activity feed stale until the minute bucket happened to roll over.
      const projectKey = this.filteredProjects
        .map((p) => {
          const g = p.gitActivity;
          return [
            p.path,
            p.status,
            p.category,
            p.questions?.length ?? 0,
            g ? `${g.commitsLast30d}:${g.commitsLast7d}:${g.lastCommitDate}:${g.recentCommits?.[0]?.hash ?? ''}` : '-',
          ].join(':');
        })
        .join(',');

      // The activity feed reads ALL projects, not just the filtered set, so a
      // commit on a filtered-out project still has to invalidate the render.
      const allCommitsKey = this.allProjects
        .map((p) => p.gitActivity?.lastCommitDate ?? 0)
        .join('.');

      return [
        'overview',
        minuteBucket,
        this.filteredProjects.length,
        projectKey,
        allCommitsKey,
        this.conflicts.filter((c) => c.severity !== 'info').length,
        warnKey,
        feedKey,
      ].join('~');
    }

    const git = project.gitActivity;
    const sessions = this.agentRegistry.sessionsForProject(project.path);
    const digest = this.sessionDigestFor(project, now);
    const edges = this.structuralEdges
      .filter((e) => e.from === project.path || e.to === project.path)
      .map((e) => `${e.type}:${e.from}>${e.to}`)
      .join(',');

    return [
      'project',
      minuteBucket,
      project.path,
      project.title,
      project.status,
      project.priority,
      project.category,
      project.hasMemoryContext ? '1' : '0',
      this.projectDirOf(project) ?? '-',
      git
        ? [
            git.activeBranch ?? '',
            git.lastCommitDate,
            git.commitsLast30d,
            git.hasUncommittedChanges ? 'd' : 'c',
            git.ahead ?? '-',
            git.behind ?? '-',
            (git.recentCommits ?? []).map((c) => c.hash).join('.'),
          ].join(':')
        : '-',
      (project.questions ?? []).join('¦'),
      project.answeredQuestions?.length ?? 0,
      this.traceResult && this.traceResult.origin === project.path
        ? `trace:${this.traceResult.upstream.length}:${this.traceResult.downstream.length}:${this.traceResult.truncated}`
        : '-',
      this.warnings
        .filter((w) => w.projectPath === project.path)
        .map((w) => `${w.severity}:${w.message}`)
        .join('|'),
      edges,
      sessions.map((s) => `${s.sessionId}:${s.state}:${s.action ?? ''}:${s.file ?? ''}`).join('|'),
      digest ? `${digest.startT}:${digest.endT}:${digest.filesTouched.length}` : '-',
    ].join('~');
  }

  private updateInspector(force = false): void {
    if (!this.inspectorPanel) return;

    const now = Date.now();
    const project = this.selectedProject;
    const signature = this.inspectorSignatureFor(project, now);
    if (!force && signature === this.inspectorSignature) return;
    this.inspectorSignature = signature;

    if (!project) {
      this.renderCityOverview();
      return;
    }

    const panel = this.inspectorPanel;
    panel.empty();

    const projectPath = this.projectDirOf(project);
    const dirSource = this.resolveProjectDirFor(project)?.source;
    const git = project.gitActivity;

    const header = panel.createDiv({ cls: 'inspector-header' });
    header.createSpan({ cls: 'inspector-kicker', text: 'PROJECT' });
    const close = header.createEl('button', { cls: 'inspector-close', text: '✕' });
    close.setAttribute('title', 'Back to city overview');
    close.addEventListener('click', () => this.interactionStore.getState().clearSelection());
    header.createEl('h3', { text: project.title });

    const grid = panel.createDiv({ cls: 'inspector-grid' });
    const cell = (label: string, value: string) => {
      const div = grid.createDiv();
      div.createSpan({ text: label });
      div.createEl('strong', { text: value });
    };
    cell('Status', project.status);
    cell('Priority', project.priority);
    cell('Category', project.category);
    cell('Memory', project.hasMemoryContext ? 'Ready' : 'Not found');

    const gitSection = this.createSection(panel, 'Git Signals');
    if (!this.plugin.agentFeaturesEnabled) {
      // Don't offer to "set a project folder" here — nothing would read it while
      // the agent layer is off.
      gitSection.createDiv({
        cls: 'inspector-empty-inline',
        text: 'Vault mode — Git signals are off',
      });
    } else if (!projectPath) {
      // Being explicit beats showing the vault's Git data as if it were this
      // project's, which is what the old vault-root fallback did.
      gitSection.createDiv({
        cls: 'inspector-empty-inline',
        text: 'No project folder set — Git signals unavailable',
      });
      const setBtn = gitSection.createEl('button', {
        cls: 'inspector-inline-action',
        text: 'Set project folder…',
      });
      setBtn.addEventListener('click', () => {
        void this.promptForProjectDir(project);
      });
    } else if (!git) {
      gitSection.createDiv({ cls: 'inspector-empty-inline', text: 'Not a Git repository' });
    } else {
      this.appendSignalRow(gitSection, 'Branch', git.activeBranch ?? 'n/a');
      this.appendSignalRow(
        gitSection,
        'Last commit',
        git.lastCommitDate ? this.formatRelativeTime(git.lastCommitDate) : 'n/a',
      );
      this.appendSignalRow(gitSection, '30d commits', String(git.commitsLast30d ?? 0));
      this.appendSignalRow(gitSection, 'Working tree', git.hasUncommittedChanges ? 'Changed' : 'Clean');
      if (git.ahead != null || git.behind != null) {
        this.appendSignalRow(
          gitSection,
          'Upstream',
          `${git.ahead ?? 0} ahead · ${git.behind ?? 0} behind`,
        );
      }
    }

    if (git?.recentCommits && git.recentCommits.length > 0) {
      const commits = this.createSection(panel, 'Recent Commits');
      for (const c of git.recentCommits) {
        const row = commits.createDiv({ cls: 'commit-row' });
        row.createEl('code', { text: c.hash });
        row.createSpan({ cls: 'commit-subject', text: c.subject });
        row.createSpan({ cls: 'commit-time', text: this.formatRelativeTime(c.ts) });
      }
    }

    if (project.questions && project.questions.length > 0) {
      const resolved = project.answeredQuestions?.length
        ? ` · ${project.answeredQuestions.length} resolved`
        : '';
      const quests = this.createSection(panel, `Open Quests${resolved}`);
      for (const q of project.questions) {
        const row = quests.createDiv({ cls: 'quest-row' });
        row.createSpan({ cls: 'quest-gem', text: '◆' });
        row.appendText(q);
      }
    }

    this.appendTraceImpact(panel, project.path);
    this.appendProjectWarnings(panel, project.path);
    this.appendDependencySections(panel, project.path);
    this.appendAgentsSection(panel, project.path);
    this.appendSessionDigest(panel, project, now);

    const pathRow = panel.createDiv({ cls: 'inspector-path' });
    if (projectPath) {
      pathRow.setAttribute('title', dirSource ? DIR_SOURCE_LABEL[dirSource] : '');
      pathRow.setText(projectPath);
    } else {
      pathRow.setText(project.path);
    }

    const actions = panel.createDiv({ cls: 'inspector-actions' });
    // Same rule as the context menu: with the agent layer off, the buttons that
    // spawn a process or write outside the vault aren't rendered at all.
    const agentsOn = this.plugin.agentFeaturesEnabled;
    const action = (label: string, handler: () => void, needsDir = false) => {
      const btn = actions.createEl('button', { text: label });
      if (needsDir && !projectPath) {
        btn.disabled = true;
        btn.setAttribute('title', 'Set a project folder first');
      }
      btn.addEventListener('click', handler);
      return btn;
    };

    action('Open Note', () => {
      void this.app.workspace.openLinkText(project.path, '', false);
    });

    if (agentsOn) {
      action('Folder', () => {
        const dir = this.requireProjectDir(project);
        if (!dir) return;
        void TerminalLauncher.openInExplorer(dir).then((result) => {
          new Notice(
            result.success ? `Opened ${project.title} folder` : `Failed to open folder: ${result.message}`,
          );
        });
      }, true);
      action('Terminal', () => {
        const dir = this.requireProjectDir(project);
        if (dir) void this.openTerminalForProject(project, dir);
      }, true);
      action('Launch Agent', () => {
        const dir = this.requireProjectDir(project);
        if (dir) void this.launchAgentForProject(project, dir);
      }, true);
      action('Context', () => {
        const dir = this.requireProjectDir(project);
        if (dir) this.copyAgentContext(project, dir);
      }, true);
    }

    if (agentsOn) {
      action('Copy Path', () => {
        const dir = this.requireProjectDir(project);
        if (dir) void this.copyProjectPath(dir);
      }, true);
    }
    action('Add Quest', () => this.addQuestForProject(project));
    action('Focus', () => {
      if (project.position && this.sceneManager) {
        this.sceneManager.focusOnPosition(project.position);
        this.sceneManager.setFocusedProject(project);
      }
    });
  }

  /** Recent-activity feed (TRI-005): recent commits + just-completed sessions. */
  private appendActivityFeed(parent: HTMLElement): void {
    const now = Date.now();
    const WEEK = 7 * 24 * 3600 * 1000;
    const DAY = 24 * 3600 * 1000;
    const rows: { label: string; ts: number }[] = [];

    for (const p of this.allProjects) {
      const g = p.gitActivity;
      if (g?.lastCommitDate && now - g.lastCommitDate <= WEEK) {
        const subj = g.recentCommits?.[0]?.subject;
        rows.push({ ts: g.lastCommitDate, label: `${p.title} — commit${subj ? ` "${subj}"` : ''}` });
      }
    }
    for (const s of this.fleetSessions) {
      if (s.state === 'complete' && now - s.lastPing <= DAY) {
        const title = s.projectPath ? this.allProjects.find((p) => p.path === s.projectPath)?.title ?? '' : '';
        rows.push({ ts: s.lastPing, label: `${title ? `${title} — ` : ''}${s.name} session complete` });
      }
    }

    rows.sort((a, b) => b.ts - a.ts);
    const top = rows.slice(0, 5);
    if (top.length === 0) return;

    const section = this.createSection(parent, 'Recent Activity');
    for (const r of top) {
      const row = section.createDiv({ cls: 'activity-row' });
      row.createSpan({ cls: 'activity-label', text: r.label });
      row.createSpan({ cls: 'activity-time', text: this.formatRelativeTime(r.ts) });
    }
  }

  /** District analytics readout shown when no building is selected */
  private renderCityOverview(): void {
    if (!this.inspectorPanel) return;
    const panel = this.inspectorPanel;
    const projects = this.filteredProjects;

    panel.empty();

    if (projects.length === 0) {
      panel.createDiv({ cls: 'inspector-empty', text: 'No projects in view' });
      return;
    }

    const active = projects.filter((p) => p.status === 'active').length;
    const blocked = projects.filter((p) => p.status === 'blocked').length;
    const quests = projects.reduce((sum, p) => sum + (p.questions?.length ?? 0), 0);
    const commits30d = projects.reduce((sum, p) => sum + (p.gitActivity?.commitsLast30d ?? 0), 0);

    const header = panel.createDiv({ cls: 'inspector-header' });
    header.createSpan({ cls: 'inspector-kicker', text: 'CITY OVERVIEW' });
    header.createEl('h3', { text: `${projects.length} projects` });

    const grid = panel.createDiv({ cls: 'inspector-grid' });
    const cell = (label: string, value: number) => {
      const div = grid.createDiv();
      div.createSpan({ text: label });
      div.createEl('strong', { text: String(value) });
    };
    cell('Active', active);
    cell('Blocked', blocked);
    cell('Open quests', quests);
    cell('30d commits', commits30d);

    // Fleet summary (AGT-009)
    const sessions = this.fleetSessions;
    if (sessions.length > 0) {
      const waitingAgents = sessions.filter((s) => s.state === 'waiting').length;
      const activeAgents = sessions.filter(
        (s) => !['complete', 'stale', 'disconnected', 'waiting'].includes(s.state),
      ).length;
      const conflictCount = this.conflicts.filter((c) => c.severity !== 'info').length;
      panel.createDiv({
        cls: 'fleet-summary',
        text: `${activeAgents} active · ${waitingAgents} waiting · ${conflictCount} conflict${conflictCount === 1 ? '' : 's'}`,
      });
    }

    // Attention section (TRI-003): one row per project (highest severity), top 8.
    const topWarnings = topWarningPerProject(this.warnings);
    const attention = this.createSection(panel, 'Attention');
    if (topWarnings.length === 0) {
      attention.createDiv({
        cls: 'inspector-empty-inline',
        text: 'City is healthy — nothing needs you',
      });
    } else {
      const shown = topWarnings.slice(0, 8);
      this.appendWarningRows(attention, shown, true);
      const moreCount = topWarnings.length - shown.length;
      if (moreCount > 0) {
        attention.createDiv({ cls: 'inspector-empty-inline', text: `+${moreCount} more` });
      }
    }

    this.appendActivityFeed(panel);

    const districts = new Map<string, ProjectData[]>();
    for (const p of projects) {
      const list = districts.get(p.category) ?? [];
      list.push(p);
      districts.set(p.category, list);
    }
    const districtSection = this.createSection(panel, 'Districts');
    for (const [category, list] of [...districts.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const activeCount = list.filter((p) => p.status === 'active').length;
      const questCount = list.reduce((sum, p) => sum + (p.questions?.length ?? 0), 0);
      const questPart = questCount > 0 ? ` · ◆${questCount}` : '';
      this.appendSignalRow(districtSection, category, `${list.length} · ${activeCount} active${questPart}`);
    }

    panel.createDiv({ cls: 'inspector-empty', text: 'Select a building for details' });
  }

  private copyAgentContext(project: ProjectData, projectPath: string): void {
    const vaultPath = this.vaultBase ?? getVaultBasePath(this.app);
    if (!vaultPath) {
      new Notice('Agent context needs a local vault folder.');
      return;
    }
    generateAgentContext(projectPath, vaultPath, {
      project,
      weather: project.gitActivity ?? null,
      memoryContextPath: project.memoryContextPath ?? null,
      heartbeat: heartbeatPaths(this.app),
    });

    const setupPath = path.join(projectPath, '.hypernovum', 'SETUP.md');
    void navigator.clipboard.writeText(setupPath).then(
      () => new Notice('Agent context path copied'),
      () => new Notice('Could not copy agent context path'),
    );
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
    const indicator = container.createDiv({ cls: 'hypernovum-activity-indicator' });
    const status = indicator.createDiv({ cls: 'activity-status' });
    status.createSpan({ cls: 'activity-dot' });
    status.createSpan({ cls: 'activity-text', text: 'IDLE' });
    indicator.createDiv({ cls: 'activity-project' });
    indicator.createDiv({ cls: 'activity-action' });
    indicator.hidden = true;
    this.activityIndicator = indicator;
  }

  /** Feed the fleet into the session registry and render one orb per session. */
  private onFleetUpdate(agents: AgentPresence[]): void {
    if (!this.sceneManager) return;
    const sessions = this.agentRegistry.update(agents, Date.now());
    this.fleetSessions = sessions;

    // Orbs render for every session resolved to a visible building, carrying
    // full identity for the hover tooltip. Lifecycle-state visuals (stale grey
    // / complete fade) are applied by AGT-005.
    this.sceneManager.updateAgentPresence(
      sessions
        .filter((s) => s.projectPath)
        .map((s) => ({
          id: s.sessionId,
          projectPath: s.projectPath,
          name: s.name,
          agentType: s.agentType,
          state: s.state,
          action: s.action,
          tool: s.tool,
          file: s.file,
          lastPing: s.lastPing,
        })),
    );

    // Recompute conflicts (throttled ~2s) and present them in-scene.
    const now = Date.now();
    if (now - this.lastConflictRun >= 2000) {
      this.lastConflictRun = now;
      this.conflicts = detectConflicts(sessions, this.conflictProjects);

      // Only high/medium conflicts get a ring + material channel (info is
      // inspector-only). Collapse to top severity per building.
      const levels = new Map<string, 'high' | 'medium'>();
      for (const c of this.conflicts) {
        if (c.severity === 'info') continue;
        for (const path of c.projectPaths) {
          const prev = levels.get(path);
          if (!prev || (prev === 'medium' && c.severity === 'high')) levels.set(path, c.severity);
        }
      }
      this.sceneManager.setConflicts([...levels].map(([path, severity]) => ({ path, severity })));
    }

    // Agents/conflicts change the warning set — recompute badge + attention lens.
    this.recomputeWarnings();
    if (this.visualLayer === 'attention') {
      this.sceneManager.setAttentionLens(this.attentionLensColors());
    }

    // Refresh agent-working-on edges only when the live set actually changed.
    if (this.agentEdgeSignature() !== this.lastAgentSig) {
      this.refreshEdges();
      if (this.interactionStore.getState().selectedPath) {
        this.updateConnectedPaths(this.interactionStore.getState().selectedPath);
      }
    }

    // Keep the inspector's Agents section in sync when a project is selected.
    if (this.selectedProject) this.updateInspector();
  }

  /** Handle Claude Code activity start */
  private onClaudeActivityStart(status: ActivityStatus): void {
    this.updateActivityIndicator(status, true);

    if (!this.sceneManager || !status.project) return;

    // Try to find the project in our city
    const project = this.sceneManager.findProjectByName(status.project);
    if (project) {
      this.sceneManager.startStreaming(project.path);
    }
  }

  /** Handle Claude Code activity update */
  private onClaudeActivityUpdate(status: ActivityStatus): void {
    this.updateActivityIndicator(status, true);

    // Check if project changed
    if (!this.sceneManager || !status.project) return;

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
      this.activityIndicator.hidden = false;
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
      window.setTimeout(() => {
        if (this.activityIndicator && !this.activityMonitor?.isCurrentlyActive()) {
          this.activityIndicator.hidden = true;
        }
      }, 2000);
    }
  }

  /** Show context menu for right-clicked building */
  /** Open a plain shell in the project dir (no agent) — TRI-006. */
  private async openTerminalForProject(project: ProjectData, projectPath: string): Promise<void> {
    const result = await TerminalLauncher.openShell(projectPath);
    new Notice(result.success ? `Opened terminal in ${project.title}` : `Failed to open terminal: ${result.message}`);
  }

  /** Add a research question to a project's frontmatter from the city — TRI-008. */
  private addQuestForProject(project: ProjectData): void {
    new TextInputModal(
      this.app,
      { title: `Add quest — ${project.title}`, label: 'Research question', placeholder: 'What do we still need to answer?', cta: 'Add quest' },
      (question) => {
        void this.persistQuest(project, question);
      },
    ).open();
  }

  private async persistQuest(project: ProjectData, question: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(project.path);
    if (!(file instanceof TFile)) {
      new Notice('Could not find the project note');
      return;
    }

    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        const existing = fm.questions;
        const questions = Array.isArray(existing) ? existing.slice() : (existing ? [existing] : []);
        questions.push(question);
        fm.questions = questions;
      });
      new Notice(`Quest added to ${project.title}`);
    } catch {
      new Notice('Could not add quest');
    }
  }

  /** Copy the resolved project directory to the clipboard — TRI-007. */
  private async copyProjectPath(projectPath: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(projectPath);
      new Notice('Path copied to clipboard');
    } catch {
      new Notice('Could not copy path');
    }
  }

  private showBuildingContextMenu(hit: RaycastHit, event: MouseEvent): void {
    const menu = new Menu();
    const project = hit.project;

    // May be null — the folder-dependent items handle that rather than silently
    // acting on the vault root.
    const projectPath = this.projectDirOf(project);
    // Vault mode / withheld consent promises "no local processes", so the items
    // that spawn one are omitted entirely rather than left to fail.
    const agentsOn = this.plugin.agentFeaturesEnabled;

    const agentName = this.settings.agentName || 'Claude Code';
    if (agentsOn) {
      menu.addItem((item) => {
        item
          .setTitle(`Launch ${agentName}`)
          .setIcon('terminal')
          .onClick(async () => {
            const dir = this.requireProjectDir(project);
            if (dir) await this.launchAgentForProject(project, dir);
          });
      });
    }

    menu.addItem((item) => {
      item
        .setTitle(projectPath ? 'Change project folder' : 'Set project folder…')
        .setIcon('folder-symlink')
        .onClick(() => this.promptForProjectDir(project));
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
        .setTitle('Move building')
        .setIcon('move')
        .onClick(() => {
          this.sceneManager?.enterBuildingMoveModeByPath(project.path);
        });
    });

    if (agentsOn) {
      menu.addItem((item) => {
        item
          .setTitle('Open folder')
          .setIcon('folder-open')
          .onClick(async () => {
            const dir = this.requireProjectDir(project);
            if (!dir) return;
            const result = await TerminalLauncher.openInExplorer(dir);
            if (result.success) {
              new Notice(`Opened ${project.title} folder`);
            } else {
              new Notice(`Failed to open folder: ${result.message}`);
            }
          });
      });

      menu.addItem((item) => {
        item
          .setTitle('Open terminal')
          .setIcon('square-terminal')
          .onClick(() => {
            const dir = this.requireProjectDir(project);
            if (dir) void this.openTerminalForProject(project, dir);
          });
      });
    }

    menu.addItem((item) => {
      item
        .setTitle('Copy path')
        .setIcon('copy')
        .onClick(() => {
          const dir = this.requireProjectDir(project);
          if (dir) void this.copyProjectPath(dir);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Add quest')
        .setIcon('diamond')
        .onClick(() => this.addQuestForProject(project));
    });

    menu.addItem((item) => {
      item
        .setTitle('Trace impact')
        .setIcon('git-fork')
        .onClick(() => this.enterTraceImpact(project));
    });

    menu.addSeparator();

    menu.addItem((item) => {
      item
        .setTitle('Open note')
        .setIcon('file-text')
        .onClick(() => {
          void this.app.workspace.openLinkText(project.path, '', false);
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

  /**
   * Resolve a project's working directory, memoised per rebuild.
   *
   * Returns null when there isn't one. The old version ended with "…otherwise the
   * vault root", so a project note with no `projectDir` silently reported the
   * *vault's* Git branch/commits/dirty state, opened terminals in the vault, and
   * had agent context written into the vault itself. Rules live in
   * utils/projectPaths.ts.
   */
  private resolveProjectDirFor(project: ProjectData): ResolvedProjectDir | null {
    const cached = this.projectDirs.get(project.path);
    if (cached !== undefined) return cached;

    // Resolution itself stats directories outside the vault, so it belongs behind
    // the same consent gate as everything else that touches the wider filesystem.
    const base = this.plugin.agentFeaturesEnabled
      ? this.vaultBase ?? getVaultBasePath(this.app)
      : null;
    if (!base) {
      this.projectDirs.set(project.path, null);
      return null;
    }
    this.vaultBase = base;

    const resolved = resolveProjectDir(
      { notePath: project.path, projectDir: project.projectDir },
      {
        vaultBase: base,
        dirExists: isDirectory,
        isProjectRoot,
        isAbsolute: path.isAbsolute,
        join: path.join,
        dirname: path.dirname,
      },
    );

    this.projectDirs.set(project.path, resolved);
    return resolved;
  }

  /** Resolved directory path, or null when the project has none. */
  private projectDirOf(project: ProjectData): string | null {
    return this.resolveProjectDirFor(project)?.path ?? null;
  }

  /**
   * Map a heartbeat session onto a building.
   *
   * Directory match first: a hook only knows its working directory, and matching
   * that against each project's resolved dir works even when the project's *title*
   * differs from its folder name. Name matching alone silently failed for those —
   * no orb, no conflict detection — which is most projects with a human-readable
   * title over a kebab-case folder.
   */
  private resolveAgentProjectPath(presence: AgentPresence): string | null {
    if (presence.cwd) {
      for (const project of this.allProjects) {
        const dir = this.projectDirOf(project);
        if (dir && samePath(dir, presence.cwd)) return project.path;
      }
    }
    if (presence.project) {
      return this.sceneManager?.findProjectByName(presence.project)?.path ?? null;
    }
    return null;
  }

  /**
   * Directory for an action that genuinely needs one (launch agent, open
   * terminal, open folder). Explains the problem and offers to fix it rather than
   * quietly acting on the vault root.
   */
  private requireProjectDir(project: ProjectData): string | null {
    const dir = this.projectDirOf(project);
    if (dir) return dir;

    new Notice(`${project.title} has no project folder. Use “Set project folder…” first.`, 12000);
    return null;
  }

  /**
   * Ask for a project folder and write it to the note's `projectDir` frontmatter.
   *
   * Without this the only way to link a repo was to hand-author frontmatter, which
   * meant most projects never got Git data or a usable agent launch directory.
   */
  private async promptForProjectDir(project: ProjectData): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(project.path);
    if (!(file instanceof TFile)) {
      new Notice('Could not find the project note.');
      return;
    }

    const suggestion = this.suggestProjectDir(project);

    new ProjectDirModal(this.app, project.title, suggestion, async (value) => {
      const trimmed = value.trim();
      if (!trimmed) return;

      const base = this.vaultBase ?? getVaultBasePath(this.app);
      const absolute = base && !path.isAbsolute(trimmed) ? path.join(base, trimmed) : trimmed;
      if (!isDirectory(absolute)) {
        new Notice(`Not a folder: ${absolute}`);
        return;
      }

      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm.projectDir = trimmed;
      });

      // Drop the memoised resolution + Git snapshot so the next rebuild sees it.
      this.projectDirs.delete(project.path);
      this.gitCollector.invalidate();
      new Notice(`${project.title} → ${trimmed}`);
      await this.buildCity();
    }).open();
  }

  /**
   * Best guess for a project folder: the nearest Git repo at or above the note's
   * own folder, else the note's folder. Only used to prefill the prompt.
   */
  private suggestProjectDir(project: ProjectData): string {
    const base = this.vaultBase ?? getVaultBasePath(this.app);
    if (!base) return '';

    let cursor = path.join(base, path.dirname(project.path));
    for (let depth = 0; depth < 8; depth++) {
      if (isDirectory(cursor) && existsSync(path.join(cursor, '.git'))) return cursor;
      const next = path.dirname(cursor);
      if (next === cursor) break;
      cursor = next;
    }
    const noteFolder = path.join(base, path.dirname(project.path));
    return isDirectory(noteFolder) ? noteFolder : '';
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
    const vaultPath = this.vaultBase ?? getVaultBasePath(this.app);
    if (vaultPath) {
      generateAgentContext(projectPath, vaultPath, {
        project,
        weather: project.gitActivity ?? null,
        memoryContextPath: project.memoryContextPath ?? null,
        heartbeat: heartbeatPaths(this.app),
      });
    }

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
    const title = container.createDiv({ cls: 'hypernovum-hud-title', text: 'HYPERNOVUM' });
    // All styling lives in styles.css (.hypernovum-hud-title).
    const cursor = title.createSpan({ cls: 'hypernovum-cursor', text: '\u2588' });
    // Keyframes + animation live in styles.css (.hypernovum-cursor) \u2014 never
    // inject <style> into document.head; it leaks across plugin reloads.
    cursor.setAttribute('aria-hidden', 'true');
  }

  /** Show context menu for right-clicked Neural Core orb */
  private showOrbContextMenu(event: MouseEvent): void {
    // Its only item launches a process, so there's nothing to show when the agent
    // layer is off.
    if (!this.plugin.agentFeaturesEnabled) return;

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
    const dialog = await this.getElectronDialog();
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
    new FolderInputModal(this.app, (folderPath) => {
      void this.launchAgentInFolder(folderPath);
    }).open();
  }

  /** Try to get Electron's dialog API, or null if unavailable */
  private async getElectronDialog(): Promise<DirectoryDialog | null> {
    try {
      // Modern Electron (Obsidian 1.5+): @electron/remote
      const remote = await import('@electron/remote');
      if (remote.dialog) return remote.dialog;
    } catch { /* not available */ }

    try {
      // Legacy Electron: electron.remote
      const electron = await import('electron');
      if (electron.remote?.dialog) return electron.remote.dialog;
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
    const vaultPath = this.vaultBase ?? getVaultBasePath(this.app);
    if (vaultPath) {
      generateAgentContext(folderPath, vaultPath, { heartbeat: heartbeatPaths(this.app) });
    }

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
/**
 * Prompt for a project folder, prefilled with a best guess. Writes to the note's
 * `projectDir` frontmatter — the field that unlocks Git signals, terminal launches,
 * and dependency scanning for that project.
 */
class ProjectDirModal extends Modal {
  private value: string;
  private projectTitle: string;
  private onSubmit: (value: string) => void | Promise<void>;

  constructor(
    app: App,
    projectTitle: string,
    suggestion: string,
    onSubmit: (value: string) => void | Promise<void>,
  ) {
    super(app);
    this.projectTitle = projectTitle;
    this.value = suggestion;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: 'Set project folder' });
    contentEl.createEl('p', {
      text:
        `Which folder on disk does "${this.projectTitle}" live in? ` +
        'This is written to the note as projectDir, and enables Git signals, ' +
        'agent launches, and dependency detection.',
    });

    new Setting(contentEl)
      .setName('Folder path')
      .setDesc('Absolute, or relative to the vault.')
      .addText((text) => {
        text.setPlaceholder('C:/code/my-project');
        text.setValue(this.value);
        text.onChange((v) => { this.value = v; });
        text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.submit();
          }
        });
        window.setTimeout(() => text.inputEl.focus(), 0);
      });

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText('Save').setCta().onClick(() => this.submit()),
    );
  }

  private submit(): void {
    const trimmed = this.value.trim();
    if (!trimmed) {
      new Notice('Enter a folder path');
      return;
    }
    this.close();
    void this.onSubmit(trimmed);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

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

/** Generic single-line text prompt (used for Add Quest — TRI-008). */
class TextInputModal extends Modal {
  private inputValue = '';
  constructor(
    app: App,
    private opts: { title: string; label: string; placeholder: string; cta: string },
    private onSubmit: (value: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.opts.title });
    new Setting(contentEl)
      .setName(this.opts.label)
      .addText((text) => {
        text.setPlaceholder(this.opts.placeholder);
        text.onChange((v) => { this.inputValue = v; });
        text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter') { e.preventDefault(); this.submit(); }
        });
        window.setTimeout(() => text.inputEl.focus(), 0);
      });
    new Setting(contentEl).addButton((btn) => {
      btn.setButtonText(this.opts.cta).setCta().onClick(() => this.submit());
    });
  }

  private submit(): void {
    const trimmed = this.inputValue.trim();
    if (!trimmed) { new Notice('Please enter some text'); return; }
    this.close();
    this.onSubmit(trimmed);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}


