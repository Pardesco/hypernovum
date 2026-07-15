#!/usr/bin/env node
/**
 * Hypernovum Heartbeat Script — v2 (fleet-safe)
 *
 * Called by Claude Code (or any agent) hooks to signal presence to Hypernovum.
 * Each SESSION owns exactly one snapshot file, written atomically:
 *
 *     <vault>/.hypernovum/agents/<sessionId>.json
 *
 * Because every session writes only its own file (tmp + atomic rename), any
 * number of concurrent agents coexist without clobbering each other — the bug
 * the old single-file `.hypernovum-status.json` format had. The plugin reads
 * this directory (and still reads the legacy file, so old hooks keep working).
 *
 * Usage:
 *   node heartbeat.js --vault="/path/to/vault" --id="$CLAUDE_SESSION_ID" \
 *        --name="Claude Code" --agent-type=claude --project="my-app" \
 *        --state=editing --action="Edit src/x.ts" --tool=Edit --file=src/x.ts
 *
 *   node heartbeat.js --vault="/path/to/vault" --id="$CLAUDE_SESSION_ID" --stop
 *
 * Pass --id (e.g. $CLAUDE_SESSION_ID) so every ping in a session updates the
 * SAME file. Without --id a best-effort id is derived from pid+start, which is
 * NOT stable across separate hook invocations (each is a fresh process) — so
 * always pass --id from a hook.
 *
 * Args (all optional except --vault):
 *   --vault           vault root (or env HYPERNOVUM_PATH / OBSIDIAN_VAULT)
 *   --id              stable session id (recommended: $CLAUDE_SESSION_ID)
 *   --name            display name, e.g. "Claude Code"
 *   --agent-type      claude | codex | agy | custom
 *   --project         project name or path hint (cwd basename by convention)
 *   --state           starting|planning|reading|editing|running|testing|
 *                     reviewing|waiting|blocked|complete|failed
 *   --action          human phrase, e.g. "Editing cart.ts"
 *   --tool            tool name (Edit/Read/Bash/…) — used to infer state
 *   --file            most recent file (project-relative preferred)
 *   --objective       optional intent statement (SES-003)
 *   --planned-files   optional comma-separated planned file list (SES-003)
 *   --session-start   epoch ms the session began (defaults to first-seen)
 *   --branch          working-tree branch snapshot (optional)
 *   --dirty-at-start  "true" if the tree was dirty when the session began
 *   --stop            mark this session complete (file remains, pruned at 24h)
 *
 * Claude Code Hook example (~/.claude/settings.json) — see SETUP.md for the
 * full PreToolUse/Stop configuration.
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 2;
const PRUNE_AGE_MS = 24 * 60 * 60 * 1000; // sibling snapshots older than this are removed

// --- Argument parsing: supports both --key=value and --key value ---
function parseArgs(argv) {
  const params = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) {
      params[body.slice(0, eq)] = body.slice(eq + 1);
    } else {
      // --key value  OR  bare flag (--stop)
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        params[body] = next;
        i++;
      } else {
        params[body] = true;
      }
    }
  }
  return params;
}

// --- Small stable hash for id fallback ---
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function toBool(v) {
  return v === true || v === 'true' || v === '1';
}

function strOrNull(v) {
  return v && v !== true ? String(v) : null;
}

function strOrUndef(v) {
  return v && v !== true ? String(v) : undefined;
}

// --- Atomic write: tmp file in the same dir, then rename over the target ---
function writeAtomic(targetPath, contents) {
  const dir = path.dirname(targetPath);
  const tmp = path.join(dir, `.tmp-${process.pid}-${hashString(targetPath)}.json`);
  fs.writeFileSync(tmp, contents);
  try {
    fs.renameSync(tmp, targetPath);
  } catch (err) {
    // Rename can transiently fail on Windows/cloud-synced FS if a reader holds
    // the handle — fall back to a direct write and clean the tmp.
    try {
      fs.writeFileSync(targetPath, contents);
    } finally {
      try { fs.unlinkSync(tmp); } catch { /* ignore ENOENT */ }
    }
  }
}

// --- Prune stale sibling snapshots (best-effort; races are tolerated) ---
function pruneStale(agentsDir, selfFile, now) {
  let entries;
  try {
    entries = fs.readdirSync(agentsDir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const full = path.join(agentsDir, name);
    if (full === selfFile) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
      const lastPing = Number(parsed.lastPing) || 0;
      if (now - lastPing > PRUNE_AGE_MS) fs.unlinkSync(full);
    } catch {
      // Unparseable/torn/gone — ignore (another writer may be renaming it).
    }
  }
}

function main() {
  const params = parseArgs(process.argv.slice(2));

  const vaultPath = params.vault || process.env.HYPERNOVUM_PATH || process.env.OBSIDIAN_VAULT;
  if (!vaultPath) {
    console.error('Error: No vault path. Use --vault="/path/to/vault" or set HYPERNOVUM_PATH.');
    process.exit(1);
  }

  const now = Date.now();
  const sessionStart = Number(params['session-start']) || now;
  const sessionId = params.id && params.id !== true
    ? String(params.id)
    : `local-${hashString(`${process.pid}:${sessionStart}`)}`;

  const agentsDir = path.join(vaultPath, '.hypernovum', 'agents');
  try {
    fs.mkdirSync(agentsDir, { recursive: true });
  } catch (err) {
    console.error('Hypernovum heartbeat: cannot create agents dir:', err.message);
    process.exit(1);
  }

  // Keep agent presence out of git. The vault-root .hypernovum/ dir is distinct
  // from any per-project .hypernovum/ dir; write a broad ignore if absent.
  const gitignorePath = path.join(vaultPath, '.hypernovum', '.gitignore');
  try {
    if (!fs.existsSync(gitignorePath)) fs.writeFileSync(gitignorePath, '*\n');
  } catch { /* non-fatal */ }

  const snapshotFile = path.join(agentsDir, `${sessionId}.json`);

  // Preserve sessionStart across pings if a prior snapshot exists and the
  // caller didn't pass --session-start explicitly.
  let effectiveStart = sessionStart;
  if (!params['session-start']) {
    try {
      const prior = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
      if (Number(prior.sessionStart) > 0) effectiveStart = Number(prior.sessionStart);
    } catch { /* first ping */ }
  }

  const state = params.stop
    ? 'complete'
    : strOrUndef(params.state);

  const snapshot = {
    version: SCHEMA_VERSION,
    sessionId,
    name: strOrUndef(params.name) ?? 'Agent',
    agentType: strOrUndef(params['agent-type']),
    project: strOrNull(params.project),
    state,
    action: strOrNull(params.action),
    tool: strOrNull(params.tool),
    file: strOrNull(params.file),
    objective: strOrUndef(params.objective),
    plannedFiles: strOrUndef(params['planned-files'])
      ? String(params['planned-files']).split(',').map((f) => f.trim()).filter(Boolean)
      : undefined,
    sessionStart: effectiveStart,
    lastPing: now,
    branch: strOrUndef(params.branch),
    dirtyAtStart: params['dirty-at-start'] !== undefined ? toBool(params['dirty-at-start']) : undefined,
    stoppedAt: params.stop ? now : undefined,
  };

  try {
    writeAtomic(snapshotFile, JSON.stringify(snapshot, null, 2));
  } catch (err) {
    console.error('Hypernovum heartbeat error:', err.message);
    process.exit(1);
  }

  pruneStale(agentsDir, snapshotFile, now);

  if (params.stop) {
    console.log(`Hypernovum: session ${sessionId} marked complete`);
  }
  // Silent success for hook usage otherwise.
}

main();
