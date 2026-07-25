/**
 * Pure builders for the heartbeat command lines Hypernovum writes into AGENTS.md,
 * per-project SETUP.md, and the hook JSON it hands the user.
 *
 * These used to hardcode `<vault>/scripts/heartbeat.js` — a repo path that does
 * not exist in an installed plugin — and `<vault-root>` placeholders the user had
 * to substitute by hand. Everything here takes fully resolved absolute paths so
 * the emitted commands are copy-paste runnable.
 *
 * Kept free of the `obsidian` import so it stays unit-testable.
 */

/** Forward-slashed path — safe in shell commands and JSON on every platform. */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/');
}

export interface HeartbeatPaths {
  /** Absolute path to the installed heartbeat script. */
  scriptPath: string;
  /** Absolute path to the vault root. */
  vaultPath: string;
}

/** `node "<script>" --vault="<vault>"` — the prefix every invocation shares. */
function invocationPrefix({ scriptPath, vaultPath }: HeartbeatPaths): string {
  return `node "${toPosixPath(scriptPath)}" --vault="${toPosixPath(vaultPath)}"`;
}

/**
 * Placeholder session id for hand-written pings.
 *
 * Deliberately NOT `$CLAUDE_SESSION_ID`: Claude Code hooks expose only
 * $CLAUDE_PROJECT_DIR / $CLAUDE_PLUGIN_ROOT / $CLAUDE_ENV_FILE /
 * $CLAUDE_CODE_REMOTE — there is no session-id env var, so that expanded to an
 * empty string and every ping created a brand-new orb. Hooks should use
 * {@link buildClaudeHookJson} (which passes `--hook`); anything else picks its own
 * stable id and reuses it.
 */
const SESSION_ID_PLACEHOLDER = '<your-session-id>';

/** Multi-line per-ping example for docs, with a project name filled in. */
export function buildPingExample(paths: HeartbeatPaths, projectName: string): string {
  return [
    `${invocationPrefix(paths)} \\`,
    `  --id="${SESSION_ID_PLACEHOLDER}" --name="Claude Code" --agent-type=claude \\`,
    `  --project="${projectName}" \\`,
    '  --state=editing --action="Editing cart.ts" --tool=Edit --file=src/cart.ts',
  ].join('\n');
}

/** Single-line stop invocation for docs. */
export function buildStopExample(paths: HeartbeatPaths): string {
  return `${invocationPrefix(paths)} --id="${SESSION_ID_PLACEHOLDER}" --stop`;
}

/** A ready-to-run manual ping, for testing before wiring hooks up. */
export function buildManualPingCommand(paths: HeartbeatPaths, projectName: string): string {
  return [
    invocationPrefix(paths),
    '--id=manual-test',
    // A fixed id so repeat runs update one orb rather than spawning several.
    '--name="Manual test"',
    '--agent-type=custom',
    `--project="${projectName}"`,
    '--state=editing',
    '--action="Testing Hypernovum heartbeat"',
  ].join(' ');
}

/**
 * Claude Code hook JSON for `~/.claude/settings.json`, wired to this vault's
 * installed script with every path already resolved.
 *
 * Two things here are load-bearing and were both wrong before:
 *
 * 1. `matcher` is a **string** pattern matched against the tool name (`"*"` for
 *    all tools). It was an object (`{ tool_name: ".*" }`), which doesn't match the
 *    hook schema, so the PreToolUse entry was ignored outright.
 * 2. The command passes `--hook` instead of interpolating `$CLAUDE_SESSION_ID` and
 *    `$TOOL_NAME`. Those environment variables do not exist for hooks — Claude Code
 *    delivers `session_id`, `tool_name` and `cwd` as JSON on **stdin**. They
 *    expanded empty, so the script fell back to a pid-derived id and every single
 *    ping produced a new orb, while Stop could never close the real session.
 */
export function buildClaudeHookJson(paths: HeartbeatPaths): string {
  const prefix = invocationPrefix(paths);
  const ping = [prefix, '--hook', '--name="Claude Code"', '--agent-type=claude'].join(' ');
  const stop = [prefix, '--hook', '--stop'].join(' ');

  return JSON.stringify(
    {
      hooks: {
        PreToolUse: [
          { matcher: '*', hooks: [{ type: 'command', command: ping }] },
        ],
        Stop: [
          { hooks: [{ type: 'command', command: stop }] },
        ],
      },
    },
    null,
    2,
  );
}
