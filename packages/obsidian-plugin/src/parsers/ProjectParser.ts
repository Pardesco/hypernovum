import { App, TFile, TFolder } from 'obsidian';
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
      projectDir: typeof fm.projectDir === 'string' ? fm.projectDir : undefined,
    };
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
