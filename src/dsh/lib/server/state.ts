/**
 * Owned Host services and mutable runtime state for the remote console.
 *
 * Modules receive this object and read the services or callbacks they need;
 * keeping one owner avoids import cycles between the server, hub, routes, and
 * snapshot builders.
 */

import { createAccountService } from '../account/index.js';
import { createAppMapping } from '../apps/index.js';
import { createCacheStore } from '../cache/index.js';
import { createPerformanceService } from '../performance/index.js';
import { createPlatformAdapters } from '../platform/index.js';
import { createPendingTracker } from '../sessions/index.js';
import {
  createSettingsStore,
  resolveLocale,
  type PluginLocale,
} from '../settings/index.js';
import type { DshContext } from '../shared/types.js';
import { createWeatherService } from '../weather/index.js';

export interface RemoteControlOptions {
  log?: (message: string) => void;
  locale?: string;
}

export interface ServiceState {
  readonly ctx: DshContext;
  readonly log: (message: string) => void;
  readonly locale: string;
  readonly settingsStore: ReturnType<typeof createSettingsStore>;
  readonly cache: ReturnType<typeof createCacheStore>;
  readonly appMapping: ReturnType<typeof createAppMapping>;
  readonly pending: ReturnType<typeof createPendingTracker>;
  readonly weather: ReturnType<typeof createWeatherService>;
  readonly performance: ReturnType<typeof createPerformanceService>;
  readonly adapters: ReturnType<typeof createPlatformAdapters>;
  readonly account: ReturnType<typeof createAccountService>;
  readonly startedAt: number;
  /** True after the plugin's effect disposer ran. */
  disposed: boolean;
  /** Set by the hub once it exists; sessions pushes are best-effort. */
  onPendingChange: () => void;
  effectiveTheme(): string;
  effectiveLocale(): PluginLocale;
}

export function createServiceState(ctx: DshContext, options: RemoteControlOptions = {}): ServiceState {
  const log: (message: string) => void = options.log || (() => {});
  const settingsStore = createSettingsStore();
  const cache = createCacheStore(settingsStore.dir);
  const appMapping = createAppMapping(settingsStore.dir);
  const performance = createPerformanceService();
  let state!: ServiceState;
  const adapters = createPlatformAdapters({
    limit: 8,
    getLocale: () => state?.effectiveLocale?.() ?? 'zh',
  });
  const account = createAccountService(ctx, {
    locale: options.locale || 'zh',
    getSettings: settingsStore.get,
  });
  const startedAt = Date.now();
  const pending = createPendingTracker(ctx, {
    onChange: () => {
      try {
        state?.onPendingChange?.();
      } catch {
        /* pushing must never break the request path */
      }
    },
    getLocale: () => state?.effectiveLocale?.() ?? 'zh',
  });
  const weather = createWeatherService({
    getSettings: settingsStore.get,
    cache,
    getLocale: () => state?.effectiveLocale?.() ?? 'zh',
    log,
  });

  state = {
    ctx,
    log,
    locale: options.locale || 'zh',
    settingsStore,
    cache,
    appMapping,
    pending,
    weather,
    performance,
    adapters,
    account,
    startedAt,
    disposed: false,
    onPendingChange: () => {},
    effectiveTheme() {
      const value = settingsStore.get();
      return value.theme === 'dsh' ? value.dshTheme : value.theme;
    },
    effectiveLocale() {
      const value = settingsStore.get();
      return resolveLocale(value.language, value.dshLocale);
    },
  };
  return state;
}
