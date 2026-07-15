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
