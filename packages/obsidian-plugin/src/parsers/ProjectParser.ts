import { App, TFile } from 'obsidian';
import type { HypernovumSettings, ProjectData } from '@hypernovum/core';

export class ProjectParser {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Parse vault files to extract project metadata.
   * Detection strategy: looks for frontmatter fields that mark a note as a project.
   */
  async parseProjects(settings: HypernovumSettings): Promise<ProjectData[]> {
    const projects: ProjectData[] = [];
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      const project = await this.tryParseProject(file, settings);
      if (project) {
        projects.push(project);
      }
    }

    return projects;
  }

  /**
   * Whole-vault projection, used only when the vault contains no project notes
   * at all. A fresh install otherwise opens on an empty city, which reads as
   * "broken" rather than "nothing tagged yet".
   *
   * Every note becomes a building and its top-level folder becomes a district.
   * The encodings that can still be honest are kept and the rest are left
   * alone rather than faked:
   *   - height  = incoming links, so hub notes tower (the closest honest
   *               analogue of priority for an untagged note)
   *   - windows = real checkbox tasks, exactly as for a project note
   *   - decay   = mtime, so stale corners of the vault dim on their own
   *   - status  stays 'active' for everything. Age is already carried by decay
   *             and the recency lens; colouring old notes 'complete' would be
   *             inventing a claim the note never made.
   * No `projectDir`, so nothing here gets Git signals or an agent launch —
   * these are notes, not projects, and the inspector should say so.
   */
  async parseVaultAsCity(settings: HypernovumSettings): Promise<ProjectData[]> {
    const files = this.app.vault.getMarkdownFiles();
    const incoming = this.countIncomingLinks();
    const projects: ProjectData[] = [];

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
      const taskData = await this.parseTasks(fm, file);
      const links = incoming.get(file.path) ?? 0;

      projects.push({
        path: file.path,
        title: file.basename,
        status: 'active',
        priority: this.priorityFromLinks(links),
        stage: 'active',
        category: this.districtForFile(file),
        scope: Math.max(1, Math.round(file.stat.size / 400)),
        lastModified: file.stat.mtime,
        recentActivity: this.isRecentlyActive(file.stat.mtime),
        health: 80,
        noteCount: 1,
        ...taskData,
      });
    }

    return projects;
  }

  /** Top-level folder as the district; root notes group under 'vault'. */
  private districtForFile(file: TFile): string {
    const parts = file.path.split('/');
    return parts.length > 1 ? parts[0] : 'vault';
  }

  /**
   * Incoming link count per note. `resolvedLinks` is source→target→count, so it
   * has to be inverted; `getBacklinksForFile` is not part of the public API.
   */
  private countIncomingLinks(): Map<string, number> {
    const incoming = new Map<string, number>();
    const resolved = this.app.metadataCache.resolvedLinks ?? {};
    for (const targets of Object.values(resolved)) {
      for (const [target, count] of Object.entries(targets)) {
        incoming.set(target, (incoming.get(target) ?? 0) + count);
      }
    }
    return incoming;
  }

  private priorityFromLinks(links: number): string {
    if (links >= 7) return 'critical';
    if (links >= 3) return 'high';
    if (links >= 1) return 'medium';
    return 'low';
  }

  private async tryParseProject(
    file: TFile,
    settings: HypernovumSettings,
  ): Promise<ProjectData | null> {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache?.frontmatter) return null;

    const fm = cache.frontmatter;

    // Check if this note is tagged as a project
    const projectTag = settings.projectTag || 'project';
    const tags: string[] = fm.tags ?? [];
    const hasProjectTag =
      tags.includes(projectTag) ||
      tags.includes(`#${projectTag}`) ||
      fm.type === 'project';

    if (!hasProjectTag) return null;

    // Parse task data from frontmatter or checkbox fallback
    const taskData = await this.parseTasks(fm, file);

    // Extract project metadata from frontmatter
    return {
      path: file.path,
      title: fm.title ?? file.basename,
      status: this.normalizeStatus(fm.status),
      priority: this.normalizePriority(fm.priority),
      stage: this.normalizeStage(fm.stage ?? fm.status),
      category: fm.category ?? fm.domain ?? 'uncategorized',
      scope: this.calculateScope(fm, file),
      lastModified: file.stat.mtime,
      recentActivity: this.isRecentlyActive(file.stat.mtime),
      health: this.calculateHealth(fm),
      noteCount: fm.noteCount ?? 1,
      ...taskData,
      stack: this.parseStack(fm.stack),
      questions: this.parseQuestions(fm.questions ?? fm.quests),
      answeredQuestions: this.parseQuestions(fm.answered ?? fm.quests_done),
      projectDir: typeof fm.projectDir === 'string' ? fm.projectDir : undefined,
      // Typed-graph frontmatter (Phase 4). parseQuestions normalizes string|array.
      blockedBy: this.parseQuestions(fm.blocked_by ?? fm.blockedBy),
      dependsOn: this.parseQuestions(fm.depends_on ?? fm.dependsOn),
      noDeps: fm.no_deps === true || fm.noDeps === true,
    };
  }

  private parseQuestions(raw: unknown): string[] | undefined {
    if (Array.isArray(raw)) {
      const questions = raw.map(String).map((s) => s.trim()).filter((s) => s.length > 0);
      return questions.length > 0 ? questions : undefined;
    }
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return [raw.trim()];
    }
    return undefined;
  }

  private normalizeStatus(raw: string | undefined): string {
    if (!raw) return 'active';
    const lower = raw.toLowerCase().trim();
    const map: Record<string, string> = {
      active: 'active',
      'in-progress': 'active',
      'in progress': 'active',
      blocked: 'blocked',
      stalled: 'blocked',
      paused: 'paused',
      'on-hold': 'paused',
      'on hold': 'paused',
      complete: 'complete',
      done: 'complete',
      completed: 'complete',
    };
    return map[lower] ?? 'active';
  }

  private normalizePriority(raw: string | undefined): string {
    if (!raw) return 'medium';
    const lower = raw.toLowerCase().trim();
    const map: Record<string, string> = {
      critical: 'critical',
      urgent: 'critical',
      high: 'high',
      medium: 'medium',
      normal: 'medium',
      low: 'low',
    };
    return map[lower] ?? 'medium';
  }

  private normalizeStage(raw: string | undefined): string {
    if (!raw) return 'active';
    const lower = raw.toLowerCase().trim();
    const map: Record<string, string> = {
      backlog: 'backlog',
      planning: 'backlog',
      active: 'active',
      'in-progress': 'active',
      'in progress': 'active',
      paused: 'paused',
      'on-hold': 'paused',
      complete: 'complete',
      done: 'complete',
      archived: 'complete',
    };
    return map[lower] ?? 'active';
  }

  private calculateScope(
    fm: Record<string, unknown>,
    file: TFile,
  ): number {
    // Use explicit scope if provided, otherwise estimate from note count or file size
    if (typeof fm.scope === 'number') return fm.scope;
    if (typeof fm.noteCount === 'number') return fm.noteCount;
    return Math.max(1, Math.ceil(file.stat.size / 1000));
  }

  private isRecentlyActive(mtime: number): boolean {
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    return Date.now() - mtime < sevenDaysMs;
  }

  private calculateHealth(fm: Record<string, unknown>): number {
    if (typeof fm.health === 'number') return fm.health;
    // Default health based on status
    const statusHealth: Record<string, number> = {
      active: 80,
      blocked: 30,
      paused: 50,
      complete: 100,
    };
    return statusHealth[String(fm.status ?? 'active').toLowerCase()] ?? 60;
  }

  private async parseTasks(
    fm: Record<string, unknown>,
    file: TFile,
  ): Promise<{ totalTasks?: number; completedTasks?: number }> {
    // Priority: frontmatter fields
    if (typeof fm.tasks === 'number' && fm.tasks > 0) {
      return {
        totalTasks: fm.tasks,
        completedTasks: typeof fm.tasks_done === 'number' ? fm.tasks_done : 0,
      };
    }

    // Fallback: count checkboxes in file content
    try {
      const content = await this.app.vault.cachedRead(file);
      const completedPattern = /- \[[xX]\]/g;
      const incompletePattern = /- \[ \]/g;

      const completed = (content.match(completedPattern) || []).length;
      const incomplete = (content.match(incompletePattern) || []).length;
      const total = completed + incomplete;

      if (total > 0) {
        return { totalTasks: total, completedTasks: completed };
      }
    } catch {
      // Silently fail — leave tasks undefined
    }

    return {};
  }

  private parseStack(raw: unknown): string[] | undefined {
    if (Array.isArray(raw)) {
      return raw.map(String).filter(s => s.length > 0);
    }
    if (typeof raw === 'string') {
      return raw.split(',').map(s => s.trim()).filter(s => s.length > 0);
    }
    return undefined;
  }
}
