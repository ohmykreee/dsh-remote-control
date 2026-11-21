import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { defineConfig } from 'vite';

// The phone console source lives in `src/svelte` (entry: src/svelte/index.html).
// Vite public assets stay in `static/`, and the compiled page is written to
// `web/` for the Host service to serve. Both build-output paths are gitignored.

/**
 * Chunk layout for the console. Nothing here is lazy: every chunk is a static
 * import of the entry, so the browser downloads all of them with the first page
 * and keeps them. The split exists so an updated build only re-downloads the
 * chunks whose content actually changed, and so no single file gets big enough
 * for Vite to warn about it.
 *
 * Groups are resolved in priority order: third-party runtime first, then the
 * code several pages share, then the page chunks. Because every shared module is
 * claimed before the page groups run, a page chunk holds only that page and the
 * subcomponents no other page renders, and no chunk has to import another chunk
 * that imports it back.
 */
const groups = [
  // Third-party runtime, one chunk per library: a page edit never invalidates
  // the framework, and a dependency bump only touches its own chunk.
  { name: 'vendor-svelte', test: /node_modules[\\/]svelte[\\/]/, priority: 60 },
  { name: 'vendor-ui', test: /node_modules[\\/](bits-ui|runed|svelte-toolbelt|tabbable|@floating-ui|@internationalized|dequal|esm-env)[\\/]/, priority: 60 },
  { name: 'vendor-style', test: /node_modules[\\/](tailwind-variants|cn|clsx|tailwind-merge)[\\/]/, priority: 60 },
  { name: 'vendor-icons', test: /node_modules[\\/]@lucide[\\/]/, priority: 60 },
  // Everything else a page or the shell imports. `marked` / `dompurify` and
  // `photoswipe` are excluded so they stay in the chunks that actually use them;
  // stylesheets are left out so each one travels with the chunk that imports it.
  {
    name: 'vendor',
    test: (id) => /node_modules[\\/]/.test(id)
      && !/node_modules[\\/](marked|dompurify|photoswipe)[\\/]/.test(id)
      && !/\.css$/.test(id),
    priority: 55,
  },

  // Markdown rendering is only used by quick Q&A, but it is the biggest
  // dependency in the console and changes on its own schedule.
  { name: 'markdown', test: /node_modules[\\/](marked|dompurify)[\\/]/, priority: 50 },

  // App-wide singletons — WebSocket snapshot, i18n, quick Q&A state — import
  // each other in a cycle, so they have to stay in one chunk. `image-zoom.ts` is
  // left out on purpose: only quick Q&A reaches it, so it travels with that page
  // chunk together with PhotoSwipe's lightbox.
  {
    name: 'lib',
    test: (id) => /[\\/]src[\\/]svelte[\\/]lib[\\/][^\\/]+\.ts$/.test(id) && !/image-zoom\.ts$/.test(id),
    priority: 45,
  },

  // The card shell that every page but the iframe page is built from.
  { name: 'card', test: /[\\/]src[\\/]svelte[\\/]lib[\\/]components[\\/](Panel|SectionHeader|EmptyState)\.svelte$/, priority: 40 },

  // shadcn-svelte primitives: one chunk per primitive, so touching a dialog does
  // not invalidate the button or the scroll area.
  {
    name: (id) => {
      const folder = /[\\/]src[\\/]svelte[\\/]lib[\\/]components[\\/]ui[\\/]([^\\/]+)[\\/]/.exec(id);
      return folder ? `ui-${folder[1]}` : null;
    },
    test: /[\\/]src[\\/]svelte[\\/]lib[\\/]components[\\/]ui[\\/]/,
    priority: 30,
  },

  // One chunk per page. Subcomponents only that page renders follow through
  // recursive dependency capture (`HomePage` brings `ClockCard`, `WeatherPanel`,
  // …); anything another page shares was already claimed by the groups above.
  { name: 'page-home', test: /[\\/]src[\\/]svelte[\\/]lib[\\/]components[\\/]HomePage\.svelte$/, priority: 10 },
  { name: 'page-sessions', test: /[\\/]src[\\/]svelte[\\/]lib[\\/]components[\\/]SessionsPage\.svelte$/, priority: 10 },
  { name: 'page-quickqa', test: /[\\/]src[\\/]svelte[\\/]lib[\\/]components[\\/]QuickQaPage\.svelte$/, priority: 10 },
  { name: 'page-music', test: /[\\/]src[\\/]svelte[\\/]lib[\\/]components[\\/]MusicPage\.svelte$/, priority: 10 },
  { name: 'page-performance', test: /[\\/]src[\\/]svelte[\\/]lib[\\/]components[\\/]PerformancePage\.svelte$/, priority: 10 },
  { name: 'page-custom', test: /[\\/]src[\\/]svelte[\\/]lib[\\/]components[\\/]CustomPage\.svelte$/, priority: 10 },
];

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
    rolldownOptions: {
      output: {
        codeSplitting: { groups },
      },
    },
  },
});
