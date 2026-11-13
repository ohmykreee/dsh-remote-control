import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { defineConfig } from 'vite';

// The phone console source lives in `src/svelte` (entry: src/svelte/index.html).
// Vite public assets stay in `static/`, and the compiled page is written to
// `web/` for the Host service to serve. Both build-output paths are gitignored.
export default defineConfig({
  root: 'src/svelte',
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: {
      $lib: path.resolve('./src/svelte/lib'),
    },
  },
  publicDir: '../../static',
  server: {
    watch: {
      ignored: ['**/.scratch/**', '**/.build/**', '**/web/**', '**/native/**'],
    },
  },
  build: {
    outDir: '../../web',
    assetsDir: 'assets',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    assetsInlineLimit: 0,
  },
});
