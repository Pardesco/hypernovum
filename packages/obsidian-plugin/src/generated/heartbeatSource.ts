// GENERATED FILE — DO NOT EDIT.
// Source: scripts/heartbeat.js
// Regenerate: npm run gen:heartbeat
//
// Embedded so the plugin can write a working heartbeat script into the user's
// vault. See scripts/gen-heartbeat-source.mjs for why.

/** Short content hash of scripts/heartbeat.js — used to detect a stale copy in a vault. */
export const HEARTBEAT_SOURCE_SHA = 'abab882024c1';

/** Verbatim contents of scripts/heartbeat.js. */
export const HEARTBEAT_SOURCE = `#!/usr/bin/env node
/**
 * Hypernovum Heartbeat Script — v2 (fleet-safe)
 *
 * Called by Claude Code (or any agent) hooks to signal presence to Hypernovum.
 * Each SESSION owns exactly one snapshot file, written atomically:
 *
 *     <vault>/.hypernovum/agents/<sessionId>.json
 *
 * Because every session writes only its own file (tmp + atomic rename), any
 * number of concurrent agents coexist without clobbering each other. The plugin
 * polls this directory.
 *
 * Usage — from a Claude Code hook (preferred). \`--hook\` reads the hook's stdin
 * JSON for session_id / tool_name / cwd, so nothing needs interpolating:
 *
 *   node heartbeat.js --vault="/path/to/vault" --hook --name="Claude Code" --agent-type=claude
 *
 * Usage — by hand or from a wrapper, passing values explicitly:
 *   node heartbeat.js --vault="/path/to/vault" --id="my-session" \\
 *        --name="Claude Code" --agent-type=claude --project="my-app" \\
 *        --state=editing --action="Edit src/x.ts" --tool=Edit --file=src/x.ts
 *
 *   node heartbeat.js --vault="/path/to/vault" --id="my-session" --stop
 *
 * Every ping in one session must carry the SAME --id (or --hook, which supplies
 * the real session_id) so it updates one snapshot file. Without either, a
 * best-effort id is derived from pid+start, which is NOT stable across separate
 * invocations — each hook call is a fresh process, so it would create one orb per
 * ping.
 *
 * NOTE: Claude Code hooks do NOT provide $CLAUDE_SESSION_ID or $TOOL_NAME
 * environment variables. Use --hook rather than trying to interpolate those.
 *
 * Args (all optional except --vault):
 *   --vault           vault root (or env HYPERNOVUM_PATH / OBSIDIAN_VAULT)
 *   --hook            read session_id/tool_name/cwd from the hook's stdin JSON,
 *                     and treat a Stop/SubagentStop event as --stop
 *   --id              stable session id (supplied automatically by --hook)
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
  // NB: the tmp name must NOT end in .json — the plugin lists *.json and would
  // otherwise read this half-written file as a phantom duplicate agent.
  const tmp = path.join(dir, \`.tmp-\${process.pid}-\${hashString(targetPath)}.tmp\`);
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

const SESSION_LOG_PRUNE_MS = 7 * 24 * 60 * 60 * 1000; // JSONL logs older than 7d pruned

/** Did any sampled field change between the prior snapshot and the new one? */
function sampledChange(prior, snap) {
  return !prior ||
    prior.project !== snap.project ||
    prior.tool !== snap.tool ||
    prior.file !== snap.file ||
    prior.state !== snap.state;
}

/**
 * Append-only session event log (§7.5b). Events: session-start (first ping),
 * ping (only when a sampled field changed), stop. Single writer per session, so
 * fs.appendFileSync of a <4KB line is atomic enough.
 */
function logSessionEvent(vaultPath, snap, prior, isStop, now) {
  const kind = isStop ? 'stop' : (!prior ? 'session-start' : (sampledChange(prior, snap) ? 'ping' : null));
  if (!kind) return; // unchanged ping — sampled out

  const sessionsDir = path.join(vaultPath, '.hypernovum', 'sessions');
  try {
    fs.mkdirSync(sessionsDir, { recursive: true });
  } catch {
    return;
  }

  const event = {
    t: now,
    sessionId: snap.sessionId,
    kind,
    name: snap.name,
    project: snap.project ?? undefined,
    state: snap.state,
    tool: snap.tool ?? undefined,
    file: snap.file ?? undefined,
    objective: snap.objective,
    plannedFiles: snap.plannedFiles,
  };

  try {
    fs.appendFileSync(path.join(sessionsDir, \`\${snap.sessionId}.jsonl\`), JSON.stringify(event) + '\\n');
  } catch { /* non-fatal */ }

  pruneSessionLogs(sessionsDir, now);
}

/** Remove session JSONL files whose last line is older than 7 days. */
function pruneSessionLogs(sessionsDir, now) {
  let entries;
  try {
    entries = fs.readdirSync(sessionsDir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    const full = path.join(sessionsDir, name);
    try {
      const stat = fs.statSync(full);
      if (now - stat.mtimeMs > SESSION_LOG_PRUNE_MS) fs.unlinkSync(full);
    } catch { /* ignore */ }
  }
}

/**
 * Read a Claude Code hook payload from stdin.
 *
 * Hooks do NOT get \`$CLAUDE_SESSION_ID\` or \`$TOOL_NAME\` environment variables —
 * the only env vars exposed are $CLAUDE_PROJECT_DIR, $CLAUDE_PLUGIN_ROOT,
 * $CLAUDE_ENV_FILE and $CLAUDE_CODE_REMOTE. Everything else arrives as a single
 * JSON object on stdin:
 *
 *   { session_id, transcript_path, cwd, permission_mode, hook_event_name,
 *     tool_name?, tool_input?, tool_result?, reason? }
 *
 * Returns null when there is no readable JSON payload (e.g. run by hand).
 */
function readHookPayload() {
  try {
    // fd 0 blocks until EOF, which is what we want: the hook runner closes stdin.
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw || !raw.trim()) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Pull the target file out of a PreToolUse/PostToolUse \`tool_input\`.
 *
 * Field name varies by tool: Edit/Write/Read use \`file_path\`, NotebookEdit uses
 * \`notebook_path\`, and some tools just use \`path\`.
 */
function fileFromToolInput(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  for (const key of ['file_path', 'notebook_path', 'path', 'filePath']) {
    const value = toolInput[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Project-relative paths are what the plugin's conflict detector compares, so
 * strip the working directory when the file sits inside it. Anything outside is
 * passed through untouched.
 */
function relativeIfInside(filePath, cwd) {
  if (!cwd) return filePath;
  try {
    const rel = path.relative(cwd, filePath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return filePath;
    return rel.split(path.sep).join('/');
  } catch {
    return filePath;
  }
}

/**
 * Fold a hook payload into the parsed CLI params. Explicit flags always win, so a
 * wrapper can still override anything.
 */
function applyHookPayload(params) {
  const payload = readHookPayload();
  if (!payload) return params;

  const merged = { ...params };
  if (merged.id === undefined && payload.session_id) merged.id = String(payload.session_id);
  if (merged.tool === undefined && payload.tool_name) merged.tool = String(payload.tool_name);

  // Project defaults to the basename of the agent's working directory, which is
  // the convention the plugin matches against project titles and folder names.
  const cwd = payload.cwd ? String(payload.cwd) : null;
  if (cwd) {
    // Recorded verbatim as well: the plugin matches it against each project's
    // resolved directory, which works even when a project's title differs from
    // its folder name (basename matching alone missed those entirely).
    if (merged.cwd === undefined) merged.cwd = cwd;
    if (merged.project === undefined) {
      const base = path.basename(cwd);
      if (base) merged.project = base;
    }
  }

  // The touched file lives in tool_input, and it is what drives same-file conflict
  // detection between concurrent agents. Without it every hook ping reported
  // file: null and conflicts could never fire.
  if (merged.file === undefined) {
    const file = fileFromToolInput(payload.tool_input);
    if (file) merged.file = relativeIfInside(file, cwd);
  }

  // A Stop/SubagentStop hook means the session ended.
  const event = payload.hook_event_name ? String(payload.hook_event_name) : '';
  if (event === 'Stop' || event === 'SubagentStop') merged.stop = true;

  return merged;
}

function main() {
  let params = parseArgs(process.argv.slice(2));

  // --hook: pull session_id / tool_name / cwd from the hook's stdin JSON.
  if (params.hook) params = applyHookPayload(params);

  const vaultPath = params.vault || process.env.HYPERNOVUM_PATH || process.env.OBSIDIAN_VAULT;
  if (!vaultPath) {
    console.error('Error: No vault path. Use --vault="/path/to/vault" or set HYPERNOVUM_PATH.');
    process.exit(1);
  }

  const now = Date.now();
  const sessionStart = Number(params['session-start']) || now;
  const sessionId = params.id && params.id !== true
    ? String(params.id)
    : \`local-\${hashString(\`\${process.pid}:\${sessionStart}\`)}\`;

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
    if (!fs.existsSync(gitignorePath)) fs.writeFileSync(gitignorePath, '*\\n');
  } catch { /* non-fatal */ }

  const snapshotFile = path.join(agentsDir, \`\${sessionId}.json\`);

  // Read the prior snapshot once — used to preserve sessionStart and to sample
  // session-log events (only log when something actually changed).
  let prior = null;
  try {
    prior = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  } catch { /* first ping */ }

  let effectiveStart = sessionStart;
  if (!params['session-start'] && prior && Number(prior.sessionStart) > 0) {
    effectiveStart = Number(prior.sessionStart);
  }

  const state = params.stop
    ? 'complete'
    : strOrUndef(params.state);

  // Identity is sticky across pings; per-ping activity is not.
  //
  // The generated Stop hook runs \`--hook --stop\` with no other flags, and a Stop
  // payload carries no tool_name, so without inheritance the final write would
  // replace the session with \`name: 'Agent'\`, no agent type, and null
  // action/tool/file — throwing away everything earlier pings recorded, which is
  // exactly what the completed orb and the session-log stop event display.
  const inheritOnStop = (value, priorValue) =>
    value !== null && value !== undefined ? value : (params.stop ? priorValue ?? null : value);

  const snapshot = {
    version: SCHEMA_VERSION,
    sessionId,
    name: strOrUndef(params.name) ?? (prior && prior.name ? prior.name : 'Agent'),
    agentType: strOrUndef(params['agent-type']) ?? (prior ? prior.agentType : undefined),
    project: inheritOnStop(strOrNull(params.project), prior && prior.project),
    /** Agent working directory — matched against resolved project dirs by the plugin. */
    cwd: strOrNull(params.cwd) ?? (prior ? prior.cwd ?? null : null),
    state,
    action: inheritOnStop(strOrNull(params.action), prior && prior.action),
    tool: inheritOnStop(strOrNull(params.tool), prior && prior.tool),
    file: inheritOnStop(strOrNull(params.file), prior && prior.file),
    objective: strOrUndef(params.objective) ?? (prior ? prior.objective : undefined),
    plannedFiles: strOrUndef(params['planned-files'])
      ? String(params['planned-files']).split(',').map((f) => f.trim()).filter(Boolean)
      : (prior ? prior.plannedFiles : undefined),
    sessionStart: effectiveStart,
    lastPing: now,
    branch: strOrUndef(params.branch) ?? (prior ? prior.branch : undefined),
    dirtyAtStart: params['dirty-at-start'] !== undefined
      ? toBool(params['dirty-at-start'])
      : (prior ? prior.dirtyAtStart : undefined),
    stoppedAt: params.stop ? now : undefined,
  };

  try {
    writeAtomic(snapshotFile, JSON.stringify(snapshot, null, 2));
  } catch (err) {
    console.error('Hypernovum heartbeat error:', err.message);
    process.exit(1);
  }

  pruneStale(agentsDir, snapshotFile, now);

  // Append a sampled session-log event (SES-001).
  logSessionEvent(vaultPath, snapshot, prior, !!params.stop, now);

  if (params.stop) {
    console.log(\`Hypernovum: session \${sessionId} marked complete\`);
  }
  // Silent success for hook usage otherwise.
}

main();
`;
