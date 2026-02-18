import * as fs from 'fs';
import * as path from 'path';

/** Signals that indicate a directory is a project root */
export interface DetectionSignal {
  /** File or directory name that triggered detection */
  trigger: string;
  /** How confident we are this is a project */
  confidence: 'high' | 'override';
  /** Hint for project category */
  categoryHint?: string;
}

/** Result of detecting whether a directory is a project root */
export interface DetectionResult {
  isProject: boolean;
  projectDir: string;
  signals: DetectionSignal[];
}

/** Detection rules: file/dir name → signal info */
const DETECTION_RULES: Array<{
  name: string;
  isDir?: boolean;
  confidence: 'high' | 'override';
  categoryHint?: string;
}> = [
  // Override — user-defined metadata takes precedence
  { name: '.hypervault.json', confidence: 'override' },

  // Version control
  { name: '.git', isDir: true, confidence: 'high' },

  // JavaScript/TypeScript ecosystem
  { name: 'package.json', confidence: 'high', categoryHint: 'web-apps' },

  // Rust
  { name: 'Cargo.toml', confidence: 'high', categoryHint: 'infrastructure' },

  // Python
  { name: 'pyproject.toml', confidence: 'high', categoryHint: 'infrastructure' },
  { name: 'setup.py', confidence: 'high', categoryHint: 'infrastructure' },

  // Go
  { name: 'go.mod', confidence: 'high', categoryHint: 'infrastructure' },

  // Java/Kotlin
  { name: 'pom.xml', confidence: 'high', categoryHint: 'infrastructure' },
  { name: 'build.gradle', confidence: 'high', categoryHint: 'infrastructure' },

  // .NET
  // Handled separately via glob for *.sln / *.csproj
];

/** Directories to never recurse into */
const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'vendor',
  '__pycache__', '.venv', 'venv', '.tox', 'target',
  '.next', '.nuxt', '.output', 'out', '.cache',
  'coverage', '.nyc_output',
]);

/**
 * Detect whether a directory is a project root.
 * Checks for known project signals (config files, .git, etc.)
 */
export function detectProject(dirPath: string): DetectionResult {
  const signals: DetectionSignal[] = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const entryNames = new Set(entries.map(e => e.name));

    // Check standard rules
    for (const rule of DETECTION_RULES) {
      if (entryNames.has(rule.name)) {
        const fullPath = path.join(dirPath, rule.name);
        const stat = fs.statSync(fullPath);

        if (rule.isDir && !stat.isDirectory()) continue;
        if (!rule.isDir && !stat.isFile()) continue;

        signals.push({
          trigger: rule.name,
          confidence: rule.confidence,
          categoryHint: rule.categoryHint,
        });
      }
    }

    // Check for .NET projects (*.sln, *.csproj)
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.sln') || entry.name.endsWith('.csproj'))) {
        signals.push({
          trigger: entry.name,
          confidence: 'high',
          categoryHint: 'infrastructure',
        });
        break; // One .NET signal is enough
      }
    }
  } catch {
    // Permission denied or other FS error — not a project
    return { isProject: false, projectDir: dirPath, signals: [] };
  }

  return {
    isProject: signals.length > 0,
    projectDir: dirPath,
    signals,
  };
}

/**
 * Check if a directory name should be skipped during traversal.
 */
export function shouldIgnoreDir(dirName: string, customIgnore?: string[]): boolean {
  if (DEFAULT_IGNORE_DIRS.has(dirName)) return true;
  if (dirName.startsWith('.') && dirName !== '.git') return true;
  if (customIgnore?.includes(dirName)) return true;
  return false;
}

/**
 * Walk directories breadth-first, finding all project roots.
 * Stops recursing into a directory once it's identified as a project root.
 */
export function findProjectRoots(
  rootDir: string,
  maxDepth: number = 3,
  ignoreDirs?: string[],
): DetectionResult[] {
  const results: DetectionResult[] = [];

  interface QueueItem {
    dirPath: string;
    depth: number;
  }

  const queue: QueueItem[] = [{ dirPath: rootDir, depth: 0 }];

  while (queue.length > 0) {
    const item = queue.shift()!;

    if (item.depth > maxDepth) continue;

    const detection = detectProject(item.dirPath);

    if (detection.isProject) {
      results.push(detection);
      // Don't recurse into project roots (avoid sub-projects in monorepos)
      continue;
    }

    // Not a project — recurse into subdirectories
    try {
      const entries = fs.readdirSync(item.dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (shouldIgnoreDir(entry.name, ignoreDirs)) continue;

        queue.push({
          dirPath: path.join(item.dirPath, entry.name),
          depth: item.depth + 1,
        });
      }
    } catch {
      // Permission denied — skip
    }
  }

  return results;
}
