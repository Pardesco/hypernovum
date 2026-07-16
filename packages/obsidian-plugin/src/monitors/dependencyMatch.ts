/**
 * Pure dependency-matching logic (EDG-004, §12). No fs / obsidian imports, so
 * it is unit-testable. The DependencyScanner class handles the file reads and
 * caching and calls into these helpers.
 */

export interface DependencyScanResult {
  projectPath: string;
  manifest: string | null;         // absolute manifest path, if found
  manifestMtime: number | null;    // cache key
  dependsOn: { targetPath: string; via: 'manifest' | 'frontmatter' }[];
  errors: string[];
}

export interface ManifestIndexEntry {
  path: string;                    // project note path
  name?: string;                   // package.json "name", if any
  projectDir?: string;             // resolved working directory
}

export interface ManifestIndex {
  byName: Map<string, string>;     // package name → project path
  byDir: Map<string, string>;      // projectDir basename (lowercased) → project path
}

function dirBasename(dir: string): string {
  return dir.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop()?.toLowerCase() ?? '';
}

/** Build lookup indexes once per scan. */
export function buildManifestIndex(entries: ManifestIndexEntry[]): ManifestIndex {
  const byName = new Map<string, string>();
  const byDir = new Map<string, string>();
  for (const e of entries) {
    if (e.name) byName.set(e.name, e.path);
    if (e.projectDir) {
      const base = dirBasename(e.projectDir);
      if (base) byDir.set(base, e.path);
    }
  }
  return { byName, byDir };
}

/**
 * Match a manifest's dependencies against sibling projects. Returns the sibling
 * project paths this project depends on (externals are simply absent from the
 * index → ignored). `file:`/`link:` specs match by directory basename;
 * `workspace:*` and plain semver match by package name.
 */
export function matchManifestDeps(
  deps: Record<string, string>,
  index: ManifestIndex,
  selfPath: string,
): string[] {
  const out = new Set<string>();
  for (const [name, spec] of Object.entries(deps)) {
    let target: string | undefined;
    if (typeof spec === 'string' && (spec.startsWith('file:') || spec.startsWith('link:'))) {
      const p = spec.replace(/^(file:|link:)/, '');
      target = index.byDir.get(dirBasename(p));
    } else {
      // workspace:* and plain semver both key off the dependency's package name
      target = index.byName.get(name);
    }
    if (target && target !== selfPath) out.add(target);
  }
  return [...out];
}

/**
 * Resolve a frontmatter reference ([[Wikilink]] / plain title / note path) to a
 * project path. Case-insensitive title match, then path match. Null if unknown.
 * Shared by depends_on (EDG-004) and blocked_by (EDG-003).
 */
export function resolveProjectRef(
  ref: string,
  projects: { path: string; title: string }[],
): string | null {
  const cleaned = ref.trim().replace(/^\[\[/, '').replace(/\]\]$/, '').trim();
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();

  // Exact path (with or without .md)
  const asPath = projects.find((p) => p.path.toLowerCase() === lower || p.path.toLowerCase() === `${lower}.md`);
  if (asPath) return asPath.path;

  // Exact title
  const byTitle = projects.find((p) => p.title.toLowerCase() === lower);
  if (byTitle) return byTitle.path;

  // Basename of a path ref (e.g. "folder/Note" → "Note")
  const base = lower.split('/').pop() ?? lower;
  const byBase = projects.find((p) => p.title.toLowerCase() === base || p.path.toLowerCase().endsWith(`/${base}.md`));
  return byBase ? byBase.path : null;
}
