import { describe, it, expect } from 'vitest';
import {
  buildManifestIndex,
  matchManifestDeps,
  resolveProjectRef,
} from '../src/monitors/dependencyMatch';

const index = buildManifestIndex([
  { path: 'app.md', name: '@acme/app', projectDir: 'C:/repos/app' },
  { path: 'lib.md', name: '@acme/lib', projectDir: 'C:/repos/lib' },
  { path: 'ui.md', name: 'ui-kit', projectDir: 'C:/repos/ui-kit' },
]);

describe('matchManifestDeps (§12)', () => {
  it('matches a sibling by package name', () => {
    expect(matchManifestDeps({ '@acme/lib': '^1.0.0', react: '^18' }, index, 'app.md')).toEqual(['lib.md']);
  });

  it('ignores external packages absent from the index', () => {
    expect(matchManifestDeps({ react: '^18', three: '^0.160' }, index, 'app.md')).toEqual([]);
  });

  it('matches file:/link: specs by directory basename', () => {
    expect(matchManifestDeps({ '@acme/lib': 'file:../lib' }, index, 'app.md')).toEqual(['lib.md']);
    expect(matchManifestDeps({ x: 'link:../ui-kit' }, index, 'app.md')).toEqual(['ui.md']);
  });

  it('matches workspace:* by package name', () => {
    expect(matchManifestDeps({ 'ui-kit': 'workspace:*' }, index, 'app.md')).toEqual(['ui.md']);
  });

  it('never returns a self-dependency', () => {
    expect(matchManifestDeps({ '@acme/app': '^1.0.0' }, index, 'app.md')).toEqual([]);
  });

  it('dedupes when a sibling is referenced twice', () => {
    expect(matchManifestDeps({ '@acme/lib': '^1', dup: 'file:../lib' }, index, 'app.md')).toEqual(['lib.md']);
  });
});

describe('resolveProjectRef (frontmatter depends_on / blocked_by)', () => {
  const projects = [
    { path: 'Projects/App.md', title: 'App' },
    { path: 'Projects/Core Lib.md', title: 'Core Lib' },
  ];

  it('resolves wikilinks and plain titles (case-insensitive)', () => {
    expect(resolveProjectRef('[[Core Lib]]', projects)).toBe('Projects/Core Lib.md');
    expect(resolveProjectRef('core lib', projects)).toBe('Projects/Core Lib.md');
  });

  it('resolves an exact note path', () => {
    expect(resolveProjectRef('Projects/App.md', projects)).toBe('Projects/App.md');
    expect(resolveProjectRef('Projects/App', projects)).toBe('Projects/App.md');
  });

  it('returns null for unknown refs', () => {
    expect(resolveProjectRef('[[Ghost]]', projects)).toBeNull();
    expect(resolveProjectRef('', projects)).toBeNull();
  });
});
