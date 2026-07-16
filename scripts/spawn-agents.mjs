#!/usr/bin/env node
/**
 * Drive N synthetic agents against a vault for the fleet/perf scenarios
 * (HRD-001 §13 "4 concurrent agents pinging at 1Hz"). Each agent rotates through
 * projects/files/states via heartbeat v2, then stops on exit.
 *
 *   node scripts/spawn-agents.mjs --vault "C:/path/to/Vault" --agents 4 --duration 60
 *
 * Watch the city: you should see N named orbs, state transitions, and conflicts
 * when two agents land on the same file. Ctrl-C stops them early (each sends --stop).
 */

import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEARTBEAT = join(dirname(fileURLToPath(import.meta.url)), 'heartbeat.js');

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

const args = parseArgs(process.argv.slice(2));
const vault = args.vault ? resolve(args.vault) : null;
const agents = Number(args.agents ?? 4);
const durationMs = Number(args.duration ?? 60) * 1000;

if (!vault) {
  console.error('Usage: node scripts/spawn-agents.mjs --vault "<vault>" [--agents 4] [--duration 60]');
  process.exit(1);
}

const NAMES = ['Claude Code', 'Codex', 'Antigravity', 'Aider', 'Cursor', 'Cody'];
const STATES = ['reading', 'editing', 'running', 'testing', 'reviewing'];
// Overlapping file pool so two agents occasionally collide (conflict test).
const FILES = ['src/index.ts', 'src/app.ts', 'src/cart.ts', 'src/api.ts', 'README.md'];
const PROJECTS = ['Project 0', 'Project 1', 'Project 2', 'Project 3'];

function ping(id, i, tick) {
  execFileSync('node', [
    HEARTBEAT,
    `--vault=${vault}`,
    `--id=perf-${id}`,
    `--name=${NAMES[i % NAMES.length]}`,
    '--agent-type=claude',
    `--project=${PROJECTS[(i + tick) % PROJECTS.length]}`,
    `--state=${STATES[(i + tick) % STATES.length]}`,
    `--tool=Edit`,
    `--file=${FILES[(i * 2 + tick) % FILES.length]}`,
    `--action=synthetic tick ${tick}`,
  ]);
}

const ids = Array.from({ length: agents }, (_, i) => i);
let tick = 0;
const start = Date.now();

console.log(`Driving ${agents} agents against ${vault} for ${durationMs / 1000}s (Ctrl-C to stop early)…`);

const stopAll = () => {
  for (const i of ids) {
    try { execFileSync('node', [HEARTBEAT, `--vault=${vault}`, `--id=perf-${i}`, '--stop']); } catch {}
  }
  console.log('Agents stopped.');
  process.exit(0);
};
process.on('SIGINT', stopAll);

const timer = setInterval(() => {
  for (const i of ids) {
    try { ping(i, i, tick); } catch (e) { console.error(`agent ${i} ping failed:`, e.message); }
  }
  tick++;
  if (Date.now() - start >= durationMs) { clearInterval(timer); stopAll(); }
}, 1000);
