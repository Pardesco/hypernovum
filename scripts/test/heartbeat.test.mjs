import { describe, it, expect } from 'vitest';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dirname, '..', 'heartbeat.js');
const execFileP = promisify(execFile);
/** Async ping — lets multiple session-writers actually run concurrently. */
function pingAsync(vault, id, extra = []) {
  return execFileP('node', [SCRIPT, `--vault=${vault}`, `--id=${id}`, ...extra]);
}

function newVault() {
  return mkdtempSync(join(tmpdir(), 'hv-vault-'));
}

function agentsDir(vault) {
  return join(vault, '.hypernovum', 'agents');
}

function ping(vault, id, extra = []) {
  execFileSync('node', [SCRIPT, `--vault=${vault}`, `--id=${id}`, ...extra]);
}

describe('heartbeat.js v2', () => {
  it('writes a per-session snapshot file with v2 schema', () => {
    const vault = newVault();
    ping(vault, 'sess-A', ['--name=Claude Code', '--agent-type=claude', '--project=demo', '--state=editing', '--file=src/x.ts']);

    const file = join(agentsDir(vault), 'sess-A.json');
    expect(existsSync(file)).toBe(true);
    const snap = JSON.parse(readFileSync(file, 'utf8'));
    expect(snap.version).toBe(2);
    expect(snap.sessionId).toBe('sess-A');
    expect(snap.name).toBe('Claude Code');
    expect(snap.project).toBe('demo');
    expect(snap.state).toBe('editing');
    expect(snap.file).toBe('src/x.ts');
    expect(typeof snap.lastPing).toBe('number');
    expect(typeof snap.sessionStart).toBe('number');
  });

  it('writes a .hypernovum/.gitignore to keep presence out of git', () => {
    const vault = newVault();
    ping(vault, 'sess-A', ['--project=demo']);
    expect(existsSync(join(vault, '.hypernovum', '.gitignore'))).toBe(true);
  });

  it('accepts space-separated args (--id value)', () => {
    const vault = newVault();
    execFileSync('node', [SCRIPT, '--vault', vault, '--id', 'sess-space', '--project', 'demo']);
    expect(existsSync(join(agentsDir(vault), 'sess-space.json'))).toBe(true);
  });

  it('--stop marks only its own session complete', () => {
    const vault = newVault();
    ping(vault, 'sess-A', ['--project=a', '--state=editing']);
    ping(vault, 'sess-B', ['--project=b', '--state=editing']);
    ping(vault, 'sess-A', ['--stop']);

    const a = JSON.parse(readFileSync(join(agentsDir(vault), 'sess-A.json'), 'utf8'));
    const b = JSON.parse(readFileSync(join(agentsDir(vault), 'sess-B.json'), 'utf8'));
    expect(a.state).toBe('complete');
    expect(typeof a.stoppedAt).toBe('number');
    expect(b.state).toBe('editing'); // untouched
  });

  it('preserves sessionStart across pings for the same id', () => {
    const vault = newVault();
    ping(vault, 'sess-A', ['--project=a']);
    const first = JSON.parse(readFileSync(join(agentsDir(vault), 'sess-A.json'), 'utf8')).sessionStart;
    ping(vault, 'sess-A', ['--project=a', '--action=more']);
    const second = JSON.parse(readFileSync(join(agentsDir(vault), 'sess-A.json'), 'utf8')).sessionStart;
    expect(second).toBe(first);
  });

  it('4 GENUINELY-concurrent writers × 20 pings → 4 parseable files, no torn JSON', async () => {
    const vault = newVault();
    const ids = ['w1', 'w2', 'w3', 'w4'];
    const N = 20;

    // Each writer awaits its own pings in order; the 4 chains overlap (real
    // concurrency), so writers prune each other's siblings while writing.
    await Promise.all(ids.map(async (id) => {
      for (let i = 0; i < N; i++) {
        await pingAsync(vault, id, [`--project=${id}`, `--action=ping ${i}`]);
      }
    }));

    const files = readdirSync(agentsDir(vault)).filter((f) => f.endsWith('.json'));
    // Only the 4 real snapshots — no phantom .tmp files leaking in as .json.
    expect(files.sort()).toEqual(['w1.json', 'w2.json', 'w3.json', 'w4.json']);
    for (const id of ids) {
      const snap = JSON.parse(readFileSync(join(agentsDir(vault), `${id}.json`), 'utf8'));
      expect(snap.sessionId).toBe(id);
      expect(snap.project).toBe(id);
      expect(snap.action).toBe(`ping ${N - 1}`);
    }
  }, 30000);

  it('logs sampled session events to JSONL (session-start / ping-on-change / stop)', () => {
    const vault = newVault();
    const sessionsDir = join(vault, '.hypernovum', 'sessions');
    const logFile = join(sessionsDir, 'sess-A.jsonl');

    ping(vault, 'sess-A', ['--project=demo', '--state=editing', '--file=a.ts']); // session-start
    ping(vault, 'sess-A', ['--project=demo', '--state=editing', '--file=a.ts']); // unchanged → no event
    ping(vault, 'sess-A', ['--project=demo', '--state=editing', '--file=b.ts']); // file changed → ping
    ping(vault, 'sess-A', ['--stop']);                                            // stop

    const lines = readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((e) => e.kind)).toEqual(['session-start', 'ping', 'stop']);
    expect(lines[1].file).toBe('b.ts');
    expect(typeof lines[0].t).toBe('number');
  });

  it('session-log appends stay intact under GENUINELY-concurrent per-session writers', async () => {
    const vault = newVault();
    const ids = ['s1', 's2', 's3'];
    await Promise.all(ids.map(async (id) => {
      for (let i = 0; i < 15; i++) await pingAsync(vault, id, [`--project=${id}`, `--state=editing`, `--file=f${i}.ts`]);
    }));
    for (const id of ids) {
      const lines = readFileSync(join(vault, '.hypernovum', 'sessions', `${id}.jsonl`), 'utf8').trim().split('\n');
      // 1 session-start + 14 file-change pings = 15 parseable lines
      expect(lines.length).toBe(15);
      for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
    }
  });

  it('prunes sibling snapshots older than 24h, keeps fresh ones', () => {
    const vault = newVault();
    const dir = agentsDir(vault);
    mkdirSync(dir, { recursive: true });
    // Plant a stale snapshot (lastPing 48h ago)
    const stale = { version: 2, sessionId: 'old', lastPing: Date.now() - 48 * 3600 * 1000 };
    writeFileSync(join(dir, 'old.json'), JSON.stringify(stale));

    // A fresh ping should prune the stale sibling
    ping(vault, 'fresh', ['--project=demo']);

    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files).toContain('fresh.json');
    expect(files).not.toContain('old.json');
  });
});

/**
 * `--hook` mode: Claude Code hooks deliver session_id / tool_name / cwd as JSON on
 * stdin, and expose NO $CLAUDE_SESSION_ID or $TOOL_NAME env vars. Before this
 * existed, the generated hook interpolated those non-existent variables, they
 * expanded empty, and the script fell back to a pid-derived id — so every ping
 * created a new orb and Stop could never close the real session.
 */
function hookPing(vault, payload, extra = []) {
  return execFileSync('node', [SCRIPT, `--vault=${vault}`, '--hook', ...extra], {
    input: JSON.stringify(payload),
  });
}

describe('heartbeat.js --hook (stdin payload)', () => {
  it('takes the session id from stdin so repeat pings share one snapshot', () => {
    const vault = newVault();
    const payload = {
      session_id: 'hook-sess-1',
      cwd: join(vault, 'my-app'),
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
    };

    hookPing(vault, payload, ['--name=Claude Code', '--agent-type=claude']);
    hookPing(vault, payload, ['--name=Claude Code', '--agent-type=claude']);

    const files = readdirSync(agentsDir(vault)).filter((f) => f.endsWith('.json'));
    expect(files).toEqual(['hook-sess-1.json']);

    const snap = JSON.parse(readFileSync(join(agentsDir(vault), 'hook-sess-1.json'), 'utf8'));
    expect(snap.sessionId).toBe('hook-sess-1');
    expect(snap.tool).toBe('Edit');
    // project defaults to the basename of the agent's cwd
    expect(snap.project).toBe('my-app');
  });

  it('treats a Stop event as session complete', () => {
    const vault = newVault();
    hookPing(vault, { session_id: 'hook-sess-2', cwd: vault, hook_event_name: 'PreToolUse', tool_name: 'Read' });
    hookPing(vault, { session_id: 'hook-sess-2', cwd: vault, hook_event_name: 'Stop', reason: 'done' });

    const snap = JSON.parse(readFileSync(join(agentsDir(vault), 'hook-sess-2.json'), 'utf8'));
    expect(snap.state).toBe('complete');
    expect(snap.stoppedAt).toBeGreaterThan(0);
  });

  it('lets explicit flags override the stdin payload', () => {
    const vault = newVault();
    hookPing(vault, { session_id: 'from-stdin', cwd: vault, tool_name: 'Bash' }, [
      '--id=explicit',
      '--project=chosen',
    ]);

    expect(existsSync(join(agentsDir(vault), 'explicit.json'))).toBe(true);
    const snap = JSON.parse(readFileSync(join(agentsDir(vault), 'explicit.json'), 'utf8'));
    expect(snap.project).toBe('chosen');
    expect(snap.tool).toBe('Bash');
  });

  it('survives an empty or malformed stdin payload', () => {
    const vault = newVault();
    expect(() =>
      execFileSync('node', [SCRIPT, `--vault=${vault}`, '--hook', '--id=fallback'], { input: '' }),
    ).not.toThrow();
    expect(() =>
      execFileSync('node', [SCRIPT, `--vault=${vault}`, '--hook', '--id=fallback2'], { input: 'not json' }),
    ).not.toThrow();
    expect(existsSync(join(agentsDir(vault), 'fallback.json'))).toBe(true);
    expect(existsSync(join(agentsDir(vault), 'fallback2.json'))).toBe(true);
  });
});

describe('heartbeat.js --hook file extraction', () => {
  it('pulls the edited file from tool_input.file_path, project-relative', () => {
    // Same-file conflict detection compares project-relative paths; without this
    // every hook ping reported file: null and conflicts could never fire.
    const vault = newVault();
    const cwd = join(vault, 'app');
    hookPing(vault, {
      session_id: 'file-sess',
      cwd,
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: join(cwd, 'src', 'cart.ts') },
    });

    const snap = JSON.parse(readFileSync(join(agentsDir(vault), 'file-sess.json'), 'utf8'));
    expect(snap.file).toBe('src/cart.ts');
  });

  it('handles notebook_path and plain path too', () => {
    const vault = newVault();
    hookPing(vault, {
      session_id: 'nb',
      cwd: vault,
      tool_name: 'NotebookEdit',
      tool_input: { notebook_path: join(vault, 'analysis.ipynb') },
    });
    expect(JSON.parse(readFileSync(join(agentsDir(vault), 'nb.json'), 'utf8')).file)
      .toBe('analysis.ipynb');
  });

  it('leaves a file outside the working directory absolute', () => {
    const vault = newVault();
    const outside = join(vault, '..', 'elsewhere.ts');
    hookPing(vault, {
      session_id: 'out',
      cwd: join(vault, 'app'),
      tool_name: 'Read',
      tool_input: { file_path: outside },
    });
    const snap = JSON.parse(readFileSync(join(agentsDir(vault), 'out.json'), 'utf8'));
    expect(snap.file).toContain('elsewhere.ts');
  });

  it('tolerates a missing or non-object tool_input', () => {
    const vault = newVault();
    hookPing(vault, { session_id: 'noinput', cwd: vault, tool_name: 'Bash' });
    hookPing(vault, { session_id: 'badinput', cwd: vault, tool_name: 'Bash', tool_input: 'nope' });
    expect(JSON.parse(readFileSync(join(agentsDir(vault), 'noinput.json'), 'utf8')).file).toBeNull();
    expect(JSON.parse(readFileSync(join(agentsDir(vault), 'badinput.json'), 'utf8')).file).toBeNull();
  });
});

describe('heartbeat.js session identity on stop', () => {
  it('keeps name, type, project and last activity when the Stop hook fires', () => {
    // The generated Stop hook runs `--hook --stop` with nothing else, and a Stop
    // payload has no tool_name — so without inheritance the completed orb reverted
    // to a nameless "Agent" with no recorded activity.
    const vault = newVault();
    const cwd = join(vault, 'app');

    hookPing(vault, {
      session_id: 'keep-me',
      cwd,
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: join(cwd, 'src', 'x.ts') },
    }, ['--name=Claude Code', '--agent-type=claude', '--action=Editing x.ts']);

    hookPing(vault, { session_id: 'keep-me', cwd, hook_event_name: 'Stop' });

    const snap = JSON.parse(readFileSync(join(agentsDir(vault), 'keep-me.json'), 'utf8'));
    expect(snap.state).toBe('complete');
    expect(snap.name).toBe('Claude Code');
    expect(snap.agentType).toBe('claude');
    expect(snap.project).toBe('app');
    expect(snap.action).toBe('Editing x.ts');
    expect(snap.tool).toBe('Edit');
    expect(snap.file).toBe('src/x.ts');
    expect(snap.stoppedAt).toBeGreaterThan(0);
  });

  it('still lets an explicit flag override on stop', () => {
    const vault = newVault();
    ping(vault, 'ov', ['--name=First', '--action=one']);
    ping(vault, 'ov', ['--stop', '--action=final']);
    const snap = JSON.parse(readFileSync(join(agentsDir(vault), 'ov.json'), 'utf8'));
    expect(snap.action).toBe('final');
    expect(snap.name).toBe('First');
  });

  it('does not resurrect stale activity on an ordinary ping', () => {
    // Only --stop inherits activity; a normal ping that omits --action clears it.
    const vault = newVault();
    ping(vault, 'clr', ['--action=one', '--file=a.ts']);
    ping(vault, 'clr', ['--state=reading']);
    const snap = JSON.parse(readFileSync(join(agentsDir(vault), 'clr.json'), 'utf8'));
    expect(snap.action).toBeNull();
    expect(snap.file).toBeNull();
    expect(snap.state).toBe('reading');
  });
});

describe('heartbeat.js records the working directory', () => {
  it('stores cwd so the plugin can match by resolved project directory', () => {
    // Matching on the cwd basename alone failed whenever a project's title differed
    // from its folder name — no orb, no conflict detection, silently.
    const vault = newVault();
    const cwd = join(vault, 'kebab-case-folder');
    hookPing(vault, { session_id: 'cwd-sess', cwd, tool_name: 'Read' });

    const snap = JSON.parse(readFileSync(join(agentsDir(vault), 'cwd-sess.json'), 'utf8'));
    expect(snap.cwd).toBe(cwd);
    expect(snap.project).toBe('kebab-case-folder');
  });

  it('keeps cwd across a stop ping', () => {
    const vault = newVault();
    const cwd = join(vault, 'app');
    hookPing(vault, { session_id: 'cwd-stop', cwd, tool_name: 'Edit' });
    hookPing(vault, { session_id: 'cwd-stop', cwd, hook_event_name: 'Stop' });
    expect(JSON.parse(readFileSync(join(agentsDir(vault), 'cwd-stop.json'), 'utf8')).cwd).toBe(cwd);
  });
});
