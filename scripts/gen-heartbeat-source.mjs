#!/usr/bin/env node
/**
 * Embed scripts/heartbeat.js into the plugin bundle.
 *
 * Obsidian installs ONLY main.js / manifest.json / styles.css — it never clones
 * the repo. Everything the plugin generates (AGENTS.md, per-project SETUP.md,
 * the Claude Code hook JSON) used to point at `<vault>/scripts/heartbeat.js`,
 * which exists only in this repo, so the whole agent-presence layer was dead for
 * anyone who installed the plugin normally.
 *
 * Fix: bake the script into main.js as a string, and write it into the user's
 * vault at `.hypernovum/heartbeat.js` when they prepare the vault for agents.
 *
 * scripts/heartbeat.js stays the single source of truth. This generator is
 * idempotent and runs as part of `npm run build:plugin` / `npm run dev`; the
 * generated file is committed, and CI fails if it drifts.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(repoRoot, 'scripts', 'heartbeat.js');
const OUT_DIR = path.join(repoRoot, 'packages', 'obsidian-plugin', 'src', 'generated');
const OUT = path.join(OUT_DIR, 'heartbeatSource.ts');

// Normalise line endings to LF before embedding. Two reasons: a TS template
// literal normalises CRLF to LF at parse time anyway (so a CRLF checkout would
// never round-trip), and without this the generated file and its hash differ
// between a Windows checkout and CI's Linux one — which would break both the
// drift test and the `git diff --exit-code` guard in release.yml.
const source = fs.readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n');
const sha = crypto.createHash('sha256').update(source).digest('hex').slice(0, 12);

/** Escape for a TS template literal: backslashes, backticks, and `${`. */
const escaped = source
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${');

const out = `// GENERATED FILE — DO NOT EDIT.
// Source: scripts/heartbeat.js
// Regenerate: npm run gen:heartbeat
//
// Embedded so the plugin can write a working heartbeat script into the user's
// vault. See scripts/gen-heartbeat-source.mjs for why.

/** Short content hash of scripts/heartbeat.js — used to detect a stale copy in a vault. */
export const HEARTBEAT_SOURCE_SHA = '${sha}';

/** Verbatim contents of scripts/heartbeat.js. */
export const HEARTBEAT_SOURCE = \`${escaped}\`;
`;

fs.mkdirSync(OUT_DIR, { recursive: true });

const previous = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
if (previous === out) {
  console.log(`[gen-heartbeat] up to date (${sha})`);
} else {
  fs.writeFileSync(OUT, out, 'utf8');
  console.log(`[gen-heartbeat] wrote ${path.relative(repoRoot, OUT)} (${sha})`);
}
