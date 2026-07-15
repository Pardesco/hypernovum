import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dirname, '..', 'heartbeat.js');

describe('heartbeat.js', () => {
  it('writes a parseable status file', () => {
    const vault = mkdtempSync(join(tmpdir(), 'hv-vault-'));
    execFileSync('node', [SCRIPT, `--vault=${vault}`, '--project=demo', '--action=editing']);

    const statusFile = join(vault, '.hypernovum-status.json');
    expect(existsSync(statusFile)).toBe(true);
    const status = JSON.parse(readFileSync(statusFile, 'utf8'));
    expect(status.active).toBe(true);
    expect(status.project).toBe('demo');
    expect(typeof status.lastPing).toBe('number');
  });

  it('marks activity stopped with --stop', () => {
    const vault = mkdtempSync(join(tmpdir(), 'hv-vault-'));
    execFileSync('node', [SCRIPT, `--vault=${vault}`, '--stop']);
    const status = JSON.parse(readFileSync(join(vault, '.hypernovum-status.json'), 'utf8'));
    expect(status.active).toBe(false);
  });
});
