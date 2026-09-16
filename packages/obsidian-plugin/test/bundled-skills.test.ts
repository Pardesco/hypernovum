import { it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { installObsidianSkills } from '../src/utils/BundledSkills';
import { OBSIDIAN_SKILLS } from '../src/generated/obsidianSkills';
it('ships all pinned references with verified hashes and no executable hooks', () => {
  for (const [file, content] of Object.entries(OBSIDIAN_SKILLS.files)) {
    expect(createHash('sha256').update(content).digest('hex')).toBe(OBSIDIAN_SKILLS.hashes[file as keyof typeof OBSIDIAN_SKILLS.hashes]);
    expect(file === 'LICENSE' || file.endsWith('.md')).toBe(true);
    for (const match of content.matchAll(/\]\((references\/[^)]+)\)/g)) {
      expect(OBSIDIAN_SKILLS.files).toHaveProperty(`${path.posix.dirname(file)}/${match[1]}`);
    }
  }
});
it('installs offline with license and provenance, preserving existing custom skills', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypernovum-skills-test-'));
  try {
    const first = installObsidianSkills(dir, 'codex'); expect(first.installed).toHaveLength(3);
    const target = path.join(dir, '.agents/skills/obsidian-markdown');
    expect(fs.readFileSync(path.join(target, 'LICENSE'), 'utf8')).toContain('Steph Ango');
    fs.writeFileSync(path.join(target, 'SKILL.md'), 'custom');
    expect(installObsidianSkills(dir, 'codex').skipped).toHaveLength(3);
    expect(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe('custom');
    expect(installObsidianSkills(dir, 'claude').installed).toHaveLength(3);
  } finally {
    expect(path.dirname(dir)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dir).startsWith('hypernovum-skills-test-')).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
