import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  publicDir: 'static',
  server: {
    watch: {
      ignored: ['**/.scratch/**', '**/web/**', '**/native/**'],
    },
  },
  build: {
    outDir: 'web',
    assetsDir: 'assets',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    assetsInlineLimit: 0,
  },
});
