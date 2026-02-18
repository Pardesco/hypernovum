import * as fs from 'fs';
import * as path from 'path';
import type { ProjectData } from '@hypervault/core';

/**
 * Parses project notes from an Obsidian vault's `projects/` folder.
 * Reads YAML frontmatter without Obsidian API — just plain file I/O.
 */
export class VaultParser {
  /**
   * Find the Obsidian vault root by looking for a `.obsidian` directory
   * in the given directory or its ancestors.
   */
  /**
   * Find all Obsidian vaults that contain a `projects/` folder.
   * Searches: the directory itself, immediate children, and ancestors.
   */
  static findVaultRoots(startDir: string): string[] {
    const resolved = path.resolve(startDir);
    const found: string[] = [];

    const isVaultWithProjects = (dir: string): boolean =>
      fs.existsSync(path.join(dir, '.obsidian')) &&
      fs.existsSync(path.join(dir, 'projects'));

    // Check the directory itself
    if (isVaultWithProjects(resolved)) {
      found.push(resolved);
    }

    // Check immediate children (scan dir might be parent of vault)
    try {
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const childDir = path.join(resolved, entry.name);
        if (isVaultWithProjects(childDir)) {
          found.push(childDir);
        }
      }
    } catch { /* not readable */ }

    // Check ancestors
    let dir = resolved;
    for (let i = 0; i < 5; i++) {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
      if (isVaultWithProjects(dir) && !found.includes(dir)) {
        found.push(dir);
      }
    }

    return found;
  }

  /**
   * Parse all project notes from a vault's `projects/` folder.
   */
  static parseVault(vaultRoot: string): ProjectData[] {
    const projectsDir = path.join(vaultRoot, 'projects');
    if (!fs.existsSync(projectsDir)) return [];

    const projects: ProjectData[] = [];

    try {
      const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

        try {
          const filePath = path.join(projectsDir, entry.name);
          const content = fs.readFileSync(filePath, 'utf8');
          const project = VaultParser.parseFrontmatter(content, filePath);
          if (project) projects.push(project);
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // projects/ not readable
    }

    return projects;
  }

  /**
   * Extract YAML frontmatter from a markdown file and build ProjectData.
   */
  private static parseFrontmatter(content: string, filePath: string): ProjectData | null {
    // Match YAML frontmatter between --- delimiters
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return null;

    const yaml = match[1];
    const fm = VaultParser.parseSimpleYaml(yaml);

    // Must be marked as a project
    const isProject =
      fm.type === 'project' ||
      (fm.tags && fm.tags.includes('project'));

    if (!isProject) return null;

    const stat = fs.statSync(filePath);
    const basename = path.basename(filePath, '.md');

    return {
      path: filePath,
      title: fm.title || basename,
      status: fm.status || 'active',
      priority: fm.priority || 'medium',
      stage: fm.stage || fm.status || 'active',
      category: fm.category || fm.domain || 'uncategorized',
      scope: parseInt(fm.scope, 10) || 1,
      lastModified: stat.mtimeMs,
      recentActivity: (Date.now() - stat.mtimeMs) < 7 * 24 * 60 * 60 * 1000,
      health: parseInt(fm.health, 10) || 60,
      noteCount: parseInt(fm.noteCount, 10) || 1,
      stack: fm.stack ? VaultParser.parseArray(fm.stack) : undefined,
      projectDir: fm.projectDir || undefined,
    };
  }

  /**
   * Minimal YAML parser for flat frontmatter (no nested objects).
   * Handles: strings, numbers, and arrays in [a, b, c] format.
   */
  private static parseSimpleYaml(yaml: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of yaml.split('\n')) {
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match) {
        result[match[1]] = match[2].trim();
      }
    }
    return result;
  }

  /**
   * Parse a YAML inline array like "[TypeScript, Three.js, Zustand]" into string[].
   */
  private static parseArray(raw: string): string[] {
    // Strip brackets and split by comma
    const inner = raw.replace(/^\[/, '').replace(/\]$/, '');
    return inner.split(',').map(s => s.trim()).filter(s => s.length > 0);
  }
}
