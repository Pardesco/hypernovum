import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import * as path from 'path';
import { HEARTBEAT_SOURCE, HEARTBEAT_SOURCE_SHA } from '../src/generated/heartbeatSource';
import {
  buildClaudeHookJson,
  buildManualPingCommand,
  buildPingExample,
  buildStopExample,
  toPosixPath,
} from '../src/utils/heartbeatDocs';

const SCRIPT = path.resolve(__dirname, '../../../scripts/heartbeat.js');
// LF-normalised to match the generator — a template literal normalises CRLF to
// LF at parse time, so a CRLF checkout could never compare equal otherwise.
const onDisk = readFileSync(SCRIPT, 'utf8').replace(/\r\n/g, '\n');

const PATHS = {
  scriptPath: 'C:\\Users\\me\\My Vault\\.hypernovum\\heartbeat.js',
  vaultPath: 'C:\\Users\\me\\My Vault',
};

describe('embedded heartbeat source', () => {
  it('is byte-identical to scripts/heartbeat.js', () => {
    // Guards the drift that would silently ship a stale script into user vaults.
    // If this fails: npm run gen:heartbeat
    expect(HEARTBEAT_SOURCE).toBe(onDisk);
  });

  it('carries the matching content hash', () => {
    const sha = createHash('sha256').update(onDisk).digest('hex').slice(0, 12);
    expect(HEARTBEAT_SOURCE_SHA).toBe(sha);
  });

  it('survived template-literal escaping intact', () => {
    expect(HEARTBEAT_SOURCE).toContain('#!/usr/bin/env node');
    expect(HEARTBEAT_SOURCE).toContain('agents');
    // A botched escape pass is the realistic failure mode — assert no literal
    // backslash-backtick or backslash-dollar leaked into the embedded copy.
    expect(HEARTBEAT_SOURCE).not.toContain('\\`');
    expect(HEARTBEAT_SOURCE).not.toContain('\\${');
  });
});

describe('heartbeat doc builders', () => {
  it('forward-slashes Windows paths', () => {
    expect(toPosixPath('C:\\a\\b')).toBe('C:/a/b');
  });

  it('never emits the old repo path or an unsubstituted placeholder', () => {
    const emitted = [
      buildPingExample(PATHS, 'My Project'),
      buildStopExample(PATHS),
      buildManualPingCommand(PATHS, 'My Project'),
      buildClaudeHookJson(PATHS),
    ].join('\n');

    expect(emitted).not.toContain('scripts/heartbeat.js');
    expect(emitted).not.toContain('<vault-root>');
    expect(emitted).not.toContain('/path/to');
  });

  it('never references env vars Claude Code hooks do not provide', () => {
    // Hooks expose only $CLAUDE_PROJECT_DIR / $CLAUDE_PLUGIN_ROOT /
    // $CLAUDE_ENV_FILE / $CLAUDE_CODE_REMOTE. $CLAUDE_SESSION_ID and $TOOL_NAME
    // expanded to empty strings, so every ping created a fresh orb and Stop could
    // never close the real session.
    const emitted = [
      buildPingExample(PATHS, 'My Project'),
      buildStopExample(PATHS),
      buildManualPingCommand(PATHS, 'My Project'),
      buildClaudeHookJson(PATHS),
    ].join('\n');

    expect(emitted).not.toContain('CLAUDE_SESSION_ID');
    expect(emitted).not.toContain('TOOL_NAME');
  });

  it('points every invocation at the installed absolute path', () => {
    const expected = 'C:/Users/me/My Vault/.hypernovum/heartbeat.js';
    expect(buildPingExample(PATHS, 'X')).toContain(expected);
    expect(buildStopExample(PATHS)).toContain(expected);
    expect(buildManualPingCommand(PATHS, 'X')).toContain(expected);
    expect(buildClaudeHookJson(PATHS)).toContain(expected);
  });

  it('builds hook JSON with both PreToolUse and Stop wired', () => {
    const parsed = JSON.parse(buildClaudeHookJson(PATHS));
    // --hook makes the script read session_id/tool_name/cwd from the hook's stdin
    // JSON, which is the only place Claude Code supplies them.
    expect(parsed.hooks.PreToolUse[0].hooks[0].command).toContain('--hook');
    expect(parsed.hooks.PreToolUse[0].hooks[0].type).toBe('command');
    expect(parsed.hooks.Stop[0].hooks[0].command).toContain('--hook');
    expect(parsed.hooks.Stop[0].hooks[0].command).toContain('--stop');
  });

  it('uses a STRING matcher, as the hook schema requires', () => {
    // This was `{ tool_name: '.*' }`, an object, which does not match the schema —
    // the PreToolUse entry was silently ignored.
    const parsed = JSON.parse(buildClaudeHookJson(PATHS));
    expect(typeof parsed.hooks.PreToolUse[0].matcher).toBe('string');
    expect(parsed.hooks.PreToolUse[0].matcher).toBe('*');
  });

  it('quotes paths so vault folders with spaces survive', () => {
    expect(buildStopExample(PATHS)).toContain('"C:/Users/me/My Vault/.hypernovum/heartbeat.js"');
    expect(buildStopExample(PATHS)).toContain('--vault="C:/Users/me/My Vault"');
  });
});
