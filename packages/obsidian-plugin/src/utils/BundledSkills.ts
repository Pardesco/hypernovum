import * as fs from 'fs';
import * as path from 'path';
import { OBSIDIAN_SKILLS } from '../generated/obsidianSkills';

/** Called only from an explicit local install action. No downloads or global writes. */
export function installObsidianSkills(vaultPath: string, provider: 'codex' | 'claude'): { installed: string[]; skipped: string[] } {
  const root = fs.realpathSync(vaultPath);
  const parts = [provider === 'codex' ? '.agents' : '.claude', 'skills'];
  let directory = root;
  for (const part of parts) {
    directory = path.join(directory, part);
    if (fs.existsSync(directory) && (fs.lstatSync(directory).isSymbolicLink() || !fs.statSync(directory).isDirectory())) {
      throw new Error('Skill destination must be a real directory inside this vault.');
    }
    fs.mkdirSync(directory, { recursive: true });
  }
  const installed: string[] = [], skipped: string[] = [];
  for (const name of OBSIDIAN_SKILLS.names) {
    const target = path.join(directory, name);
    // A custom/existing skill is never overwritten or merged with bundled files.
    if (fs.existsSync(target)) { skipped.push(name); continue; }
    fs.mkdirSync(target);
    const prefix = `skills/${name}/`;
    for (const [source, content] of Object.entries(OBSIDIAN_SKILLS.files)) {
      if (!source.startsWith(prefix)) continue;
      const relative = source.slice(prefix.length);
      if (relative.split('/').includes('..') || path.isAbsolute(relative)) throw new Error('Invalid bundled path');
      const dest = path.join(target, relative);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content, { flag: 'wx', encoding: 'utf8' });
    }
    fs.writeFileSync(path.join(target, 'LICENSE'), OBSIDIAN_SKILLS.files.LICENSE, { flag: 'wx', encoding: 'utf8' });
    fs.writeFileSync(path.join(target, 'HYPERNOVUM-SOURCE.json'), JSON.stringify({ repository: OBSIDIAN_SKILLS.repository, commit: OBSIDIAN_SKILLS.commit, license: 'MIT' }, null, 2), { flag: 'wx' });
    installed.push(name);
  }
  return { installed, skipped };
}
