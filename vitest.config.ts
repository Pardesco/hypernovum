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
  test: {
    environment: 'node',
    include: [
      'packages/core/test/**/*.test.ts',
      'packages/obsidian-plugin/test/**/*.test.ts',
      'scripts/test/**/*.test.mjs',
    ],
  },
});
