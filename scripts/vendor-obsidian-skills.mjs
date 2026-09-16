// Development-only vendor refresh. Runtime installation is entirely offline.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const commit = '3ccff5338ea700537839b21900aa5358a0402c98';
const names = ['obsidian-markdown', 'obsidian-bases', 'json-canvas'];
const root = path.resolve(import.meta.dirname, '..');
const response = await fetch(`https://api.github.com/repos/kepano/obsidian-skills/git/trees/${commit}?recursive=1`);
if (!response.ok) throw new Error(`GitHub tree ${response.status}`);
const tree = await response.json();
const files = tree.tree.filter(f => f.type === 'blob' && (f.path === 'LICENSE' || names.some(name => f.path.startsWith(`skills/${name}/`))));
const contents = {};
const hashes = {};
for (const file of files) {
  if (!/^[a-zA-Z0-9_./-]+$/.test(file.path) || file.path.includes('..')) throw new Error('Invalid upstream path');
  const result = await fetch(`https://raw.githubusercontent.com/kepano/obsidian-skills/${commit}/${file.path}`);
  if (!result.ok) throw new Error(`Download ${file.path}: ${result.status}`);
  const bytes = Buffer.from(await result.arrayBuffer());
  contents[file.path] = bytes.toString('utf8');
  hashes[file.path] = createHash('sha256').update(bytes).digest('hex');
}
if (!contents.LICENSE.includes('MIT License') || !contents.LICENSE.includes('Steph Ango')) throw new Error('License requires review');
const bundle = { repository: 'https://github.com/kepano/obsidian-skills', commit, license: 'MIT', names, hashes, files: contents };
const output = path.join(root, 'packages/obsidian-plugin/src/generated/obsidianSkills.ts');
fs.writeFileSync(output, '// Vendored MIT data; refresh with scripts/vendor-obsidian-skills.mjs. Do not edit manually.\nexport const OBSIDIAN_SKILLS = ' + JSON.stringify(bundle, null, 2) + ' as const;\n');
fs.writeFileSync(path.join(root, 'docs/OBSIDIAN-SKILLS-LICENSE.txt'), contents.LICENSE);
console.log(`Vendored ${files.length} files from ${commit}`);
console.log(JSON.stringify(hashes, null, 2));
