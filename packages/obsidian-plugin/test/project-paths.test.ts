import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { resolveProjectDir, samePath, type ProjectDirEnv } from '../src/utils/projectPaths';

const VAULT = '/vault';

/** POSIX env so these rules test identically on Windows and Linux. */
function env(dirs: string[], repos: string[] = []): ProjectDirEnv {
  const set = new Set(dirs);
  const repoSet = new Set(repos);
  return {
    vaultBase: VAULT,
    dirExists: (p) => set.has(p),
    isProjectRoot: (p) => repoSet.has(p),
    isAbsolute: path.posix.isAbsolute,
    join: (...parts) => path.posix.join(...parts),
    dirname: path.posix.dirname,
  };
}

describe('resolveProjectDir', () => {
  it('never falls back to the vault root — the old bug', () => {
    // Note at the vault root, no projectDir, no sibling folder: previously this
    // resolved to the vault itself and inherited the vault's git stats.
    const result = resolveProjectDir({ notePath: 'Thing.md' }, env([VAULT]));
    expect(result).toBeNull();
  });

  it('prefers an absolute projectDir', () => {
    const result = resolveProjectDir(
      { notePath: 'Thing.md', projectDir: '/repos/thing' },
      env([VAULT, '/repos/thing']),
    );
    expect(result).toEqual({ path: '/repos/thing', source: 'frontmatter' });
  });

  it('resolves a vault-relative projectDir', () => {
    const result = resolveProjectDir(
      { notePath: 'Thing.md', projectDir: 'code/thing' },
      env([VAULT, '/vault/code/thing']),
    );
    expect(result).toEqual({ path: '/vault/code/thing', source: 'frontmatter' });
  });

  it('returns null for an explicit projectDir that does not exist', () => {
    // A typo'd path should surface as an error, not silently fall through to a
    // plausible-looking wrong directory.
    const result = resolveProjectDir(
      { notePath: 'Thing.md', projectDir: '/repos/typo' },
      env([VAULT, '/repos/thing']),
    );
    expect(result).toBeNull();
  });

  it('finds a sibling folder named after the note', () => {
    const result = resolveProjectDir(
      { notePath: 'Apps/Thing.md' },
      env([VAULT, '/vault/Apps', '/vault/Apps/Thing']),
    );
    expect(result).toEqual({ path: '/vault/Apps/Thing', source: 'sibling-folder' });
  });

  it("uses the note's own folder when that folder is a project root", () => {
    const result = resolveProjectDir(
      { notePath: 'MyApp/notes.md' },
      env([VAULT, '/vault/MyApp'], ['/vault/MyApp']),
    );
    expect(result).toEqual({ path: '/vault/MyApp', source: 'note-parent' });
  });

  it('does NOT claim a plain notes folder shared by sibling notes', () => {
    // Projects/A.md and Projects/B.md would both have resolved to <vault>/Projects,
    // sharing one directory's Git data and pointing every folder/terminal/agent
    // action — including the .hypernovum/SETUP.md write — at the same place.
    const shared = env([VAULT, '/vault/Projects']); // no project markers
    expect(resolveProjectDir({ notePath: 'Projects/A.md' }, shared)).toBeNull();
    expect(resolveProjectDir({ notePath: 'Projects/B.md' }, shared)).toBeNull();
  });

  it('still prefers a sibling folder over the parent', () => {
    const result = resolveProjectDir(
      { notePath: 'Projects/A.md' },
      env([VAULT, '/vault/Projects', '/vault/Projects/A'], ['/vault/Projects']),
    );
    expect(result).toEqual({ path: '/vault/Projects/A', source: 'sibling-folder' });
  });

  it('ignores a sibling folder that resolves to the vault root', () => {
    // Pathological note path; must not hand back the vault.
    const result = resolveProjectDir({ notePath: '.md' }, env([VAULT]));
    expect(result).toBeNull();
  });

  it("prefers the note's own folder when it is a root, over an ancestor root", () => {
    const result = resolveProjectDir(
      { notePath: 'a/b/c/Thing.md' },
      env([VAULT, '/vault/a', '/vault/a/b', '/vault/a/b/c'], ['/vault/a', '/vault/a/b/c']),
    );
    expect(result).toEqual({ path: '/vault/a/b/c', source: 'note-parent' });
  });

  it('walks up to the nearest project root when the note folder is not one', () => {
    // Reachable now that the parent fallback requires a project marker.
    const result = resolveProjectDir(
      { notePath: 'repo/docs/Thing.md' },
      env([VAULT, '/vault/repo', '/vault/repo/docs'], ['/vault/repo']),
    );
    expect(result).toEqual({ path: '/vault/repo', source: 'git-ancestor' });
  });

  it('never returns the vault even when the vault itself is a project root', () => {
    expect(resolveProjectDir({ notePath: 'Thing.md' }, env([VAULT], [VAULT]))).toBeNull();
    expect(
      resolveProjectDir({ notePath: 'a/b/Thing.md' }, env([VAULT, '/vault/a', '/vault/a/b'], [VAULT])),
    ).toBeNull();
  });
});

describe('samePath', () => {
  it('ignores separator style, trailing slash, and case', () => {
    expect(samePath('C:\\a\\b', 'C:/a/b')).toBe(true);
    expect(samePath('/a/b/', '/a/b')).toBe(true);
    expect(samePath('/A/B', '/a/b')).toBe(true);
    expect(samePath('/a/b', '/a/c')).toBe(false);
  });
});
