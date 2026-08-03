import * as fs from 'fs';
import * as path from 'path';

/** An agent skill discovered from a SKILL.md file (Claude Code / Agent Skills convention) */
export interface AgentSkill {
  name: string;
  description: string;
  /** Absolute path to the SKILL.md file */
  path: string;
}

/**
 * Scan the vault for agent skills following the SKILL.md convention:
 * `<vault>/.claude/skills/<name>/SKILL.md`.
 *
 * Vault-scoped on purpose. An earlier version also read `~/.claude/skills`,
 * which made an Obsidian plugin enumerate the user's whole home directory to
 * populate a panel — not a trade worth making. Read-only; failures return an
 * empty list rather than throwing.
 */
export function scanSkills(vaultPath: string): AgentSkill[] {
  const found: AgentSkill[] = [];
  collect(path.join(vaultPath, '.claude', 'skills'), found);

  const seen = new Set<string>();
  return found.filter((skill) => {
    if (seen.has(skill.name)) return false;
    seen.add(skill.name);
    return true;
  });
}

function collect(dir: string, out: AgentSkill[]): void {
  try {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(dir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) continue;
      out.push(parseSkill(skillPath, entry.name));
    }
  } catch {
    // Unreadable directory — skip silently
  }
}

function parseSkill(file: string, folderName: string): AgentSkill {
  let name = folderName;
  let description = '';
  try {
    const content = fs.readFileSync(file, 'utf8');
    const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fm) {
      const nameMatch = fm[1].match(/^name:\s*(.+)$/m);
      const descMatch = fm[1].match(/^description:\s*(.+)$/m);
      if (nameMatch) name = stripQuotes(nameMatch[1]);
      if (descMatch) description = stripQuotes(descMatch[1]);
    }
  } catch {
    // Unreadable file — fall back to folder name
  }
  return { name, description, path: file };
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '');
}
