/**
 * dsh-remote-control — Host half.
 *
 * Starts the LAN HTTP/WebSocket console, then exposes loopback-only settings
 * and pairing routes on the existing DSH webServer for the sidebar page.
 */

import { createRemoteControlService } from './lib/service.js';
import {
  DISCONNECT_PATH,
  INFO_PATH,
  PANEL_ID,
  QR_PATH,
  SETTINGS_PATH,
  THEME_PATH,
  TOKEN_ROTATE_PATH,
} from './lib/util.js';

export const inject = ['webServer'];

function makeLogger(ctx) {
  try {
    const candidate = ctx?.logger;
    const sink = typeof candidate === 'function' ? candidate(PANEL_ID) : candidate;
    return (message) => {
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

export async function apply(ctx) {
  const log = makeLogger(ctx);
  const service = createRemoteControlService(ctx, { log });

  try {
    await service.start();
  } catch (error) {
    log(`server start threw: ${String(error)}`);
  }

  ctx.effect(
    () => () => service.dispose(),
    'dsh-remote-control: LAN server and native adapters',
  );

  const webServer = ctx.get?.('webServer');
  if (webServer?.register) {
    const routes = [
      [INFO_PATH, (req, res) => service.handleInfo(req, res), 'pairing info'],
      [QR_PATH, (req, res) => service.handleQr(req, res), 'pairing QR'],
      [
        SETTINGS_PATH,
        (req, res) =>
          req.method === 'POST' ? service.handleSettingsPost(req, res) : service.handleSettingsGet(req, res),
        'settings',
      ],
      [THEME_PATH, (req, res) => service.handleTheme(req, res), 'theme sync'],
      [TOKEN_ROTATE_PATH, (req, res) => service.handleTokenRotate(req, res), 'token rotation'],
      [DISCONNECT_PATH, (req, res) => service.handleDisconnect(req, res), 'device disconnect'],
    ];
    for (const [routePath, handler, label] of routes) {
      ctx.effect(
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
