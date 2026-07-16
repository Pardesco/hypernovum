#!/usr/bin/env node
/**
 * Generate a synthetic project vault for performance testing (HRD-001 / §13).
 *
 *   node scripts/gen-test-vault.mjs --out ./perf-vault --count 100
 *
 * Writes N project notes with a frontmatter matrix over status / priority /
 * category / stack / tasks, plus a handful of blocked_by/depends_on edges so the
 * typed graph has something to render. Drop the output folder into an Obsidian
 * vault (or point Hypernovum at it) and use the S25 / M100 / L250 scenarios.
 *
 * Numbers must be recorded from a live run — this only builds the fixture.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function parseArgs(argv) {
  const p = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { p[key] = next; i++; } else p[key] = true;
  }
  return p;
}

const STATUS = ['active', 'blocked', 'paused', 'complete'];
const PRIORITY = ['critical', 'high', 'medium', 'low'];
const CATEGORY = ['web-apps', 'content', 'visualization', 'infrastructure', 'trading', 'obsidian-plugins', 'art', 'desktop-apps', 'research', 'personal'];
const STACKS = [['TypeScript', 'React'], ['Python'], ['Rust'], ['Three.js', 'Vite'], ['Go'], ['Blender'], ['C++']];

const args = parseArgs(process.argv.slice(2));
const outDir = resolve(args.out ?? './perf-vault');
const count = Number(args.count ?? 100);

mkdirSync(outDir, { recursive: true });

for (let i = 0; i < count; i++) {
  const status = STATUS[i % STATUS.length];
  const priority = PRIORITY[i % PRIORITY.length];
  const category = CATEGORY[i % CATEGORY.length];
  const stack = STACKS[i % STACKS.length];
  const total = (i % 12) + 1;
  const done = i % (total + 1);

  // Sprinkle a few typed-graph edges (every ~7th project depends on / is blocked by a prior one).
  const deps = i > 0 && i % 7 === 0 ? [`[[Project ${i - 1}]]`] : null;
  const blocked = i > 3 && i % 11 === 0 ? [`[[Project ${i - 3}]]`] : null;

  const fm = [
    '---',
    'tags: [project]',
    `title: "Project ${i}"`,
    `status: ${status}`,
    `priority: ${priority}`,
    `category: ${category}`,
    `stack: [${stack.join(', ')}]`,
    `tasks: ${total}`,
    `tasks_done: ${done}`,
    `health: ${(i * 37) % 100}`,
    deps ? `depends_on: ${JSON.stringify(deps)}` : null,
    blocked ? `blocked_by: ${JSON.stringify(blocked)}` : null,
    i % 5 === 0 ? 'questions:\n  - "What is the next milestone?"' : null,
    '---',
    '',
    `# Project ${i}`,
    '',
    `Synthetic project for performance testing (${status}, ${priority}, ${category}).`,
    '',
  ].filter((l) => l !== null).join('\n');

  writeFileSync(join(outDir, `Project ${i}.md`), fm);
}

console.log(`Generated ${count} project notes in ${outDir}`);
console.log('Scenarios: --count 25 (S25) · 100 (M100) · 250 (L250). Record FPS + filter/lens timings from a live run.');
