/**
 * Regression test for the city-overview fleet summary (AGT-009).
 *
 * Bug: onFleetUpdate() only refreshed the inspector when a project was
 * selected, so the overview panel (nothing selected) was never invalidated by
 * fleet changes. It permanently kept whatever it rendered before the first
 * fleet poll: zero `.fleet-summary` elements and an Attention list without any
 * agent-derived warnings — while orbs, the ⚠ badge and the per-project
 * inspector all showed the fleet correctly.
 *
 * The view class needs `obsidian` (unavailable under Node), so the module is
 * mocked with just enough surface for the module graph to evaluate, and the
 * view instance is built via Object.create() with a fake inspector panel that
 * implements Obsidian's HTMLElement helpers (createDiv/createSpan/createEl/…).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('obsidian', () => {
  // Callable-or-constructible stub per export, so `class X extends Modal` and
  // plain calls like `normalizePath(p)` both evaluate under Node.
  const stub = () =>
    function Stub(this: unknown) {
      return undefined;
    };
  return {
    ItemView: stub(),
    WorkspaceLeaf: stub(),
    App: stub(),
    Notice: stub(),
    TFile: stub(),
    TFolder: stub(),
    Menu: stub(),
    Modal: stub(),
    Setting: stub(),
    Plugin: stub(),
    PluginSettingTab: stub(),
    FileSystemAdapter: stub(),
    moment: stub(),
    normalizePath: (p: string) => p,
    debounce: (fn: unknown) => fn,
    Platform: { isWin: true, isMacOS: false, isLinux: false },
  };
});

import { HypernovumView } from '../src/views/HypernovumView';
import { AgentRegistry } from '../src/monitors/AgentRegistry';
import type { AgentPresence } from '../src/monitors/ActivityMonitor';
import type { ProjectData } from '@hypernovum/core';

/** Minimal stand-in for Obsidian's extended HTMLElement API used by the inspector. */
class FakeEl {
  children: FakeEl[] = [];
  cls: string;
  text: string;
  tag: string;
  hidden = false;
  classList = { toggle: () => {}, add: () => {}, remove: () => {} };

  constructor(tag = 'div', opts?: { cls?: string; text?: string }) {
    this.tag = tag;
    this.cls = opts?.cls ?? '';
    this.text = opts?.text ?? '';
  }
  createDiv(opts?: { cls?: string; text?: string }): FakeEl {
    const el = new FakeEl('div', opts);
    this.children.push(el);
    return el;
  }
  createSpan(opts?: { cls?: string; text?: string }): FakeEl {
    const el = new FakeEl('span', opts);
    this.children.push(el);
    return el;
  }
  createEl(tag: string, opts?: { cls?: string; text?: string }): FakeEl {
    const el = new FakeEl(tag, opts);
    this.children.push(el);
    return el;
  }
  empty(): void {
    this.children = [];
  }
  appendText(): void {}
  addEventListener(): void {}
  setAttribute(): void {}
  /** Depth-first search over class names. */
  findAll(cls: string): FakeEl[] {
    const out: FakeEl[] = [];
    const walk = (el: FakeEl) => {
      if (el.cls.split(' ').includes(cls)) out.push(el);
      el.children.forEach(walk);
    };
    walk(this);
    return out;
  }
}

function proj(path: string, over: Partial<ProjectData> = {}): ProjectData {
  return {
    path,
    title: path.replace(/\.md$/, ''),
    status: 'active',
    priority: 'medium',
    category: 'web-apps',
    lastModified: Date.now(),
    ...over,
  } as ProjectData;
}

function presence(over: Partial<AgentPresence> = {}): AgentPresence {
  return {
    id: 's1',
    name: 'Claude Code',
    agentType: 'claude',
    state: 'editing',
    tool: 'Edit',
    file: 'src/a.ts',
    action: 'Edit src/a.ts',
    lastPing: Date.now(),
    sessionStart: Date.now() - 60_000,
    legacy: false,
    ...over,
  } as AgentPresence;
}

/** A view instance with only the state onFleetUpdate/updateInspector need. */
function makeOverviewView(projects: ProjectData[]) {
  const view = Object.create(HypernovumView.prototype) as Record<string, unknown>;
  const panel = new FakeEl('div', { cls: 'hypernovum-project-inspector' });

  view.inspectorPanel = panel;
  view.inspectorSignature = '';
  view.allProjects = projects;
  view.filteredProjects = projects;
  view.projects = projects;
  view.fleetSessions = [];
  view.warnings = [];
  view.conflicts = [];
  view.conflictProjects = [];
  view.structuralEdges = [];
  view.degradedCount = 0;
  view.lastConflictRun = 0;
  view.lastAgentSig = '';
  view.visualLayer = 'status';
  view.vaultFallback = false;
  view.traceResult = null;
  view.attentionBadge = null;
  view.searchQuery = '';
  view.agentRegistry = new AgentRegistry(() => projects[0]?.path ?? null);
  // Nothing selected — the overview branch.
  view.interactionStore = { getState: () => ({ selectedPath: null }) };
  view.sceneManager = {
    updateAgentPresence: () => {},
    setConflicts: () => {},
    setAttentionLens: () => {},
    showLinkArcs: () => {},
    setEdgeVisibleTypes: () => {},
  };
  view.refreshEdges = () => {};
  view.updateConnectedPaths = () => {};
  view.updateAttentionBadge = () => {};
  return { view: view as unknown as { [k: string]: unknown }, panel };
}

type FleetUpdate = { onFleetUpdate(agents: AgentPresence[]): void };
type Inspector = { updateInspector(force?: boolean): void };

describe('city overview fleet summary (AGT-009 regression)', () => {
  it('a fleet update renders the fleet summary while nothing is selected', () => {
    const projects = [proj('app.md')];
    const { view, panel } = makeOverviewView(projects);

    // Boot order in the real view: the overview renders once from applyView()
    // BEFORE the first fleet poll arrives.
    (view as unknown as Inspector).updateInspector();
    expect(panel.findAll('fleet-summary')).toHaveLength(0);

    // First fleet poll lands with nothing selected.
    (view as unknown as FleetUpdate).onFleetUpdate([presence()]);

    const summary = panel.findAll('fleet-summary');
    expect(summary).toHaveLength(1);
    expect(summary[0].text).toBe('1 active · 0 waiting · 0 conflicts');
  });

  it('a session state change re-renders the overview summary', () => {
    const projects = [proj('app.md')];
    const { view, panel } = makeOverviewView(projects);
    (view as unknown as Inspector).updateInspector();

    const now = Date.now();
    (view as unknown as FleetUpdate).onFleetUpdate([presence({ lastPing: now })]);
    expect(panel.findAll('fleet-summary')[0].text).toBe('1 active · 0 waiting · 0 conflicts');

    // Same session, but pings stopped 30s ago → §10 age ladder puts it in
    // 'waiting'; the overview must follow without any selection happening.
    (view as unknown as FleetUpdate).onFleetUpdate([presence({ lastPing: now - 30_000 })]);
    expect(panel.findAll('fleet-summary')[0].text).toBe('0 active · 1 waiting · 0 conflicts');
  });

  it('agent-derived warnings reach the overview Attention list', () => {
    const projects = [proj('app.md')];
    const { view, panel } = makeOverviewView(projects);
    (view as unknown as Inspector).updateInspector();
    expect(panel.findAll('warning-row')).toHaveLength(0);

    // A waiting agent is a §11 warning — it must appear without a selection.
    (view as unknown as FleetUpdate).onFleetUpdate([
      presence({ lastPing: Date.now() - 30_000 }),
    ]);
    const rows = panel.findAll('warning-row');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('a re-ping with no displayed change does NOT rebuild the panel', () => {
    const projects = [proj('app.md')];
    const { view, panel } = makeOverviewView(projects);
    (view as unknown as Inspector).updateInspector();

    const now = Date.now();
    (view as unknown as FleetUpdate).onFleetUpdate([presence({ lastPing: now })]);
    const firstRender = panel.findAll('fleet-summary')[0];

    // Heartbeat re-ping: same session, same state, fresher lastPing. The panel
    // must not be torn down (that churn drops clicks and text selection).
    (view as unknown as FleetUpdate).onFleetUpdate([presence({ lastPing: now + 4000 })]);
    expect(panel.findAll('fleet-summary')[0]).toBe(firstRender);
  });
});
