import { App, FileSystemAdapter, normalizePath } from 'obsidian';
import { HEARTBEAT_SOURCE, HEARTBEAT_SOURCE_SHA } from '../generated/heartbeatSource';
import { toPosixPath, type HeartbeatPaths } from './heartbeatDocs';

export {
  buildClaudeHookJson,
  buildManualPingCommand,
  buildPingExample,
  buildStopExample,
  toPosixPath,
  type HeartbeatPaths,
} from './heartbeatDocs';

/** Vault-relative folder Hypernovum owns for agent plumbing. */
export const HYPERNOVUM_DIR = '.hypernovum';

/** Vault-relative path of the installed heartbeat script. */
export const HEARTBEAT_VAULT_PATH = `${HYPERNOVUM_DIR}/heartbeat.js`;

/** Trailing marker that tells an up-to-date copy from a stale one. */
const STAMP_PREFIX = '// hypernovum:heartbeat-source ';

export interface HeartbeatInstallResult {
  /** Absolute, forward-slashed path of the installed script. */
  absolutePath: string;
  /** What the install actually did. */
  action: 'created' | 'updated' | 'current';
}

/**
 * Absolute filesystem path of the vault, or null when the vault isn't on a real
 * filesystem. `FileSystemAdapter` is the documented desktop adapter — this
 * replaces `(app.vault.adapter as any).basePath`, which reached into an
 * undocumented internal and yielded `undefined` (silently poisoning every
 * downstream `path.join`) whenever it wasn't there.
 */
export function getVaultBasePath(app: App): string | null {
  const adapter = app.vault.adapter;
  return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
}

/**
 * Absolute path the heartbeat script lives at, whether or not it's installed yet.
 * Null when the vault base path is unavailable.
 */
export function heartbeatAbsolutePath(app: App): string | null {
  const base = getVaultBasePath(app);
  return base ? toPosixPath(`${base}/${HEARTBEAT_VAULT_PATH}`) : null;
}

/** Resolved script + vault paths for the doc builders, or null if unavailable. */
export function heartbeatPaths(app: App): HeartbeatPaths | null {
  const base = getVaultBasePath(app);
  if (!base) return null;
  return { scriptPath: `${toPosixPath(base)}/${HEARTBEAT_VAULT_PATH}`, vaultPath: toPosixPath(base) };
}

/**
 * Write the embedded heartbeat script into `<vault>/.hypernovum/heartbeat.js`.
 *
 * Obsidian installs only main.js/manifest.json/styles.css, so the repo's
 * `scripts/heartbeat.js` never reaches a user's machine — without this, every
 * agent-presence feature (orbs, fleet, conflicts, arteries, session digest) is
 * dead on arrival for anyone who installs the plugin normally.
 *
 * Uses the adapter rather than the Vault API deliberately: `.hypernovum` is a
 * dotfolder outside Obsidian's file index, and this is machine plumbing rather
 * than user content.
 *
 * Idempotent — a copy already carrying the current source stamp is left alone,
 * so it's safe to call on every "prepare vault" run, and a plugin upgrade
 * refreshes a stale copy automatically.
 */
export async function installHeartbeatScript(app: App): Promise<HeartbeatInstallResult> {
  const absolutePath = heartbeatAbsolutePath(app);
  if (!absolutePath) {
    throw new Error('Hypernovum needs a local vault folder to install the heartbeat script.');
  }

  const adapter = app.vault.adapter;
  const dir = normalizePath(HYPERNOVUM_DIR);
  const file = normalizePath(HEARTBEAT_VAULT_PATH);
  const stamp = `${STAMP_PREFIX}${HEARTBEAT_SOURCE_SHA}`;
  const contents = `${HEARTBEAT_SOURCE.replace(/\s*$/, '')}\n\n${stamp}\n`;

  if (!(await adapter.exists(dir))) {
    await adapter.mkdir(dir);
  }

  const existed = await adapter.exists(file);
  if (existed) {
    try {
      const current = await adapter.read(file);
      if (current.includes(stamp)) return { absolutePath, action: 'current' };
    } catch {
      // Unreadable — fall through and overwrite.
    }
  }

  await adapter.write(file, contents);
  return { absolutePath, action: existed ? 'updated' : 'created' };
}
