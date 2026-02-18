import * as fs from 'fs';
import * as path from 'path';
import type { ProjectData } from '@hypervault/core';
import { findProjectRoots, type DetectionResult } from './detector';
import { analyzeStack } from './stack-analyzer';
import { collectWeather } from './git-weather';

export interface ScanOptions {
  /** Root directory to scan, e.g. "C:\Users\me\Code" or "~/projects" */
  rootDir: string;
  /** Maximum recursion depth (default 3) */
  maxDepth?: number;
  /** Additional directories to skip during traversal */
  ignoreDirs?: string[];
  /** Whether to count TODOs in source files (slower, default false) */
  countTodos?: boolean;
}

export interface ScanResult {
  projects: ProjectData[];
  scanDuration: number;    // ms
  errors: string[];        // non-fatal warnings
}

/** .hypervault.json override file schema */
interface HypervaultOverride {
  title?: string;
  status?: string;
  priority?: string;
  category?: string;
  stage?: string;
  stack?: string[];
}

/**
 * Discovery Scanner: crawls a filesystem directory and automatically
 * detects projects by their structure, generating ProjectData[] without
 * any manual metadata entry.
 */
export class DiscoveryScanner {
  /**
   * Scan a directory tree for projects.
   */
  async scan(options: ScanOptions): Promise<ScanResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const maxDepth = options.maxDepth ?? 3;

    // Find all project roots
    const detections = findProjectRoots(
      options.rootDir,
      maxDepth,
      options.ignoreDirs,
    );

    // Generate ProjectData for each detection
    const projects: ProjectData[] = [];

    for (const detection of detections) {
      try {
        const project = await this.buildProjectData(
          detection,
          options.rootDir,
          options.countTodos ?? false,
        );
        if (project) {
          projects.push(project);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Error scanning ${detection.projectDir}: ${message}`);
      }
    }

    return {
      projects,
      scanDuration: Date.now() - startTime,
      errors,
    };
  }

  /**
   * Scan a single known project directory.
   */
  async scanSingle(projectDir: string): Promise<ProjectData | null> {
    const detection: DetectionResult = {
      isProject: true,
      projectDir,
      signals: [],
    };

    return this.buildProjectData(detection, path.dirname(projectDir), false);
  }

  /**
   * Build a ProjectData object from a detected project.
   */
  private async buildProjectData(
    detection: DetectionResult,
    rootDir: string,
    countTodos: boolean,
  ): Promise<ProjectData | null> {
    const dir = detection.projectDir;

    // Read .hypervault.json override if present
    const override = this.readOverride(dir);

    // Detect tech stack
    const autoStack = analyzeStack(dir);
    const stack = override?.stack ?? (autoStack.length > 0 ? autoStack : undefined);

    // Determine category from detection signals or stack
    const category = override?.category ?? this.inferCategory(detection, autoStack);

    // Get git weather for status/activity info
    const weather = await collectWeather(dir);

    // Derive status from git state
    const status = override?.status ?? this.inferStatus(weather);

    // Last modified: git or filesystem
    const lastModified = weather?.lastCommitDate || this.getLastModified(dir);

    // Recent activity
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const recentActivity = (Date.now() - lastModified) < sevenDaysMs;

    // File count (non-ignored source files)
    const fileCount = this.countSourceFiles(dir);

    // Title: package name → folder name
    const title = override?.title ?? this.getProjectTitle(dir);

    // Health defaults by status
    const healthMap: Record<string, number> = {
      active: 80, blocked: 30, paused: 50, complete: 100,
    };

    // TODO counting (optional, can be slow)
    let totalTasks: number | undefined;
    if (countTodos) {
      totalTasks = this.countTodos(dir);
    }

    return {
      path: path.relative(rootDir, dir) || path.basename(dir),
      title,
      status,
      priority: override?.priority ?? 'medium',
      stage: override?.stage ?? (status === 'complete' ? 'complete' : 'active'),
      category,
      scope: Math.min(fileCount, 500),
      lastModified,
      recentActivity,
      health: healthMap[status] ?? 60,
      noteCount: fileCount,
      totalTasks,
      completedTasks: totalTasks !== undefined ? 0 : undefined,
      stack,
      projectDir: dir,
    };
  }

  /**
   * Read and parse .hypervault.json override file.
   */
  private readOverride(dir: string): HypervaultOverride | null {
    try {
      const filePath = path.join(dir, '.hypervault.json');
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content) as HypervaultOverride;
    } catch {
      return null;
    }
  }

  /**
   * Infer project category from detection signals and tech stack.
   */
  private inferCategory(detection: DetectionResult, stack: string[]): string {
    // Check detection signal hints first
    for (const signal of detection.signals) {
      if (signal.categoryHint) {
        // Refine web-apps hint based on stack
        if (signal.categoryHint === 'web-apps') {
          if (stack.includes('Obsidian')) return 'obsidian-plugins';
          if (stack.includes('Electron') || stack.includes('Tauri')) return 'web-apps';
        }
        return signal.categoryHint;
      }
    }

    // Infer from stack
    if (stack.includes('Obsidian')) return 'obsidian-plugins';
    if (stack.some(s => ['React', 'Vue', 'Svelte', 'Angular', 'Next.js', 'Nuxt', 'SvelteKit', 'Astro'].includes(s))) {
      return 'web-apps';
    }
    if (stack.some(s => ['PyTorch', 'TensorFlow', 'NumPy', 'Pandas', 'Matplotlib', 'D3', 'Plotly', 'Three.js'].includes(s))) {
      return 'visualization';
    }
    if (stack.some(s => ['Rust', 'Go', 'Java', 'Kotlin'].includes(s))) {
      return 'infrastructure';
    }

    return 'uncategorized';
  }

  /**
   * Infer project status from git weather data.
   */
  private inferStatus(weather: ReturnType<typeof collectWeather> extends Promise<infer T> ? T : never): string {
    if (!weather) return 'active'; // No git → assume active

    const daysSinceCommit = weather.lastCommitDate
      ? (Date.now() - weather.lastCommitDate) / (1000 * 60 * 60 * 24)
      : Infinity;

    if (weather.hasMergeConflicts) return 'blocked';
    if (daysSinceCommit > 30) return 'paused';
    if (weather.hasUncommittedChanges || daysSinceCommit < 7) return 'active';
    return 'active';
  }

  /**
   * Get the project title from package.json name or folder name.
   */
  private getProjectTitle(dir: string): string {
    try {
      const pkgPath = path.join(dir, 'package.json');
      const content = fs.readFileSync(pkgPath, 'utf8');
      const pkg = JSON.parse(content);
      if (pkg.name && typeof pkg.name === 'string') {
        // Strip scope prefix (@org/name → name)
        return pkg.name.replace(/^@[^/]+\//, '');
      }
    } catch { /* no package.json */ }

    try {
      const cargoPath = path.join(dir, 'Cargo.toml');
      const content = fs.readFileSync(cargoPath, 'utf8');
      const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
      if (nameMatch) return nameMatch[1];
    } catch { /* no Cargo.toml */ }

    return path.basename(dir);
  }

  /**
   * Get the most recent modification time of files in a directory.
   */
  private getLastModified(dir: string): number {
    try {
      const stat = fs.statSync(dir);
      return stat.mtimeMs;
    } catch {
      return Date.now();
    }
  }

  /**
   * Count source files in a directory (non-recursing into ignored dirs).
   */
  private countSourceFiles(dir: string, maxCount: number = 500): number {
    let count = 0;
    const ignoreDirs = new Set([
      'node_modules', '.git', 'dist', 'build', 'vendor',
      '__pycache__', '.venv', 'venv', 'target', '.next',
    ]);

    const walk = (currentDir: string, depth: number) => {
      if (count >= maxCount || depth > 5) return;

      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (count >= maxCount) return;

          if (entry.isFile()) {
            count++;
          } else if (entry.isDirectory() && !ignoreDirs.has(entry.name) && !entry.name.startsWith('.')) {
            walk(path.join(currentDir, entry.name), depth + 1);
          }
        }
      } catch { /* permission denied */ }
    };

    walk(dir, 0);
    return count;
  }

  /**
   * Count TODO/FIXME/HACK comments in source files.
   * This is optional and can be slow for large projects.
   */
  private countTodos(dir: string): number {
    let count = 0;
    const sourceExtensions = new Set([
      '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go',
      '.java', '.kt', '.cs', '.cpp', '.c', '.h', '.rb',
    ]);
    const ignoreDirs = new Set([
      'node_modules', '.git', 'dist', 'build', 'vendor',
      '__pycache__', '.venv', 'target',
    ]);
    const todoPattern = /\b(TODO|FIXME|HACK)\b/g;

    const walk = (currentDir: string, depth: number) => {
      if (depth > 5) return;

      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (sourceExtensions.has(ext)) {
              try {
                const content = fs.readFileSync(path.join(currentDir, entry.name), 'utf8');
                const matches = content.match(todoPattern);
                if (matches) count += matches.length;
              } catch { /* skip unreadable files */ }
            }
          } else if (entry.isDirectory() && !ignoreDirs.has(entry.name) && !entry.name.startsWith('.')) {
            walk(path.join(currentDir, entry.name), depth + 1);
          }
        }
      } catch { /* permission denied */ }
    };

    walk(dir, 0);
    return count;
  }
}
