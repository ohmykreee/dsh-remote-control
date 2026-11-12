/// <reference types="svelte" />
/// <reference types="vite/client" />

import type { ConsoleState } from './lib/types';

declare global {
  interface Window {
    __DSH_REMOTE__?: ConsoleState;
  }
}

export {};
