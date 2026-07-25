#!/usr/bin/env node
/**
 * Version drift guard.
 *
 * The 0.4.0 release shipped with `packages/obsidian-plugin/manifest.json` still
 * on 0.3.0 while the root manifest said 0.4.0 — the release workflow validates
 * the PLUGIN manifest against the tag, and Obsidian's community-plugin bot reads
 * the ROOT manifest, so a mismatch breaks the release either way.
 *
 * The root `manifest.json` is the single source of truth. This script asserts
 * every other version site agrees with it, and (with --fix) rewrites them.
 *
 *   node scripts/check-versions.mjs           # verify, exit 1 on drift
 *   node scripts/check-versions.mjs --fix     # sync everything to root manifest
 *   node scripts/check-versions.mjs --tag=X   # also require the tag to match
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fix = process.argv.includes('--fix');
const tagArg = process.argv.find((a) => a.startsWith('--tag='));
const tag = tagArg ? tagArg.slice('--tag='.length) : null;

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));

const writeJson = (rel, value) => {
  fs.writeFileSync(path.join(repoRoot, rel), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const ROOT_MANIFEST = 'manifest.json';
const root = readJson(ROOT_MANIFEST);
const expected = root.version;
const expectedMinApp = root.minAppVersion;

if (!/^\d+\.\d+\.\d+$/.test(expected)) {
  console.error(`[check-versions] root manifest version "${expected}" is not semver x.y.z`);
  process.exit(1);
}

/** Every site that must carry the same version as the root manifest. */
const sites = [
  { rel: 'packages/obsidian-plugin/manifest.json', key: 'version' },
  { rel: 'packages/obsidian-plugin/package.json', key: 'version' },
  { rel: 'packages/core/package.json', key: 'version' },
];

const problems = [];

for (const site of sites) {
  const json = readJson(site.rel);
  if (json[site.key] === expected) continue;
  if (fix) {
    json[site.key] = expected;
    writeJson(site.rel, json);
    console.log(`[check-versions] fixed ${site.rel} ${site.key} -> ${expected}`);
  } else {
    problems.push(`${site.rel}: ${site.key} is "${json[site.key]}", expected "${expected}"`);
  }
}

// The plugin manifest is the file Obsidian actually installs — minAppVersion has
// to match the root manifest too, or users on old versions get a broken install.
const pluginManifest = readJson('packages/obsidian-plugin/manifest.json');
if (pluginManifest.minAppVersion !== expectedMinApp) {
  if (fix) {
    pluginManifest.minAppVersion = expectedMinApp;
    writeJson('packages/obsidian-plugin/manifest.json', pluginManifest);
    console.log(`[check-versions] fixed plugin manifest minAppVersion -> ${expectedMinApp}`);
  } else {
    problems.push(
      `packages/obsidian-plugin/manifest.json: minAppVersion is "${pluginManifest.minAppVersion}", expected "${expectedMinApp}"`,
    );
  }
}

// versions.json maps plugin version -> minAppVersion for Obsidian's installer.
const versions = readJson('versions.json');
if (versions[expected] !== expectedMinApp) {
  if (fix) {
    versions[expected] = expectedMinApp;
    writeJson('versions.json', versions);
    console.log(`[check-versions] fixed versions.json["${expected}"] -> ${expectedMinApp}`);
  } else {
    problems.push(
      `versions.json: missing or stale entry for "${expected}" (found "${versions[expected] ?? 'nothing'}", expected "${expectedMinApp}")`,
    );
  }
}

if (tag !== null && tag !== expected) {
  problems.push(`git tag "${tag}" does not match root manifest version "${expected}"`);
}

if (problems.length > 0) {
  console.error('[check-versions] version drift detected:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nRun `node scripts/check-versions.mjs --fix` after bumping manifest.json.');
  process.exit(1);
}

console.log(`[check-versions] all version sites agree: ${expected} (minAppVersion ${expectedMinApp})`);
