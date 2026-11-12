#!/usr/bin/env node
/**
 * Build the Svelte web console.
 *
 * Vite is invoked programmatically rather than through `node_modules/.bin`, so
 * this also works from a package postinstall where no bin shim is linked.
 */

import { build } from 'vite';

try {
  await build();
} catch (error) {
  console.error(error);
  process.exit(1);
}
