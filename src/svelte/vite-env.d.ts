/// <reference types="svelte" />
/// <reference types="vite/client" />

import type { ConsoleState } from './lib/types';

declare global {
  interface Window {
    __DSH_REMOTE__?: ConsoleState;
    /** Local preview harness handle, seeded by `scripts/mock-preview.py`. */
    __DSH_QUICKQA__?: typeof import('./lib/quickqa.svelte')['quickQa'];
  }
}

export {};
