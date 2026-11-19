/**
 * Composition root for the remote console.
 *
 * Owns the settings/cache stores and wires the LAN server, snapshot builders,
 * WebSocket hub, Quick Q&A coordinator, and sidebar routes together. Individual
 * concerns live under `lib/server`, `lib/quickqa`, and the feature folders.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { shutdownProbeDaemon } from './probe/index.js';
import { createQuickQaService } from './quickqa/index.js';
import type { QuickQaService } from './quickqa/index.js';
import { certificateDomain } from './server/http.js';
import { createHubController } from './server/hub.js';
import type { HubController } from './server/hub.js';
import { createRemoteServer } from './server/remote.js';
import type { InfoPayload, RemoteServer } from './server/remote.js';
import { createSidebarRoutes } from './server/routes.js';
import type { SidebarRoutes } from './server/routes.js';
import { createSnapshots } from './server/snapshots.js';
import type { Snapshots } from './server/snapshots.js';
import { createServiceState, type RemoteControlOptions, type ServiceState } from './server/state.js';
import type { DshContext, JsonRecord } from './shared/types.js';
import { isRecord } from './shared/types.js';
import { serializeError } from './shared/util.js';

type SettingsValue = ReturnType<ServiceState['settingsStore']['get']>;

export type { InfoPayload } from './server/remote.js';
export type { InterfaceEntry, RemoteSettingsPayload, RemoteUrlEntry } from './server/types.js';
export type { SettingsPayload } from './server/snapshots.js';
export type { RemoteControlOptions } from './server/state.js';

/** The Host service surface consumed by `src/dsh/index.ts`. */
export interface RemoteControlService {
  start(): Promise<InfoPayload>;
  stop(): Promise<void>;
  restart(): Promise<InfoPayload>;
  getInfo(): InfoPayload;
  handleInfo(req: IncomingMessage, res: ServerResponse): Promise<void>;
  handleQr(req: IncomingMessage, res: ServerResponse): Promise<void>;
  handleSettingsGet(req: IncomingMessage, res: ServerResponse): Promise<void>;
  handleSettingsPost(req: IncomingMessage, res: ServerResponse): Promise<void>;
  handleAppNames(req: IncomingMessage, res: ServerResponse): Promise<void>;
  handleLocation(req: IncomingMessage, res: ServerResponse): Promise<void>;
  handleGeocode(req: IncomingMessage, res: ServerResponse): Promise<void>;
  handleQWeatherJwt(req: IncomingMessage, res: ServerResponse): Promise<void>;
  handleQWeatherKeyPair(req: IncomingMessage, res: ServerResponse): Promise<void>;
  handleQWeatherSync(req: IncomingMessage, res: ServerResponse): Promise<void>;
  handleWeatherRefresh(req: IncomingMessage, res: ServerResponse): Promise<void>;
  handleTheme(req: IncomingMessage, res: ServerResponse): Promise<void>;
  handleLocale(req: IncomingMessage, res: ServerResponse): Promise<void>;
  handleTokenRotate(req: IncomingMessage, res: ServerResponse): Promise<void>;
  handleDisconnect(req: IncomingMessage, res: ServerResponse): Promise<void>;
  handleQuickQaOptions(req: IncomingMessage, res: ServerResponse): Promise<void>;
  settingsStore: ServiceState['settingsStore'];
  applySettings(patch: JsonRecord): Promise<SettingsValue>;
  dispose(): void;
}

export function createRemoteControlService(
  ctx: DshContext,
  options: RemoteControlOptions = {},
): RemoteControlService {
  const state = createServiceState(ctx, options);
  const quickqa: QuickQaService = createQuickQaService({
    ctx,
    getSettings: state.settingsStore.get,
    pending: state.pending,
    log: state.log,
    getLocale: state.effectiveLocale,
  });

  let hub: HubController | null = null;
  const remote: RemoteServer = createRemoteServer(state, quickqa, () => hub?.info() ?? []);
  const snapshots: Snapshots = createSnapshots({
    state,
    quickqa,
    remote,
    getClients: () => hub?.info() ?? [],
    getClientCount: () => hub?.size() ?? 0,
  });
  hub = createHubController(state, snapshots, remote, quickqa);
  const routes: SidebarRoutes = createSidebarRoutes({
    state,
    snapshots,
    remote,
    hub,
    quickqa,
    applySettings,
  });

  async function applySettings(patch: JsonRecord): Promise<SettingsValue> {
    const before = state.settingsStore.get();
    const sanitized: JsonRecord = patch && typeof patch === 'object' ? { ...patch } : {};
    delete sanitized.token;
    delete sanitized.tokenRotatedAt;
    // Quick Q&A is gated by the official voice input plugin. Preserve the saved
    // quickqa settings while the plugin is not ready instead of letting a stale
    // page overwrite them.
    if ('quickqa' in sanitized && !quickqa.isVoiceReady()) {
      delete sanitized.quickqa;
    }
    const next = state.settingsStore.update(sanitized);
    const tlsChanged =
      before.tls.enabled !== next.tls.enabled
      || before.tls.certPath !== next.tls.certPath
      || before.tls.keyPath !== next.tls.keyPath;
    const authChanged = before.tokenEnabled !== next.tokenEnabled;
    const interfacesChanged = JSON.stringify(before.allowedInterfaces) !== JSON.stringify(next.allowedInterfaces);
    // A different QWeather project/credential is a different quota; start its
    // local counter from zero instead of carrying the previous account's usage.
    const qweatherIdentityChanged =
      before.weather.qweather.apiHost !== next.weather.qweather.apiHost ||
      before.weather.qweather.credentialId !== next.weather.qweather.credentialId ||
      before.weather.qweather.projectId !== next.weather.qweather.projectId ||
      before.weather.qweather.developerId !== next.weather.qweather.developerId;
    if (qweatherIdentityChanged) {
      state.cache.resetQWeatherUsage();
    }
    if (
      next.weather.qweather.syncConsole &&
      (!before.weather.qweather.syncConsole || qweatherIdentityChanged)
    ) {
      void state.weather.syncConsole();
    }
    if (authChanged || interfacesChanged) {
      hub?.closeAll('settings changed');
    }
    if (tlsChanged) {
      await restart();
    } else {
      remote.recomputeUrls();
    }
    hub?.pushSettings(true);
    if (next.pageEnabled.home) {
      if (JSON.stringify(before.notifications) !== JSON.stringify(next.notifications) || !before.pageEnabled.home) {
        void hub?.pushNotifications(true);
      }
      if (JSON.stringify(before.weather) !== JSON.stringify(next.weather) || !before.pageEnabled.home) {
        void hub?.pushWeather(true);
      }
    }
    if (next.pageEnabled.sessions) {
      if (JSON.stringify(before.balance) !== JSON.stringify(next.balance) || !before.pageEnabled.sessions) {
        void hub?.pushAccount(true);
        void hub?.pushSessions(true);
      }
      if (JSON.stringify(before.notifications) !== JSON.stringify(next.notifications)) {
        void hub?.pushSessions(true);
      }
    }
    if (next.pageEnabled.music && !before.pageEnabled.music) void hub?.pushMedia(true);
    if (next.pageEnabled.performance && !before.pageEnabled.performance) void hub?.pushPerformance(true);
    return next;
  }

  function initializeInterfaceSelection(): void {
    const value = state.settingsStore.get();
    if (value.interfacesInitialized) return;
    const names = [...new Set(remote.interfaceEntries(false).map((entry) => entry.name).filter(Boolean))];
    if (names.length === 0) return;
    const patch: Record<string, unknown> = { interfacesInitialized: true };
    if (value.allowedInterfaces === null) patch.allowedInterfaces = names;
    state.settingsStore.update(patch);
  }

  async function start(): Promise<InfoPayload> {
    if (state.disposed) return remote.getInfo();
    const info = await remote.start();
    initializeInterfaceSelection();
    const server = remote.getServer();
    if (server && state.disposed) {
      hub?.dispose();
      await remote.stop();
      return remote.getInfo();
    }
    if (server) hub?.attach(server);
    return info;
  }

  async function stop(): Promise<void> {
    await remote.stop();
  }

  async function restart(): Promise<InfoPayload> {
    if (state.disposed) return remote.getInfo();
    // The hub is tied to one listener object. Closing phones and detaching it
    // before the listener goes away lets the fresh server accept `/ws` again
    // right after a TLS change instead of staying dead until a plugin reload.
    hub?.closeAll('protocol changed');
    hub?.dispose();
    await remote.stop();
    return start();
  }

  return {
    start,
    stop,
    restart,
    getInfo: remote.getInfo,
    handleInfo: routes.handleInfo,
    handleQr: routes.handleQr,
    handleSettingsGet: routes.handleSettingsGet,
    handleSettingsPost: routes.handleSettingsPost,
    handleAppNames: routes.handleAppNames,
    handleLocation: routes.handleLocation,
    handleGeocode: routes.handleGeocode,
    handleQWeatherJwt: routes.handleQWeatherJwt,
    handleQWeatherKeyPair: routes.handleQWeatherKeyPair,
    handleQWeatherSync: routes.handleQWeatherSync,
    handleWeatherRefresh: routes.handleWeatherRefresh,
    handleTheme: routes.handleTheme,
    handleLocale: routes.handleLocale,
    handleTokenRotate: routes.handleTokenRotate,
    handleDisconnect: routes.handleDisconnect,
    handleQuickQaOptions: routes.handleQuickQaOptions,
    settingsStore: state.settingsStore,
    applySettings,
    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      quickqa.dispose();
      hub?.dispose();
      state.pending.dispose();
      state.adapters.dispose();
      state.appMapping.dispose();
      shutdownProbeDaemon();
      state.cache.flush();
      void remote.stop();
    },
  };
}

/** Kept exported for the existing certificate SAN test. */
export { certificateDomain };
