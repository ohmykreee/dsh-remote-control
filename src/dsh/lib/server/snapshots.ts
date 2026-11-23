/** Snapshot builders sent to the sidebar and to connected consoles. */

import type { MappedApp } from '../apps/index.js';
import type { QuickQaService } from '../quickqa/index.js';
import { readNodeCapability, readProbeCapability, readProfileName } from '../shared/runtime.js';
import { isRecord } from '../shared/types.js';
import type { WebSocketClientInfo } from '../shared/types.js';
import { serializeError, VERSION } from '../shared/util.js';
import { collectSessions, type SessionSummary } from '../sessions/index.js';
import type { InfoPayload, RemoteServer } from './remote.js';
import type { ServiceState } from './state.js';
import type { RemoteSettingsPayload } from './types.js';

type AccountSnapshot = Awaited<ReturnType<ServiceState['account']['getAccount']>>;
type WeatherSnapshot = Awaited<ReturnType<ServiceState['weather']['getWeather']>>;
type PerformanceSnapshot = Awaited<ReturnType<ServiceState['performance']['sample']>>;
type MediaSnapshot = Awaited<ReturnType<ServiceState['adapters']['media']['getState']>>;
type SessionList = SessionSummary[];

/** Filtered notification view built from a raw probe payload. */
export interface NotificationViewPayload {
  available: boolean;
  reason: string | null;
  liveOnly: boolean;
  notifications: import('../shared/types.js').NotificationItem[];
  apps: MappedApp[];
  enabledApps: string[];
  updatedAt: number;
}

/** Account view after the low-balance decoration is applied. */
export type AccountView = AccountSnapshot & { lowBalance: boolean; lowThreshold: number | null };

/** Degraded account payload used when the account service throws. */
export interface AccountFallback {
  available: false;
  signedIn: false;
  error: string;
  lowBalance: false;
  lowThreshold: null;
}

/** Degraded weather payload used when the weather service rejects. */
export interface WeatherFallback {
  ok: false;
  error: string;
}

/** Degraded performance payload used when sampling throws. */
export interface PerformanceFallback {
  ok: false;
  error: string;
  cpu: { usage: null; model: string; cores: null };
  memory: { total: null; used: null; percent: null };
  gpu: { ok: false; error: string };
  temperatures: unknown[];
  sampledAt: number;
}

/** Degraded media payload used when the adapter throws. */
export interface MediaFallback {
  ok: false;
  media: { ok: false; available: false; media: null; error: string };
  volume: { ok: false; volume: number; muted: boolean; error: string };
}

/** Notification payload used when the probe snapshot is unusable. */
export interface NotificationFallbackPayload {
  available: false;
  reason: string;
  notifications: import('../shared/types.js').NotificationItem[];
  apps: MappedApp[];
}

/** Aggregate snapshot sent to a phone when it (re)connects. */
export interface OverviewPayload {
  sessions: SessionList;
  sessionsError: string | null;
  weather: WeatherSnapshot | WeatherFallback;
  notifications: NotificationViewPayload | NotificationFallbackPayload;
  account: AccountView | AccountFallback;
  performance: PerformanceSnapshot | PerformanceFallback | null;
  settings: RemoteSettingsPayload;
}

/** Full settings-panel payload (settings + diagnostics). */
export interface SettingsPayload {
  ok: boolean;
  settings: ReturnType<ServiceState['settingsStore']['public']>;
  interfaces: ReturnType<RemoteServer['interfaceEntries']>;
  apps: MappedApp[];
  clients: WebSocketClientInfo[];
  info: InfoPayload;
  capabilities: {
    notifications: unknown;
    media: unknown;
    volume: unknown;
    weather: {
      ok: unknown;
      updatedAt: unknown;
      provider: string | null;
      requestedProvider: string;
      providerSwitched: boolean;
      quota: { month: string; used: number; limit: number; remaining: number; exhausted: boolean };
      configured: boolean;
      location: unknown;
      console: unknown;
      error: string | null;
    };
    probe: Awaited<ReturnType<typeof readProbeCapability>>;
    node: ReturnType<typeof readNodeCapability>;
  };
  diagnostics: {
    platform: NodeJS.Platform;
    platformLabel: string;
    version: string;
    running: boolean;
    protocol: 'http' | 'https';
    clientCount: number;
    notificationApps: number;
    profile: string;
  };
}

export interface SnapshotDeps {
  state: ServiceState;
  quickqa: QuickQaService;
  remote: RemoteServer;
  getClients(): WebSocketClientInfo[];
  getClientCount(): number;
}

export interface Snapshots {
  remoteSettings(): RemoteSettingsPayload;
  getNotificationsView(): Promise<NotificationViewPayload>;
  getWeatherView(): Promise<WeatherSnapshot>;
  getAccountView(): Promise<AccountView | AccountFallback>;
  getPerformanceView(force?: boolean): Promise<PerformanceSnapshot | PerformanceFallback>;
  consoleSessions(): Promise<SessionList>;
  buildOverview(): Promise<OverviewPayload>;
  buildMedia(): Promise<MediaSnapshot | MediaFallback>;
  getSettingsPayload(): Promise<SettingsPayload>;
}

/** New notification-source apps that are not covered by the saved allowlist. */
export function newNotificationApps(
  enabledApps: readonly string[],
  apps: ReadonlyArray<{ key?: string }>,
  isKnownNotificationApp: (key: string) => boolean,
): string[] {
  if (enabledApps.length === 0) return [];
  const seen = new Set(enabledApps);
  const additions: string[] = [];
  for (const app of apps) {
    const key = typeof app.key === 'string' ? app.key : '';
    if (!key || seen.has(key) || isKnownNotificationApp(key)) continue;
    seen.add(key);
    additions.push(key);
  }
  return additions;
}

export function createSnapshots(deps: SnapshotDeps): Snapshots {
  const { state, quickqa, remote } = deps;
  const settings = (): ReturnType<ServiceState['settingsStore']['get']> => state.settingsStore.get();
  let lastWeather: WeatherSnapshot | null = null;
  let performanceCache: PerformanceSnapshot | null = null;
  let performanceAt = 0;

  function remoteSettings(): RemoteSettingsPayload {
    const value = settings();
    return {
      theme: state.effectiveTheme(),
      locale: state.effectiveLocale(),
      temperatureUnit: value.temperatureUnit,
      notificationLimit: value.notifications.limit,
      pushQuestions: value.notifications.pushQuestions,
      navPosition: value.navPosition,
      balance: { ...value.balance },
      pomodoro: { ...value.pomodoro },
      countdown: {
        enabled: value.countdown.enabled,
        presets: [...value.countdown.presets],
      },
      tls: {
        enabled: value.tls.enabled,
        advanced: {
          wakeLock: value.tls.advanced.wakeLock,
        },
      },
      customPageUrl: value.customPageUrl,
      pageThemeColor: value.pageThemeColor,
      pageOrder: [...value.pageOrder],
      pageEnabled: { ...value.pageEnabled },
      quickqa: quickqa.remoteSettings(),
    };
  }

  function notificationView(raw: import('../shared/types.js').NotificationPayload): NotificationViewPayload {
    const value = settings();
    const enabled = new Set<string>(value.notifications.enabledApps);
    const apps = state.appMapping.list();
    const list = (Array.isArray(raw?.notifications) ? raw.notifications : [])
      .filter((item) => enabled.size === 0 || enabled.has(item.appKey ?? ''))
      .slice(0, value.notifications.limit)
      .map((item) => {
        const appName = state.appMapping.displayName(item.appKey ?? '');
        // The probe falls back to the raw app id when a toast has no text.
        const title = item.title && item.title !== item.appKey ? item.title : appName;
        return { ...item, appName, title };
      });
    return {
      available: raw?.available !== false,
      reason: raw?.reason || null,
      liveOnly: Boolean(raw?.liveOnly),
      notifications: list,
      apps,
      enabledApps: [...value.notifications.enabledApps],
      updatedAt: raw?.updatedAt || Date.now(),
    };
  }

  async function getNotificationsView(): Promise<NotificationViewPayload> {
    let raw: import('../shared/types.js').NotificationPayload;
    try {
      raw = await state.adapters.notifications.getNotifications();
    } catch (errorValue) {
      raw = { available: false, reason: serializeError(errorValue), notifications: [], apps: [] };
    }
    const enabledApps = settings().notifications.enabledApps;
    if (Array.isArray(raw.apps)) {
      const additions = newNotificationApps(
        enabledApps,
        raw.apps,
        (key) => state.appMapping.get(key)?.sources.includes('notification') === true,
      );
      if (additions.length > 0) {
        state.settingsStore.update({
          notifications: { enabledApps: [...enabledApps, ...additions] },
        });
      }
    }
    if (Array.isArray(raw.apps)) {
      state.appMapping.record(
        raw.apps.map((app) => ({ key: app.key, count: app.count })),
        'notification',
      );
    }
    return notificationView(raw);
  }

  async function getWeatherView(): Promise<WeatherSnapshot> {
    const value = settings();
    const result: WeatherSnapshot = await state.weather.getWeather();
    result.forecastMode = value.weather.forecastMode === 'daily' ? 'daily' : 'hourly';
    lastWeather = result;
    return result;
  }

  function decorateAccount(value: AccountSnapshot): AccountView {
    const configured: unknown = settings().balance.lowThreshold;
    const threshold = configured === null || configured === '' ? null : Number(configured);
    if (
      value?.signedIn &&
      isRecord(value.balance) &&
      Number.isFinite(Number(value.balance.balance)) &&
      threshold !== null &&
      Number.isFinite(threshold) &&
      threshold >= 0
    ) {
      return {
        ...value,
        lowBalance: Number(value.balance.balance) < threshold,
        lowThreshold: threshold,
      };
    }
    return { ...value, lowBalance: false, lowThreshold: null };
  }

  async function getAccountView(): Promise<AccountView | AccountFallback> {
    try {
      return decorateAccount(await state.account.getAccount());
    } catch (errorValue) {
      return {
        available: false,
        signedIn: false,
        error: serializeError(errorValue),
        lowBalance: false,
        lowThreshold: null,
      };
    }
  }

  async function getPerformanceView(force: boolean = false): Promise<PerformanceSnapshot | PerformanceFallback> {
    const now = Date.now();
    if (!force && performanceCache && now - performanceAt < 1600) return performanceCache;
    try {
      performanceCache = await state.performance.sample(force);
      performanceAt = now;
      return performanceCache;
    } catch (errorValue) {
      return {
        ok: false,
        error: serializeError(errorValue),
        cpu: { usage: null, model: '', cores: null },
        memory: { total: null, used: null, percent: null },
        gpu: { ok: false, error: serializeError(errorValue) },
        temperatures: [],
        sampledAt: now,
      };
    }
  }

  /** Session list sent to the phone, with question details only when enabled. */
  async function consoleSessions(): Promise<SessionList> {
    const sessions = await collectSessions(state.ctx, state.pending, state.effectiveLocale);
    if (settings().notifications.pushQuestions) return sessions;
    return sessions.map((session) => session.pending
      ? { ...session, pending: { ...session.pending, questions: [], answerable: false } }
      : session);
  }

  async function buildOverview(): Promise<OverviewPayload> {
    const enabled = settings().pageEnabled;
    const [weatherResult, notificationsResult, accountResult, performanceResult] = await Promise.allSettled([
      enabled.home ? getWeatherView() : Promise.resolve(null),
      enabled.home ? getNotificationsView() : Promise.resolve(null),
      enabled.sessions ? getAccountView() : Promise.resolve(null),
      enabled.performance ? getPerformanceView() : Promise.resolve(null),
    ]);
    let sessions: SessionList = [];
    let sessionsError: string | null = null;
    if (enabled.sessions) {
      try {
        sessions = await consoleSessions();
      } catch (errorValue) {
        sessionsError = serializeError(errorValue);
      }
    }
    return {
      sessions,
      sessionsError,
      weather:
        weatherResult.status === 'fulfilled' && weatherResult.value
          ? weatherResult.value
          : { ok: false, error: serializeError('reason' in weatherResult ? weatherResult.reason : undefined) },
      notifications:
        notificationsResult.status === 'fulfilled' && notificationsResult.value
          ? notificationsResult.value
          : {
              available: false,
              reason: serializeError('reason' in notificationsResult ? notificationsResult.reason : undefined),
              notifications: [],
              apps: [],
            },
      account:
        accountResult.status === 'fulfilled' && accountResult.value
          ? accountResult.value
          : {
              available: false,
              signedIn: false,
              error: serializeError('reason' in accountResult ? accountResult.reason : undefined),
              lowBalance: false,
              lowThreshold: null,
            },
      performance:
        performanceResult.status === 'fulfilled' && performanceResult.value
          ? performanceResult.value
          : null,
      settings: remoteSettings(),
    };
  }

  async function buildMedia(): Promise<MediaSnapshot | MediaFallback> {
    try {
      const value = await state.adapters.media.getState();
      const media = value.media?.media ?? null;
      if (media?.appId) {
        state.appMapping.record([{ key: media.appId }], 'music');
        media.appName = state.appMapping.displayName(media.appId);
      }
      return value;
    } catch (errorValue) {
      return {
        ok: false,
        media: { ok: false, available: false, media: null, error: serializeError(errorValue) },
        volume: { ok: false, volume: 0.5, muted: false, error: serializeError(errorValue) },
      };
    }
  }

  async function getSettingsPayload(): Promise<SettingsPayload> {
    const [notifications, probe] = await Promise.all([getNotificationsView(), readProbeCapability()]);
    // The system page reports the API used by the currently selected player;
    // refresh once instead of showing a stale/empty cache from before the last
    // phone poll.
    try {
      await state.adapters.media.getMedia(true);
    } catch {
      // The capability status below still exposes the failure.
    }
    const mediaStatus = state.adapters.media?.status?.() || {};
    const weatherStatus = state.weather.status();
    const info = remote.getInfo();
    return {
      ok: true,
      settings: state.settingsStore.public(),
      interfaces: remote.interfaceEntries(false),
      apps: state.appMapping.list(),
      clients: deps.getClients(),
      info,
      capabilities: {
        notifications: state.adapters.notifications?.status?.() || {},
        media: mediaStatus.media || {},
        volume: mediaStatus.volume || {},
        weather: {
          ok: lastWeather?.ok ?? null,
          updatedAt: lastWeather?.updatedAt ?? null,
          provider: weatherStatus.provider ?? weatherStatus.requestedProvider,
          requestedProvider: weatherStatus.requestedProvider,
          providerSwitched: weatherStatus.switchedByQuota,
          quota: weatherStatus.quota,
          configured: weatherStatus.configured,
          location: weatherStatus.location,
          console: weatherStatus.console,
          error: weatherStatus.error,
        },
        probe,
        node: readNodeCapability(),
      },
      diagnostics: {
        platform: state.adapters.platform,
        platformLabel: state.adapters.label,
        version: VERSION,
        running: info.running,
        protocol: info.protocol,
        clientCount: deps.getClientCount(),
        notificationApps: notifications.apps.length,
        profile: readProfileName(),
      },
    };
  }

  return {
    remoteSettings,
    getNotificationsView,
    getWeatherView,
    getAccountView,
    getPerformanceView,
    consoleSessions,
    buildOverview,
    buildMedia,
    getSettingsPayload,
  };
}
