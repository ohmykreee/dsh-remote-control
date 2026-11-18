/**
 * dsh-remote-control — Host half (TypeScript source).
 *
 * Compiled by `scripts/build-dsh.mjs` into the plugin's runtime `index.js` and
 * `lib/`. Starts the LAN HTTP/WebSocket console, then exposes loopback-only
 * settings and pairing routes on the existing DSH webServer for the sidebar page.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRemoteControlService } from './lib/service.js';
import { shutdownProbeDaemon } from './lib/probe/index.js';
import type { DshContext, DshLogger } from './lib/shared/types.js';
import {
  APP_NAMES_PATH,
  DISCONNECT_PATH,
  GEOCODE_PATH,
  INFO_PATH,
  LOCALE_PATH,
  LOCATION_PATH,
  PANEL_ID,
  QR_PATH,
  QWEATHER_JWT_PATH,
  QWEATHER_KEYPAIR_PATH,
  QWEATHER_SYNC_PATH,
  QUICKQA_OPTIONS_PATH,
  WEATHER_REFRESH_PATH,
  SETTINGS_PATH,
  THEME_PATH,
  TOKEN_ROTATE_PATH,
} from './lib/shared/util.js';

export const inject: string[] = ['webServer'];

interface WebServerRoute {
  kind: 'exact';
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}

interface DshWebServer {
  register(route: WebServerRoute): (() => void) | void;
}

function makeLogger(ctx: DshContext): (message: string) => void {
  try {
    const candidate = ctx.logger;
    const sink: DshLogger | undefined =
      typeof candidate === 'function' ? candidate(PANEL_ID) : candidate;
    return (message: string): void => {
      try {
        if (sink && typeof sink.info === 'function') sink.info(`[${PANEL_ID}] ${message}`);
        else console.info(`[${PANEL_ID}] ${message}`);
      } catch {
        /* logging must never break the plugin */
      }
    };
  } catch {
    return () => {};
  }
}

export async function apply(ctx: DshContext): Promise<void> {
  const log = makeLogger(ctx);
  const service = createRemoteControlService(ctx, { log });

  try {
    await service.start();
  } catch (error) {
    log(`server start threw: ${String(error)}`);
  }

  ctx.effect?.(
    () => () => {
      service.dispose();
      shutdownProbeDaemon();
    },
    'dsh-remote-control: LAN server and native adapters',
  );

  const webServer = ctx.get?.('webServer') as DshWebServer | undefined;
  if (webServer?.register) {
    const routes: Array<[string, (req: IncomingMessage, res: ServerResponse) => Promise<void> | void, string]> = [
      [INFO_PATH, (req, res) => service.handleInfo(req, res), 'pairing info'],
      [QR_PATH, (req, res) => service.handleQr(req, res), 'pairing QR'],
      [
        SETTINGS_PATH,
        (req, res) =>
          req.method === 'POST' ? service.handleSettingsPost(req, res) : service.handleSettingsGet(req, res),
        'settings',
      ],
      [APP_NAMES_PATH, (req, res) => service.handleAppNames(req, res), 'app name mapping'],
      [LOCATION_PATH, (req, res) => service.handleLocation(req, res), 'location permission'],
      [GEOCODE_PATH, (req, res) => service.handleGeocode(req, res), 'city geocoding'],
      [QWEATHER_JWT_PATH, (req, res) => service.handleQWeatherJwt(req, res), 'QWeather JWT'],
      [QWEATHER_KEYPAIR_PATH, (req, res) => service.handleQWeatherKeyPair(req, res), 'QWeather key pair'],
      [QWEATHER_SYNC_PATH, (req, res) => service.handleQWeatherSync(req, res), 'QWeather console sync'],
      [WEATHER_REFRESH_PATH, (req, res) => service.handleWeatherRefresh(req, res), 'weather refresh'],
      [THEME_PATH, (req, res) => service.handleTheme(req, res), 'theme sync'],
      [LOCALE_PATH, (req, res) => service.handleLocale(req, res), 'locale sync'],
      [TOKEN_ROTATE_PATH, (req, res) => service.handleTokenRotate(req, res), 'token rotation'],
      [DISCONNECT_PATH, (req, res) => service.handleDisconnect(req, res), 'device disconnect'],
      [QUICKQA_OPTIONS_PATH, (req, res) => service.handleQuickQaOptions(req, res), 'Quick Q&A options'],
    ];
    for (const [routePath, handler, label] of routes) {
      ctx.effect?.(
        () => webServer.register({ kind: 'exact', path: routePath, handler }),
        `dsh-remote-control: ${label} route`,
      );
    }
  } else {
    log('webServer is unavailable; the sidebar page cannot read settings');
  }

  const info = service.getInfo();
  if (info.error) log(`remote server unavailable: ${info.error}`);
  else if (info.tls.error) log(`TLS unavailable; serving HTTP: ${info.tls.error}`);
  else log(`remote server ready on port ${info.port}${info.usesLoopbackOnly ? ' (loopback only)' : ''}`);
}
