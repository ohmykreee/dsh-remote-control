/** Connected consoles, live snapshot pushes, and socket commands. */

import type { IncomingMessage } from 'node:http';
import { hostMessage } from '../i18n/index.js';
import type { QuickQaService } from '../quickqa/index.js';
import type { PendingAnswer } from '../sessions/index.js';
import { parsePendingAnswer } from '../sessions/index.js';
import { isRecord, type WebSocketClient, type WebSocketHub } from '../shared/types.js';
import { finiteNumber, safeString, serializeError } from '../shared/util.js';
import type { InfoPayload, RemoteServer } from './remote.js';
import type { ServiceState } from './state.js';
import type { Snapshots } from './snapshots.js';
import { createWebSocketHub } from './ws.js';

export interface HubController {
  attach(server: NonNullable<ReturnType<RemoteServer['getServer']>>): void;
  info(): ReturnType<WebSocketHub['info']>;
  size(): number;
  pushSettings(force?: boolean): void;
  pushClients(): void;
  pushSessions(force?: boolean): Promise<void>;
  pushNotifications(force?: boolean): Promise<void>;
  pushAccount(force?: boolean): Promise<void>;
  pushWeather(force?: boolean): Promise<void>;
  pushMedia(force?: boolean): Promise<void>;
  pushPerformance(force?: boolean): Promise<void>;
  closeAll(reason?: string): void;
  close(id: string, reason?: string): void;
  dispose(): void;
}

export function createHubController(
  state: ServiceState,
  snapshots: Snapshots,
  remote: RemoteServer,
  quickqa: QuickQaService,
): HubController {
  let hub: WebSocketHub | null = null;
  let loops: NodeJS.Timeout[] | null = null;
  const lastSnapshots = new Map<string, string>();
  let notificationsBusy = false;
  let mediaBusy = false;
  let accountBusy = false;
  let weatherBusy = false;
  let performanceBusy = false;
  const settings = (): ReturnType<ServiceState['settingsStore']['get']> => state.settingsStore.get();
  let lastVoiceReady: boolean | null = null;

  function push(type: string, data: unknown, force: boolean = false): void {
    if (!hub || hub.size() === 0) return;
    let serialized: string;
    try {
      serialized = JSON.stringify(data);
    } catch {
      return;
    }
    if (!force && lastSnapshots.get(type) === serialized) return;
    lastSnapshots.set(type, serialized);
    hub.broadcast({ type, data });
  }

  async function pushSessions(force: boolean = false): Promise<void> {
    if (!hub || hub.size() === 0 || !settings().pageEnabled.sessions) return;
    let sessions: Awaited<ReturnType<Snapshots['consoleSessions']>> = [];
    try {
      sessions = await snapshots.consoleSessions();
    } catch {
      return;
    }
    push('sessions', sessions, force);
  }

  async function pushNotifications(force: boolean = false): Promise<void> {
    if (!hub || hub.size() === 0 || notificationsBusy || !settings().pageEnabled.home) return;
    notificationsBusy = true;
    try {
      const view = await snapshots.getNotificationsView();
      push('notifications', view, force);
    } finally {
      notificationsBusy = false;
    }
  }

  async function pushAccount(force: boolean = false): Promise<void> {
    if (!hub || hub.size() === 0 || accountBusy || !settings().pageEnabled.sessions) return;
    accountBusy = true;
    try {
      const value = await snapshots.getAccountView();
      push('account', value, force);
    } finally {
      accountBusy = false;
    }
  }

  async function pushWeather(force: boolean = false): Promise<void> {
    if (!hub || hub.size() === 0 || weatherBusy || !settings().pageEnabled.home) return;
    weatherBusy = true;
    try {
      const value = await snapshots.getWeatherView();
      push('weather', value, force);
    } finally {
      weatherBusy = false;
    }
  }

  async function pushMedia(force: boolean = false): Promise<void> {
    if (!hub || hub.size() === 0 || mediaBusy || !settings().pageEnabled.music) return;
    mediaBusy = true;
    try {
      const value = await snapshots.buildMedia();
      push('media', value, force);
    } finally {
      mediaBusy = false;
    }
  }

  async function pushPerformance(force: boolean = false): Promise<void> {
    if (!hub || hub.size() === 0 || performanceBusy) return;
    if (!settings().pageEnabled.performance) return;
    performanceBusy = true;
    try {
      const value = await snapshots.getPerformanceView(force);
      push('performance', value, force);
    } finally {
      performanceBusy = false;
    }
  }

  function pushSettings(force: boolean = false): void {
    push('settings', snapshots.remoteSettings(), force);
  }

  function pushClients(): void {
    if (!hub) return;
    push('clients', hub.info(), true);
  }

  function startLoops(): void {
    if (loops) return;
    loops = [
      setInterval(() => {
        if (!hub || hub.size() === 0) {
          stopLoops();
          return;
        }
        if (!settings().pageEnabled.sessions) return;
        void pushSessions();
      }, 1500),
      setInterval(() => {
        if (!hub || hub.size() === 0) return;
        if (!settings().pageEnabled.home) return;
        void pushNotifications();
      }, 2500),
      setInterval(() => {
        if (!hub || hub.size() === 0) return;
        if (!settings().pageEnabled.music) return;
        void pushMedia();
      }, 2200),
      setInterval(() => {
        if (!hub || hub.size() === 0) return;
        if (!settings().pageEnabled.sessions) return;
        void pushAccount();
      }, 30_000),
      setInterval(() => {
        if (!hub || hub.size() === 0) return;
        if (!settings().pageEnabled.home) return;
        void pushWeather();
      }, 5 * 60_000),
      setInterval(() => {
        if (!hub || hub.size() === 0) return;
        if (!settings().pageEnabled.performance) return;
        void pushPerformance();
      }, 2500),
      setInterval(() => {
        if (!hub || hub.size() === 0) return;
        // The official voice input plugin prepares asynchronously; publish a
        // settings snapshot when its readiness flips so the quick page can
        // enable or disable itself without a reconnect.
        const ready = quickqa.isVoiceReady();
        if (lastVoiceReady === null) lastVoiceReady = ready;
        else if (ready !== lastVoiceReady) {
          lastVoiceReady = ready;
          pushSettings(true);
        }
      }, 4000),
    ];
    for (const timer of loops) timer.unref?.();
  }

  function stopLoops(): void {
    if (!loops) return;
    for (const timer of loops) clearInterval(timer);
    loops = null;
  }

  async function sendInitial(client: WebSocketClient): Promise<void> {
    try {
      client.send({ type: 'welcome', settings: snapshots.remoteSettings() });
      const enabled = settings().pageEnabled;
      const [overview, media, performanceView] = await Promise.all([
        snapshots.buildOverview(),
        enabled.music ? snapshots.buildMedia() : Promise.resolve(null),
        enabled.performance ? snapshots.getPerformanceView() : Promise.resolve(null),
      ]);
      client.send({ type: 'overview', data: overview });
      lastSnapshots.set('overview', JSON.stringify(overview));
      if (media) {
        client.send({ type: 'media', data: media });
        lastSnapshots.set('media', JSON.stringify(media));
      }
      if (performanceView) {
        client.send({ type: 'performance', data: performanceView });
        lastSnapshots.set('performance', JSON.stringify(performanceView));
      }
      client.send({ type: 'clients', data: hub?.info?.() ?? [] });
    } catch (errorValue) {
      client.send({ type: 'error', error: serializeError(errorValue) });
    }
  }

  async function handleSocketMessage(client: WebSocketClient, message: unknown): Promise<void> {
    if (!isRecord(message)) return;
    if (message.type === 'quickqa-ask' || message.type === 'quickqa-stop' || message.type === 'quickqa-reset') {
      await quickqa.handleMessage(client, message);
      return;
    }
    if (message.type === 'action') {
      const action = safeString(message.action, 40).toLowerCase();
      if (!['playpause', 'next', 'previous', 'seek', 'like', 'volume', 'mute'].includes(action)) {
        client.send({ type: 'action-result', ok: false, action, error: 'Unsupported action' });
        return;
      }
      try {
        const value =
          action === 'like'
            ? message.value === true
              ? true
              : message.value === false
                ? false
                : null
            : finiteNumber(message.value, null);
        await state.adapters.media.control(action, value);
        client.send({ type: 'action-result', ok: true, action });
        await pushMedia(true);
      } catch (errorValue) {
        client.send({ type: 'action-result', ok: false, action, error: serializeError(errorValue) });
      }
      return;
    }
    if (message.type === 'refresh') {
      await sendInitial(client);
      return;
    }
    if (message.type === 'settings') {
      client.send({ type: 'settings', data: snapshots.remoteSettings() });
      return;
    }
    if (message.type === 'answer-question') {
      const sessionId = safeString(message.sessionId, 200);
      const requestId = safeString(message.requestId, 200);
      if (!settings().notifications.pushQuestions) {
        client.send({
          type: 'answer-result',
          ok: false,
          sessionId,
          requestId,
          error: hostMessage(state.effectiveLocale(), 'answerPushOff'),
        });
        return;
      }
      const answer: PendingAnswer | null = parsePendingAnswer(message);
      if (!sessionId || !requestId || !answer) {
        client.send({
          type: 'answer-result',
          ok: false,
          sessionId,
          requestId,
          error: hostMessage(state.effectiveLocale(), 'answerInvalid'),
        });
        return;
      }
      const result = await state.pending.respond(sessionId, requestId, answer);
      client.send({ type: 'answer-result', ok: result.ok, sessionId, requestId, error: result.error });
      if (result.ok) await pushSessions(true);
      return;
    }
    if (message.type === 'ping') {
      client.send({ type: 'pong' });
    }
  }

  function attach(server: NonNullable<ReturnType<RemoteServer['getServer']>>): void {
    // A TLS change replaces the LAN listener. The previous hub owns the old
    // server's `upgrade` listener and its clients, so drop it before wiring the
    // new one; otherwise `/ws` would never accept a wss handshake again.
    hub?.dispose();
    hub = createWebSocketHub({
      server,
      path: '/ws',
      authorize: (req: IncomingMessage, url: URL) => remote.authorizeSocket(req, url),
      onConnection(client: WebSocketClient): void {
        startLoops();
        pushClients();
        void sendInitial(client);
      },
      onMessage(client: WebSocketClient, message: unknown): void {
        void handleSocketMessage(client, message);
      },
      onClose(client: WebSocketClient): void {
        quickqa.detach(client.id);
        if (!hub || hub.size() === 0) stopLoops();
        pushClients();
      },
    });
  }

  state.onPendingChange = () => {
    void pushSessions(true);
  };

  return {
    attach,
    info: () => hub?.info?.() ?? [],
    size: () => hub?.size?.() ?? 0,
    pushSettings,
    pushClients,
    pushSessions,
    pushNotifications,
    pushAccount,
    pushWeather,
    pushMedia,
    pushPerformance,
    closeAll(reason?: string) {
      hub?.closeAll(reason);
    },
    close(id: string, reason?: string) {
      hub?.close(id, reason);
    },
    dispose() {
      stopLoops();
      hub?.dispose();
      hub = null;
    },
  };
}
