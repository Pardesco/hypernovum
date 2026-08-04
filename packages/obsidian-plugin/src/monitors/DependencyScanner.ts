import { existsSync, statSync, readFileSync } from 'fs';
import * as path from 'path';
import {
  buildManifestIndex,
  matchManifestDeps,
  resolveProjectRef,
  type DependencyScanResult,
  type ManifestIndexEntry,
} from './dependencyMatch';
import { asString, parseJsonObject, recordAt, type Json } from '../utils/json';

/** Keep only the string-valued entries of a parsed object. */
function stringMap(source: Json): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

export interface DependencyScanInput {
  path: string;                    // project note path
  title: string;
  projectDir: string;             // resolved working directory
  dependsOn?: string[];           // explicit frontmatter depends_on refs
  noDeps?: boolean;               // frontmatter no_deps: true → skip manifest scan
}

interface CachedManifest {
  mtime: number;
  name?: string;
  deps: Record<string, string>;
}

interface ReadManifest {
  manifestPath: string | null;
  mtime: number | null;
  name?: string;
  deps: Record<string, string>;
  error?: string;
}

/**
 * Scans project package.json manifests + frontmatter depends_on for
 * dependencies on sibling projects (EDG-004, §12). Manifest reads are cached by
 * mtime; malformed/missing manifests degrade to an error string, never throw.
 */
export class DependencyScanner {
  private cache = new Map<string, CachedManifest>(); // keyed by manifest path

  scan(inputs: DependencyScanInput[]): Map<string, DependencyScanResult> {
    // Pass 1 — read manifests (mtime-cached) and collect index entries.
    const manifests = new Map<string, ReadManifest>();
    for (const inp of inputs) manifests.set(inp.path, this.readManifest(inp));

    const entries: ManifestIndexEntry[] = inputs.map((inp) => ({
      path: inp.path, name: manifests.get(inp.path)?.name, projectDir: inp.projectDir,
    }));
    const index = buildManifestIndex(entries);
    const projectsForRef = inputs.map((i) => ({ path: i.path, title: i.title }));

    // Pass 2 — resolve each project's dependencies against the index.
    const results = new Map<string, DependencyScanResult>();
    for (const inp of inputs) {
      const m = manifests.get(inp.path)!;
      const errors = m.error ? [m.error] : [];
      const dependsOn: { targetPath: string; via: 'manifest' | 'frontmatter' }[] = [];

      if (!inp.noDeps && m.manifestPath) {
        for (const t of matchManifestDeps(m.deps, index, inp.path)) {
          dependsOn.push({ targetPath: t, via: 'manifest' });
        }
      }
      for (const ref of inp.dependsOn ?? []) {
        const t = resolveProjectRef(ref, projectsForRef);
        if (t && t !== inp.path && !dependsOn.some((d) => d.targetPath === t)) {
          dependsOn.push({ targetPath: t, via: 'frontmatter' });
        }
      }

      results.set(inp.path, {
        projectPath: inp.path, manifest: m.manifestPath, manifestMtime: m.mtime, dependsOn, errors,
      });
    }
    return results;
  }

  private readManifest(inp: DependencyScanInput): ReadManifest {
    if (!inp.projectDir) return { manifestPath: null, mtime: null, deps: {} };
    const manifestPath = path.join(inp.projectDir, 'package.json');
    if (!existsSync(manifestPath)) return { manifestPath: null, mtime: null, deps: {} };

    let mtime: number;
    try {
      mtime = statSync(manifestPath).mtimeMs;
    } catch {
      return { manifestPath: null, mtime: null, deps: {} };
    }

    const cached = this.cache.get(manifestPath);
    if (cached && cached.mtime === mtime) {
      return { manifestPath, mtime, name: cached.name, deps: cached.deps };
    }

    try {
      const json = parseJsonObject(readFileSync(manifestPath, 'utf8'));
      if (!json) return { manifestPath, mtime, deps: {}, error: `Unreadable manifest: ${manifestPath}` };
      // A manifest's dep maps are string→string by spec; anything else in there
      // is not a dependency we could match against a sibling project anyway.
      const deps = stringMap({ ...recordAt(json, 'dependencies'), ...recordAt(json, 'devDependencies') });
      const name = asString(json.name);
      this.cache.set(manifestPath, { mtime, name, deps });
      return { manifestPath, mtime, name, deps };
    } catch {
      return { manifestPath, mtime, deps: {}, error: `Unreadable manifest: ${manifestPath}` };
    }
  }
}
