// Post-build step: copy shaders into dist and stamp CORE_BUILD_VERSION.
// The source exports 'dev'; the dist artifact gets `<version>+<hash>.<date>`
// generated from git, so consumers (the pro app's vendored copy, the plugin's
// bundle) always carry a truthful, machine-generated build identity.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 1. Copy shaders
fs.mkdirSync(path.join(pkgDir, 'dist/shaders'), { recursive: true });
for (const f of ['building.vert', 'building.frag']) {
  fs.copyFileSync(path.join(pkgDir, 'src/shaders', f), path.join(pkgDir, 'dist/shaders', f));
}

// 2. Stamp CORE_BUILD_VERSION in dist
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
let hash = 'unknown';
try {
  hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: pkgDir }).toString().trim();
} catch { /* not a git checkout (e.g. tarball build) — keep 'unknown' */ }
const date = new Date().toISOString().slice(0, 10);
const stamp = `${pkg.version}+${hash}.${date}`;

let stamped = 0;
for (const file of ['dist/index.js', 'dist/index.d.ts']) {
  const p = path.join(pkgDir, file);
  const src = fs.readFileSync(p, 'utf8');
  const out = src.replace(/CORE_BUILD_VERSION(:? =?) (['"])dev\2/g, `CORE_BUILD_VERSION$1 $2${stamp}$2`);
  if (out !== src) {
    fs.writeFileSync(p, out);
    stamped++;
  }
}
if (stamped === 0) {
  console.error('[stamp-build] WARNING: CORE_BUILD_VERSION placeholder not found in dist');
  process.exit(1);
}
console.log(`[stamp-build] CORE_BUILD_VERSION = ${stamp} (${stamped} files)`);
