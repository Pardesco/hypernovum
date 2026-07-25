import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { uniqueOutputName } from './outputPaths';

export { uniqueOutputName } from './outputPaths';

/**
 * Vault-API helpers for the files Hypernovum writes on the user's behalf
 * (briefings, snapshots).
 *
 * These used to go through `vault.adapter.write` / `writeBinary` straight into the
 * vault root with a fixed filename. That skipped Obsidian's file index (so the
 * note wasn't linkable or searchable until a restart) and silently overwrote the
 * previous file of the same name.
 */

/**
 * Resolve `<folder>/<name>`, creating the folder if needed and never colliding
 * with an existing file. An empty folder means the vault root.
 */
export async function resolveOutputPath(app: App, folder: string, name: string): Promise<string> {
  const cleanFolder = normalizePath(folder.trim().replace(/^\/+|\/+$/g, ''));
  const useFolder = cleanFolder && cleanFolder !== '.' && cleanFolder !== '/';

  if (useFolder) {
    const existing = app.vault.getAbstractFileByPath(cleanFolder);
    if (!existing) {
      await app.vault.createFolder(cleanFolder);
    } else if (!(existing instanceof TFolder)) {
      // A file sits where the folder should be — fall back to the vault root
      // rather than throwing in the middle of a save.
      return normalizePath(name);
    }
  }

  return normalizePath(useFolder ? `${cleanFolder}/${name}` : name);
}

/**
 * Create or overwrite a text file through the Vault API. Overwriting is
 * intentional for same-day briefings; callers wanting a fresh file should pass a
 * path from {@link uniqueOutputName}.
 */
export async function writeVaultFile(app: App, path: string, contents: string): Promise<void> {
  const target = normalizePath(path);
  const existing = app.vault.getAbstractFileByPath(target);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, contents);
    return;
  }
  await app.vault.create(target, contents);
}

/**
 * Create a binary file through the Vault API, picking the first free
 * `name`, `name-2`, `name-3`… so repeated snapshots don't destroy each other.
 * Returns the path actually written.
 */
export async function createBinaryVaultFile(
  app: App,
  folder: string,
  baseName: string,
  extension: string,
  data: ArrayBuffer,
): Promise<string> {
  const taken = (candidate: string) => app.vault.getAbstractFileByPath(normalizePath(candidate)) !== null;

  // Resolve the folder once (creating it if needed) using a throwaway name.
  const probe = await resolveOutputPath(app, folder, `${baseName}${extension}`);
  const dir = probe.includes('/') ? probe.slice(0, probe.lastIndexOf('/')) : '';

  const name = uniqueOutputName(baseName, extension, (candidate) =>
    taken(dir ? `${dir}/${candidate}` : candidate),
  );
  const path = normalizePath(dir ? `${dir}/${name}` : name);

  await app.vault.createBinary(path, data);
  return path;
}
