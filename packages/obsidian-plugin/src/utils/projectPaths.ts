/**
 * Project-directory resolution rules, kept pure so the priority order is testable
 * (the `obsidian` module can't be imported under vitest).
 *
 * Why this exists: the old resolver ended with "…otherwise the vault root". For
 * the common case — a project note with no `projectDir` — that meant every such
 * project silently reported the *vault's* git branch, commits, and dirty state,
 * "Open folder"/"Open terminal"/"Launch agent" all landed in the vault root, and
 * an agent launch wrote `.hypernovum/SETUP.md` into the vault itself. Worse, N
 * projects sharing one resolved directory meant N × 8 redundant `git` spawns per
 * rebuild.
 *
 * Now: resolution can fail. Callers must handle `null` rather than being handed a
 * plausible-looking wrong answer.
 */

export type ProjectDirSource = 'frontmatter' | 'sibling-folder' | 'note-parent' | 'git-ancestor';

export interface ResolvedProjectDir {
  /** Absolute path of the project's working directory. */
  path: string;
  /** Which rule produced it — surfaced in the inspector so the user can tell. */
  source: ProjectDirSource;
}

export interface ProjectDirInput {
  /** Vault-relative path of the project note, e.g. "Work/Apps/Thing.md". */
  notePath: string;
  /** Raw `projectDir` frontmatter value, if any. */
  projectDir?: string;
}

export interface ProjectDirEnv {
  /** Absolute vault root. */
  vaultBase: string;
  /** True when the absolute path exists as a directory. */
  dirExists: (absolutePath: string) => boolean;
  /**
   * True when the directory looks like a project root of its own — a git working
   * tree, or a package/module manifest.
   *
   * This is what stops a plain notes folder from being claimed as a project
   * directory: `Projects/A.md` and `Projects/B.md` would otherwise both resolve to
   * `<vault>/Projects`, sharing one repo's Git data between unrelated projects and
   * pointing every folder/terminal/agent action at the same place.
   */
  isProjectRoot: (absolutePath: string) => boolean;
  /** Platform path helpers, injected so tests can run POSIX rules on Windows. */
  isAbsolute: (p: string) => boolean;
  join: (...parts: string[]) => string;
  dirname: (p: string) => string;
}

/** Normalise separators and strip a trailing slash for stable comparisons. */
function canonical(p: string): string {
  const unified = p.replace(/\\/g, '/');
  return unified.length > 1 ? unified.replace(/\/+$/, '') : unified;
}

/** True when `a` and `b` name the same directory. */
export function samePath(a: string, b: string): boolean {
  return canonical(a).toLowerCase() === canonical(b).toLowerCase();
}

/**
 * Resolve a project's working directory, or null when it can't be determined.
 *
 * Priority:
 *   1. `projectDir` frontmatter (absolute, or relative to the vault)
 *   2. a folder sitting next to the note with the note's name
 *   3. the note's parent folder, but ONLY if that folder is itself a project root
 *   4. the nearest project-root ancestor of the note's folder
 *
 * Rules 3 and 4 both require {@link ProjectDirEnv.isProjectRoot}. A bare parent
 * folder is not enough: sibling notes in one notes folder would all claim it, and
 * requiring a real project marker also keeps rule 4 reachable.
 *
 * The vault root is deliberately never returned: "the whole vault" is not a
 * project directory, and pretending it is produced silently wrong Git data.
 */
export function resolveProjectDir(
  project: ProjectDirInput,
  env: ProjectDirEnv,
): ResolvedProjectDir | null {
  const { vaultBase, dirExists, isProjectRoot, isAbsolute, join, dirname } = env;

  // 1. Explicit frontmatter wins, absolute or vault-relative.
  if (project.projectDir && project.projectDir.trim()) {
    const raw = project.projectDir.trim();
    const candidate = isAbsolute(raw) ? raw : join(vaultBase, raw);
    if (dirExists(candidate)) {
      return { path: candidate, source: 'frontmatter' };
    }
    // An explicit-but-broken path is a user error worth surfacing, not something
    // to paper over with a guess.
    return null;
  }

  // 2. Sibling folder named after the note.
  const noteFolder = join(vaultBase, project.notePath.replace(/\.md$/i, ''));
  if (!samePath(noteFolder, vaultBase) && dirExists(noteFolder)) {
    return { path: noteFolder, source: 'sibling-folder' };
  }

  // 3. The note's own folder, but only when it is a project root in its own right.
  const parent = join(vaultBase, dirname(project.notePath));
  if (!samePath(parent, vaultBase) && dirExists(parent) && isProjectRoot(parent)) {
    return { path: parent, source: 'note-parent' };
  }

  // 4. Nearest project root above the note, stopping before the vault root.
  let cursor = dirname(parent);
  for (let depth = 0; depth < 32; depth++) {
    if (samePath(cursor, vaultBase)) break;
    if (dirExists(cursor) && isProjectRoot(cursor)) {
      return { path: cursor, source: 'git-ancestor' };
    }
    const next = dirname(cursor);
    if (samePath(next, cursor)) break; // hit the filesystem root
    cursor = next;
  }

  return null;
}

/** Human-readable explanation of where a resolved directory came from. */
export const DIR_SOURCE_LABEL: Record<ProjectDirSource, string> = {
  'frontmatter': 'from projectDir',
  'sibling-folder': 'folder matching the note name',
  'note-parent': "the note's folder (a project root)",
  'git-ancestor': 'nearest project root above the note',
};
