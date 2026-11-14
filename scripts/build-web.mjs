#!/usr/bin/env node
/**
 * Build the Svelte web console into `web/`.
 *
 * Vite is invoked programmatically rather than through `node_modules/.bin`, so
 * this runs the same way from a plain checkout and from any wrapper script that
 * has no bin shims on `PATH`.
 */

import { build } from 'vite';

try {
  await build();
} catch (error) {
  console.error(error);
  process.exit(1);
}
