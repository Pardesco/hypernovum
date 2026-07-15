import { defineConfig } from 'vitest/config';

// Node-environment tests only. Plugin UI (Obsidian API) is manually tested via
// docs/QA-CHECKLIST.md — the `obsidian` package cannot be imported here, so
// plugin-side tests are restricted to pure modules that don't import it.
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/core/test/**/*.test.ts',
      'packages/obsidian-plugin/test/**/*.test.ts',
      'scripts/test/**/*.test.mjs',
    ],
  },
});
