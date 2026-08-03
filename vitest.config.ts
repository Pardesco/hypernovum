import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Node-environment tests only. Plugin UI (Obsidian API) is manually tested via
// docs/QA-CHECKLIST.md — the `obsidian` package cannot be imported here, so
// plugin-side tests either stay in pure modules or vi.mock('obsidian').
export default defineConfig({
  plugins: [
    {
      // esbuild inlines .vert/.frag as text (see esbuild.config.mjs `loader`);
      // mirror that here so modules importing shaders load under vitest.
      name: 'glsl-as-string',
      transform(code, id) {
        if (id.endsWith('.vert') || id.endsWith('.frag')) {
          return { code: `export default ${JSON.stringify(code)};`, map: null };
        }
      },
    },
  ],
  resolve: {
    alias: {
      // Tests exercise core's SOURCE, never its build output. `tsc` does not
      // copy .vert/.frag into dist, so anything importing BuildingShader
      // through the package entry point resolves a shader path that only
      // exists if a stale dist happens to be lying around — which is why the
      // fleet-overview test passed locally and failed on CI's clean build.
      // Aliasing to source also means the glsl-as-string transform above
      // always applies, and tests can never pass against a stale build.
      '@hypernovum/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: [
      'packages/core/test/**/*.test.ts',
      'packages/obsidian-plugin/test/**/*.test.ts',
      'scripts/test/**/*.test.mjs',
    ],
  },
});
