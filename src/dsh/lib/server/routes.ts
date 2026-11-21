/** Loopback-only routes consumed by the DSH sidebar settings page. */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { generateQWeatherJwt, generateQWeatherKeyPair } from '../weather/qweather.js';
import { probeInfo, runProbe } from '../probe/index.js';
import { qrSvg } from '../shared/qr.js';
import type { WeatherOverride } from '../shared/types.js';
import { isRecord } from '../shared/types.js';
import { finiteNumber, safeString, serializeError } from '../shared/util.js';
import { normalizeDshLocale } from '../settings/index.js';
import { jsonResponse, readBody, sameOrigin, textResponse } from './http.js';
import type { HubController } from './hub.js';
import type { QuickQaService } from '../quickqa/index.js';
import type { RemoteServer } from './remote.js';
import type { Snapshots, SettingsPayload } from './snapshots.js';
import type { ServiceState } from './state.js';

export interface SidebarRoutes {
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
}

export interface SidebarRouteDeps {
  state: ServiceState;
  snapshots: Snapshots;
  remote: RemoteServer;
  hub: HubController;
  quickqa: QuickQaService;
  applySettings(patch: Record<string, unknown>): Promise<ReturnType<ServiceState['settingsStore']['get']>>;
}

export function createSidebarRoutes(deps: SidebarRouteDeps): SidebarRoutes {
  const { state, snapshots, remote, hub, quickqa } = deps;
  const settings = (): ReturnType<ServiceState['settingsStore']['get']> => state.settingsStore.get();

  async function handleInfo(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    jsonResponse(res, 200, remote.getInfo());
  }

  async function handleSettingsGet(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    jsonResponse(res, 200, await snapshots.getSettingsPayload());
  }

  async function handleSettingsPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!sameOrigin(req)) {
      jsonResponse(res, 403, { ok: false, error: 'origin rejected' });
      return;
    }
    try {
      const body = await readBody(req);
      await deps.applySettings(body);
      jsonResponse(res, 200, await snapshots.getSettingsPayload());
    } catch (errorValue) {
      jsonResponse(res, 400, { ok: false, error: serializeError(errorValue) });
    }
  }

  /**
   * Rename one observed application (the "app mapping" settings tab). An empty
   * name clears the override and returns to the built-in/default name.
   */
  async function handleAppNames(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!sameOrigin(req)) {
      jsonResponse(res, 403, { ok: false, error: 'origin rejected' });
      return;
    }
    try {
      const body = await readBody(req);
      const key = safeString(body?.key, 240).trim();
      const name = typeof body?.name === 'string' ? body.name : null;
      if (!key) {
        jsonResponse(res, 400, { ok: false, error: 'application key is required' });
        return;
      }
      const updated = state.appMapping.rename(key, name);
      if (!updated) {
        jsonResponse(res, 404, { ok: false, error: 'application has not been recorded yet' });
        return;
      }
      void hub.pushNotifications(true);
      void hub.pushMedia(true);
      jsonResponse(res, 200, await snapshots.getSettingsPayload());
    } catch (errorValue) {
      jsonResponse(res, 400, { ok: false, error: serializeError(errorValue) });
    }
  }

  /**
   * Ask the OS for location permission. On Windows this opens the privacy
   * settings page when access is denied; a successful grant drops the cached
   * weather coordinates so the next snapshot uses the real position.
   */
  async function handleLocation(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!sameOrigin(req)) {
      jsonResponse(res, 403, { ok: false, error: 'origin rejected' });
      return;
    }
    try {
      const body = await readBody(req);
      const probe = probeInfo();
      if (!probe.available) {
        jsonResponse(res, 503, { ok: false, error: probe.error || 'native probe unavailable' });
        return;
      }
      const args = ['location', 'request'];
      if (body?.openSettings !== false) args.push('--open-settings');
      const raw = await runProbe(args, { timeout: 20_000 });
      const result = isRecord(raw) ? raw : {};
      const allowed = result.allowed === true || result.access === 'allowed';
      if (allowed) {
        state.weather.resetLocation();
        void hub.pushWeather(true);
      }
      jsonResponse(res, 200, {
        ok: true,
        allowed,
        access: safeString(result.access, 40) || 'unknown',
        lowIntegrity: result.lowIntegrity === true,
        openedSettings: result.openedSettings === true,
        reason: safeString(result.reason, 60) || null,
        sampledAt: Date.now(),
      });
    } catch (errorValue) {
      jsonResponse(res, 502, { ok: false, error: serializeError(errorValue) });
    }
  }

  /**
   * Forward geocoding for the weather settings city picker. GET uses the saved
   * provider; POST accepts the provider and QWeather credentials currently being
   * edited so the city search works before "save settings" is pressed.
   */
  async function handleGeocode(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method;
    if (method !== 'GET' && method !== 'POST') {
      jsonResponse(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }
    let query = '';
    const override: WeatherOverride = {};
    try {
      if (method === 'POST') {
        if (!sameOrigin(req)) {
          jsonResponse(res, 403, { ok: false, error: 'origin rejected' });
          return;
        }
        const body = await readBody(req);
        query = safeString(body.q, 120).trim();
        const provider = body.provider;
        if (provider === 'nmc' || provider === 'open-meteo' || provider === 'qweather') {
          override.provider = provider;
        }
        const qweather = isRecord(body.qweather) ? body.qweather : null;
        if (qweather) {
          override.qweather = {
            apiHost: safeString(qweather.apiHost, 120),
            credentialId: safeString(qweather.credentialId, 120),
            projectId: safeString(qweather.projectId, 120),
            developerId: safeString(qweather.developerId, 120),
            privateKey: safeString(qweather.privateKey, 16_384),
            monthlyLimit: finiteNumber(qweather.monthlyLimit, 47_500),
            refreshMinutes: finiteNumber(qweather.refreshMinutes, 30),
          };
        }
      } else {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        query = safeString(url.searchParams.get('q') || '', 120).trim();
      }
    } catch (errorValue) {
      jsonResponse(res, 400, { ok: false, error: serializeError(errorValue) });
      return;
    }
    if (!query) {
      jsonResponse(res, 400, { ok: false, error: 'query is required' });
      return;
    }
    try {
      const results = await state.weather.searchCities(query, 8, override);
      jsonResponse(res, 200, { ok: true, query, results, updatedAt: Date.now() });
    } catch (errorValue) {
      state.log(`geocode "${query}" failed: ${serializeError(errorValue)}`);
      jsonResponse(res, 502, { ok: false, error: serializeError(errorValue) });
    }
  }

  /** Generate a JWT from the credentials currently typed in the settings page. */
  async function handleQWeatherJwt(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      jsonResponse(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }
    if (!sameOrigin(req)) {
      jsonResponse(res, 403, { ok: false, error: 'origin rejected' });
      return;
    }
    try {
      const body = await readBody(req);
      const generated = generateQWeatherJwt({
        credentialId: safeString(body.credentialId, 120),
        projectId: safeString(body.projectId, 120),
        developerId: safeString(body.developerId, 120),
        privateKey: safeString(body.privateKey, 16_384),
      });
      jsonResponse(res, 200, { ok: true, ...generated });
    } catch (errorValue) {
      jsonResponse(res, 400, { ok: false, error: serializeError(errorValue) });
    }
  }

  /** Create a fresh Ed25519 key pair for the first-time QWeather setup. */
  async function handleQWeatherKeyPair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      jsonResponse(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }
    if (!sameOrigin(req)) {
      jsonResponse(res, 403, { ok: false, error: 'origin rejected' });
      return;
    }
    try {
      jsonResponse(res, 200, { ok: true, ...generateQWeatherKeyPair() });
    } catch (errorValue) {
      jsonResponse(res, 500, { ok: false, error: serializeError(errorValue) });
    }
  }

  async function handleQWeatherSync(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      jsonResponse(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }
    if (!sameOrigin(req)) {
      jsonResponse(res, 403, { ok: false, error: 'origin rejected' });
      return;
    }
    try {
      const snapshot = await state.weather.syncConsole();
      jsonResponse(res, 200, { ok: true, console: snapshot });
    } catch (errorValue) {
      jsonResponse(res, 400, { ok: false, error: serializeError(errorValue) });
    }
  }

  async function handleWeatherRefresh(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      jsonResponse(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }
    if (!sameOrigin(req)) {
      jsonResponse(res, 403, { ok: false, error: 'origin rejected' });
      return;
    }
    try {
      state.weather.refreshLocation();
      await state.weather.getWeather();
      jsonResponse(res, 200, await snapshots.getSettingsPayload());
    } catch (errorValue) {
      jsonResponse(res, 500, { ok: false, error: serializeError(errorValue) });
    }
  }

  async function handleTheme(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!sameOrigin(req)) {
      jsonResponse(res, 403, { ok: false, error: 'origin rejected' });
      return;
    }
    try {
      const body = await readBody(req);
      const theme = body?.theme === 'light' ? 'light' : body?.theme === 'dark' ? 'dark' : null;
      if (!theme) {
        jsonResponse(res, 400, { ok: false, error: 'invalid theme' });
        return;
      }
      state.settingsStore.setDshTheme(theme);
      hub.pushSettings(true);
      jsonResponse(res, 200, { ok: true, settings: state.settingsStore.public() });
    } catch (errorValue) {
      jsonResponse(res, 400, { ok: false, error: serializeError(errorValue) });
    }
  }

  async function handleLocale(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!sameOrigin(req)) {
      jsonResponse(res, 403, { ok: false, error: 'origin rejected' });
      return;
    }
    try {
      const body = await readBody(req);
      const requested = safeString(body?.locale, 35);
      const locale = normalizeDshLocale(requested);
      if (!locale) {
        jsonResponse(res, 400, { ok: false, error: 'invalid locale' });
        return;
      }
      state.settingsStore.setDshLocale(locale);
      hub.pushSettings(true);
      jsonResponse(res, 200, {
        ok: true,
        dshLocale: locale,
        locale: state.effectiveLocale(),
        settings: state.settingsStore.public(),
      });
    } catch (errorValue) {
      jsonResponse(res, 400, { ok: false, error: serializeError(errorValue) });
    }
  }

  async function handleTokenRotate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!sameOrigin(req)) {
      jsonResponse(res, 403, { ok: false, error: 'origin rejected' });
      return;
    }
    state.settingsStore.rotateToken();
    hub.closeAll('token rotated');
    hub.pushSettings(true);
    jsonResponse(res, 200, await snapshots.getSettingsPayload());
  }

  /**
   * Disconnect one console. With access verification on, the pairing token is
   * rotated in the same step: a bare close would only drop the socket, and the
   * device would reconnect with the token it already holds. The replacement goes
   * to each console that was connected when the disconnect was decided, so they
   * never have to pair again.
   */
  async function handleDisconnect(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!sameOrigin(req)) {
      jsonResponse(res, 403, { ok: false, error: 'origin rejected' });
      return;
    }
    try {
      const body = await readBody(req);
      const id = safeString(body?.id, 80);
      const before = hub.info();
      const present = id !== '' && before.some((client) => client.id === id);
      if (!present) {
        jsonResponse(res, 200, { ok: true, clients: before });
        return;
      }
      // Freeze the recipients before closing: this is the list that remains
      // after the disconnect, identified by hub ids. Ids are minted per
      // handshake, so a device that reconnects — even between the close and the
      // writes — owns a new id and can never match an entry here. A broadcast
      // would instead reach whoever happens to be connected when it runs.
      const recipients = before
        .filter((client) => client.id !== id)
        .map((client) => client.id);
      hub.close(id, 'disconnected by host');
      // Verification off means the token is not what lets a device in, so
      // rotating it would only invalidate the pairing link for no reason.
      if (!settings().tokenEnabled) {
        jsonResponse(res, 200, { ok: true, clients: hub.info() });
        return;
      }
      const rotated = state.settingsStore.rotateToken();
      for (const recipient of recipients) {
        hub.sendTo(recipient, { type: 'token', token: rotated.token });
      }
      jsonResponse(res, 200, await snapshots.getSettingsPayload());
    } catch (errorValue) {
      jsonResponse(res, 400, { ok: false, error: serializeError(errorValue) });
    }
  }

  async function handleQr(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const info = remote.getInfo();
    if (!info.primaryUrl) {
      textResponse(res, 503, 'Remote control server is not running');
      return;
    }
    const svg = qrSvg(remote.remoteUrl(), { cellSize: 8, margin: 4, label: 'Remote control pairing QR code' });
    res.writeHead(200, {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(svg),
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : svg);
  }

  /** Live catalogs used by the Quick Q&A settings section. */
  async function handleQuickQaOptions(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const force = url.searchParams.get('refresh') === '1' || req.method === 'POST';
    try {
      const options = await quickqa.readOptions(force);
      jsonResponse(res, 200, {
        ok: true,
        ...options,
        settings: settings().quickqa,
        pushQuestions: settings().notifications.pushQuestions,
      } satisfies Record<string, unknown> & { ok: true });
    } catch (errorValue) {
      jsonResponse(res, 500, { ok: false, error: serializeError(errorValue) });
    }
  }

  return {
    handleInfo,
    handleQr,
    handleSettingsGet,
    handleSettingsPost,
    handleAppNames,
    handleLocation,
    handleGeocode,
    handleQWeatherJwt,
    handleQWeatherKeyPair,
    handleQWeatherSync,
    handleWeatherRefresh,
    handleTheme,
    handleLocale,
    handleTokenRotate,
    handleDisconnect,
    handleQuickQaOptions,
  };
}

export type { SettingsPayload };
