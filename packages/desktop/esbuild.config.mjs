import esbuild from 'esbuild';
import process from 'process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const prod = process.argv[2] === 'production';

// Node builtins to externalize for main/preload
const builtins = [
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns',
  'events', 'fs', 'http', 'http2', 'https', 'net', 'os', 'path', 'perf_hooks',
  'process', 'querystring', 'readline', 'stream', 'string_decoder', 'tls',
  'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
];

const distDir = path.resolve(__dirname, 'dist');
const rendererDir = path.join(distDir, 'renderer');
const tandemDir = path.join(distDir, 'tandem');

// Ensure output directories exist
fs.mkdirSync(path.join(distDir, 'main'), { recursive: true });
fs.mkdirSync(rendererDir, { recursive: true });
fs.mkdirSync(tandemDir, { recursive: true });

// Copy static assets to dist/renderer
fs.copyFileSync(
  path.resolve(__dirname, 'src/renderer/index.html'),
  path.join(rendererDir, 'index.html'),
);
fs.copyFileSync(
  path.resolve(__dirname, 'src/renderer/styles.css'),
  path.join(rendererDir, 'styles.css'),
);

// Copy tandem terminal assets
fs.copyFileSync(
  path.resolve(__dirname, 'src/tandem/index.html'),
  path.join(tandemDir, 'index.html'),
);
fs.copyFileSync(
  path.resolve(__dirname, 'src/tandem/styles.css'),
  path.join(tandemDir, 'styles.css'),
);
// Copy xterm CSS (may be hoisted to root node_modules in workspaces)
const xtermCssPaths = [
  path.resolve(__dirname, 'node_modules/@xterm/xterm/css/xterm.css'),
  path.resolve(__dirname, '../../node_modules/@xterm/xterm/css/xterm.css'),
];
for (const p of xtermCssPaths) {
  if (fs.existsSync(p)) {
    fs.copyFileSync(p, path.join(tandemDir, 'xterm.css'));
    break;
  }
}

// --- Main process bundle ---
await esbuild.build({
  entryPoints: [path.resolve(__dirname, 'src/main/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: path.join(distDir, 'main/index.js'),
  external: ['electron', 'node-pty', ...builtins],
  sourcemap: prod ? false : 'inline',
  minify: prod,
  logLevel: 'info',
});

// --- Preload bundle ---
await esbuild.build({
  entryPoints: [path.resolve(__dirname, 'src/preload.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: path.join(distDir, 'preload.js'),
  external: ['electron', ...builtins],
  sourcemap: prod ? false : 'inline',
  minify: prod,
  logLevel: 'info',
});

// --- Renderer bundle ---
await esbuild.build({
  entryPoints: [path.resolve(__dirname, 'src/renderer/index.tsx')],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2020',
  outfile: path.join(rendererDir, 'index.js'),
  external: ['electron'],
  // @hypervault/core is NOT external — bundled inline (same as plugin)
  sourcemap: prod ? false : 'inline',
  minify: prod,
  logLevel: 'info',
  loader: {
    '.vert': 'text',
    '.frag': 'text',
  },
  jsx: 'automatic',
});

// --- Tandem preload bundle ---
await esbuild.build({
  entryPoints: [path.resolve(__dirname, 'src/tandem/preload.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: path.join(tandemDir, 'preload.js'),
  external: ['electron', ...builtins],
  sourcemap: prod ? false : 'inline',
  minify: prod,
  logLevel: 'info',
});

// --- Tandem renderer bundle ---
await esbuild.build({
  entryPoints: [path.resolve(__dirname, 'src/tandem/renderer.ts')],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2020',
  outfile: path.join(tandemDir, 'index.js'),
  external: ['electron'],
  sourcemap: prod ? false : 'inline',
  minify: prod,
  logLevel: 'info',
});

console.log('Desktop build complete.');
