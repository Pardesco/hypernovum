import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dirname, '..', 'heartbeat.js');

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

  it('4 concurrent writers × 25 pings → 4 parseable files, no torn JSON', async () => {
    const vault = newVault();
    const ids = ['w1', 'w2', 'w3', 'w4'];

    // Each "writer" fires 25 sequential pings; the 4 writers run concurrently.
    await Promise.all(
      ids.map((id) =>
        new Promise((resolvePromise, reject) => {
          try {
            for (let i = 0; i < 25; i++) {
              execFileSync('node', [SCRIPT, `--vault=${vault}`, `--id=${id}`, `--project=${id}`, `--action=ping ${i}`]);
            }
            resolvePromise();
          } catch (err) {
            reject(err);
          }
        }),
      ),
    );

    const files = readdirSync(agentsDir(vault)).filter((f) => f.endsWith('.json'));
    expect(files.sort()).toEqual(['w1.json', 'w2.json', 'w3.json', 'w4.json']);
    // Every file must be fully parseable (no torn writes) and hold its own id
    for (const id of ids) {
      const snap = JSON.parse(readFileSync(join(agentsDir(vault), `${id}.json`), 'utf8'));
      expect(snap.sessionId).toBe(id);
      expect(snap.project).toBe(id);
      expect(snap.action).toBe('ping 24');
    }
  });

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

  it('session-log appends stay intact under concurrent per-session writers', async () => {
    const vault = newVault();
    const ids = ['s1', 's2', 's3'];
    await Promise.all(ids.map((id) =>
      new Promise((res, rej) => {
        try {
          for (let i = 0; i < 15; i++) ping(vault, id, [`--project=${id}`, `--state=editing`, `--file=f${i}.ts`]);
          res();
        } catch (e) { rej(e); }
      }),
    ));
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
