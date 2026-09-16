import * as fs from 'fs';
import * as path from 'path';
import { parseYaml } from 'obsidian';

export interface AgentSkill { name: string; description: string; path: string; }
/** Only explicitly scoped local roots; never scan the user's home or follow links. */
export function scanSkills(vaultPath: string, projectPaths: string[] = []): AgentSkill[] {
  const found: AgentSkill[] = [];
  const roots = new Set([vaultPath, ...projectPaths].map(root => path.resolve(root)));
  for (const root of roots) {
    for (const provider of ['.agents', '.claude']) collect(path.join(root, provider, 'skills'), found);
  }
  const seen = new Set<string>();
  return found.filter(skill => { if (seen.has(skill.path)) return false; seen.add(skill.path); return true; });
}
function collect(dir: string, out: AgentSkill[]): void {
  try {
    if (!fs.existsSync(dir) || fs.lstatSync(dir).isSymbolicLink() || fs.lstatSync(path.dirname(dir)).isSymbolicLink()) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).slice(0, 256)) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name, 'SKILL.md');
      if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 128 * 1024) continue;
      const content = fs.readFileSync(file, 'utf8');
      const match = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      let metadata: Record<string, unknown> = {};
      try { const parsed: unknown = match ? parseYaml(match[1]) : null; if (parsed && typeof parsed === 'object') metadata = parsed as Record<string, unknown>; } catch { /* Display folder name for malformed metadata. */ }
      out.push({ name: typeof metadata.name === 'string' ? metadata.name : entry.name,
        description: typeof metadata.description === 'string' ? metadata.description.trim() : '', path: file });
    }
  } catch { /* Unreadable root is unavailable, not permission to scan elsewhere. */ }
}
