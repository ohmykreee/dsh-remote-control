import path from 'node:path';
import { defineConfig } from 'vitest/config';

// The phone-console unit tests only cover rune-free, DOM-free modules, so they
// run in plain Node without the Svelte plugin. If a test ever needs to import a
// `.svelte.ts` module, add `@sveltejs/vite-plugin-svelte` to `plugins` here.
export default defineConfig({
  resolve: {
    alias: {
      $lib: path.resolve(process.cwd(), 'src/svelte/lib'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/svelte/**/*.test.ts'],
  },
});
