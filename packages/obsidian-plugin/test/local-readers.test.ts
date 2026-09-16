import { it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { load } from 'js-yaml';
vi.mock('obsidian', () => ({ parseYaml: (text: string) => load(text) }));
import { scanSkills } from '../src/utils/SkillsScanner';
import { SessionReader } from '../src/monitors/SessionReader';
function fixture(run: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypernovum-reader-test-'));
  try { run(dir); } finally {
    expect(path.dirname(dir)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dir).startsWith('hypernovum-reader-test-')).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
it('discovers both local conventions and parses folded/quoted YAML without conflating equal names', () => fixture(dir => {
  for (const provider of ['.agents', '.claude']) {
    const folder = path.join(dir, provider, 'skills/example'); fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'SKILL.md'), '---\nname: "Obsidian: helper"\ndescription: >-\n  Read notes\n  and preserve links.\n---\nInstructions');
  }
  const result = scanSkills(dir); expect(result).toHaveLength(2);
  expect(result[0].name).toBe('Obsidian: helper');
  expect(result[0].description).toBe('Read notes and preserve links.');
  expect(result[0].path).not.toBe(result[1].path);
}));
it('refreshes cached session evidence when a log grows and excludes oversized logs', () => fixture(dir => {
  const file = path.join(dir, 'one.jsonl');
  fs.writeFileSync(file, JSON.stringify({ t: 1000, sessionId: 'one', kind: 'session-start', project: 'app' }) + '\n');
  const reader = new SessionReader();
  expect(reader.readLatestForProject(dir, project => project === 'app')?.ended).toBe(false);
  fs.appendFileSync(file, JSON.stringify({ t: 2000, sessionId: 'one', kind: 'stop', project: 'app' }) + '\n');
  expect(reader.readLatestForProject(dir, project => project === 'app')?.ended).toBe(true);
  fs.truncateSync(file, 9 * 1024 * 1024);
  expect(reader.readLatestForProject(dir, () => true)).toBeNull();
}));
