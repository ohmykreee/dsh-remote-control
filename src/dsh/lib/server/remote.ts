/**
 * LAN HTTP/HTTPS server: pairing auth, static console assets, timer sound,
 * Quick Q&A audio upload, and the advertised URLs.
 */

import fs from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { Server as HttpsServer } from 'node:https';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostMessage } from '../i18n/index.js';
import type { QuickQaService } from '../quickqa/index.js';
import { readRecordingLimits } from '../quickqa/voice.js';
import type { PluginLocale } from '../settings/index.js';
import { isRecord } from '../shared/types.js';
import type { WebSocketClientInfo } from '../shared/types.js';
import {
  INFO_PATH,
  QR_PATH,
  SETTINGS_PATH,
  serializeError,
  VERSION,
} from '../shared/util.js';
import type { ServiceState } from './state.js';
import {
  BODY_LIMIT,
  certificateDomain,
  cidrFor,
  COOKIE_NAME,
  cookieValue,
  DEFAULT_PORT,
  isLoopback,
  jsonResponse,
  MIME,
  normalizeIp,
  parsePort,
  POMODORO_SOUND_PATH,
  readBinaryBody,
  sameOrigin,
  safeRelativeFile,
  textResponse,
  unauthorizedPage,
} from './http.js';
import type { CidrInfo, InterfaceEntry, RemoteUrlEntry, ResponseHeaders } from './types.js';

const WEB_DIR = fileURLToPath(new URL('../../web/', import.meta.url));

/** Quick Q&A recording upload route on the LAN origin. */
export const QUICKQA_TRANSCRIBE_PATH = '/api/quickqa/transcribe';
/** Hard cap for one upload; the speech Remote may advertise a smaller one. */
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

/** Everything the sidebar/phone needs about the running console. */
export interface InfoPayload {
  version: string;
  platform: NodeJS.Platform;
  platformLabel: string;
  running: boolean;
  port: number | null;
  protocol: 'http' | 'https';
  startedAt: number;
  error: string | null;
  tls: { configured: boolean; active: boolean; error: string | null };
  tokenRequired: boolean;
  primaryUrl: string;
  urls: RemoteUrlEntry[];
  usesLoopbackOnly: boolean;
  qrPath: string;
  routes: { info: string; settings: string; remote: string };
  clients: WebSocketClientInfo[];
  capabilities: { notifications: unknown; media: unknown; volume: unknown };
}

export interface RemoteServer {
  start(): Promise<InfoPayload>;
  stop(): Promise<void>;
  restart(): Promise<InfoPayload>;
  getInfo(): InfoPayload;
  getServer(): HttpServer | HttpsServer | null;
  recomputeUrls(): void;
  interfaceEntries(withUrls?: boolean): InterfaceEntry[];
  ipAllowed(remoteAddress: string | undefined): boolean;
  isAuthorized(req: IncomingMessage, url: URL): boolean;
  authorizeSocket(req: IncomingMessage, url: URL): { ok: boolean; status?: number };
  remoteUrl(): string;
}

export function createRemoteServer(
  state: ServiceState,
  quickqa: QuickQaService,
  getClients: () => WebSocketClientInfo[],
): RemoteServer {
  const settings = (): ReturnType<ServiceState['settingsStore']['get']> => state.settingsStore.get();
  const locale = (): PluginLocale => state.effectiveLocale();
  const preferredPort = parsePort(process.env.DSH_REMOTE_CONTROL_PORT || DEFAULT_PORT);

  let server: HttpServer | HttpsServer | null = null;
  let port: number | null = null;
  let running = false;
  let protocol: 'http' | 'https' = 'http';
  let tlsActive = false;
  let tlsError: string | null = null;
  let tlsDomain: string | null = null;
  let error: string | null = null;
  let urls: RemoteUrlEntry[] = [];
  let primaryUrl = '';

  function interfaceEntries(withUrls: boolean = false): InterfaceEntry[] {
    const selected = settings().allowedInterfaces;
    const entries: Array<InterfaceEntry & { score: number }> = [];
    for (const [name, addresses] of Object.entries(networkInterfaces())) {
      for (const address of addresses ?? []) {
        if (address.family !== 'IPv4' || address.internal) continue;
        const cidr = cidrFor(address.address, address.netmask);
        const isSelected = selected === null || selected.includes(name);
        let score = 5;
        if (address.address.startsWith('192.168.')) score = 0;
        else if (address.address.startsWith('10.')) score = 1;
        else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address.address)) score = 2;
        if (/wi-?fi|wlan|wireless|ethernet|en0|eth0/i.test(name)) score -= 0.5;
        if (/vethernet|virtual|vmware|vbox|tailscale|zerotier|wsl|docker|hyper-v/i.test(name)) score += 4;
        entries.push({
          name,
          address: address.address,
          netmask: address.netmask,
          cidr: cidr?.cidr || null,
          selected: isSelected,
          score,
          ...(withUrls && port ? { url: `${protocol}://${address.address}:${port}/` } : {}),
        });
      }
    }
    entries.sort((a, b) => {
      if (a.selected !== b.selected) return a.selected ? -1 : 1;
      return a.score - b.score || a.name.localeCompare(b.name) || a.address.localeCompare(b.address);
    });
    return entries.map(({ score, ...entry }) => entry);
  }

  function selectedNetworks(): CidrInfo[] {
    return interfaceEntries()
      .filter((entry) => entry.selected)
      .map((entry) => cidrFor(entry.address, entry.netmask))
      .filter((entry): entry is CidrInfo => entry !== null);
  }

  function ipAllowed(remoteAddress: string | undefined): boolean {
    const ip = normalizeIp(remoteAddress);
    if (!ip) return false;
    if (isLoopback(ip)) return true;
    const value = ipv4ToIntSafe(ip);
    if (value === null) return false;
    return selectedNetworks().some((network) => (value & network.mask) === (network.network & network.mask));
  }

  function recomputeUrls(): void {
    if (!port) {
      urls = [];
      primaryUrl = '';
      return;
    }
    urls = interfaceEntries(true)
      .filter((entry) => entry.selected)
      .map((entry) => ({ name: entry.name, address: entry.address, url: entry.url }));
    // Pairing should use the hostname covered by the certificate when HTTPS is
    // active; the per-interface IP list stays available for diagnostics.
    const domainUrl = protocol === 'https' && tlsActive && tlsDomain
      ? `https://${tlsDomain}:${port}/`
      : '';
    primaryUrl = domainUrl || urls[0]?.url || `${protocol}://127.0.0.1:${port}/`;
  }

  function remoteTokenQuery(): string {
    const value = settings();
    return value.tokenEnabled ? `?token=${encodeURIComponent(value.token)}` : '';
  }

  function remoteUrl(): string {
    if (!primaryUrl) return '';
    return `${primaryUrl}${remoteTokenQuery()}`;
  }

  function getInfo(): InfoPayload {
    const value = settings();
    const mediaStatus = state.adapters.media?.status?.() || {};
    const notificationStatus = state.adapters.notifications?.status?.() || {};
    return {
      version: VERSION,
      platform: state.adapters.platform,
      platformLabel: state.adapters.label,
      running,
      port,
      protocol,
      startedAt: state.startedAt,
      error,
      tls: {
        configured: value.tls.enabled,
        active: tlsActive,
        error: tlsError,
      },
      tokenRequired: value.tokenEnabled,
      primaryUrl,
      urls,
      usesLoopbackOnly: running && urls.length === 0,
      qrPath: `${QR_PATH}?v=${state.startedAt}${value.tokenEnabled ? `&token=${encodeURIComponent(value.token)}` : ''}`,
      routes: {
        info: INFO_PATH,
        settings: SETTINGS_PATH,
        remote: remoteUrl(),
      },
      clients: getClients(),
      capabilities: {
        notifications: notificationStatus,
        media: mediaStatus.media ?? {},
        volume: mediaStatus.volume ?? {},
      },
    };
  }

  function isAuthorized(req: IncomingMessage, url: URL): boolean {
    if (!ipAllowed(req.socket.remoteAddress)) return false;
    const value = settings();
    if (!value.tokenEnabled) return true;
    return url.searchParams.get('token') === value.token || cookieValue(req.headers.cookie, COOKIE_NAME) === value.token;
  }

  function authHeaders(url: URL): ResponseHeaders {
    const value = settings();
    if (!value.tokenEnabled || url.searchParams.get('token') !== value.token) return {};
    return {
      'set-cookie': `${COOKIE_NAME}=${value.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${tlsActive ? '; Secure' : ''}`,
    };
  }

  async function serveStatic(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    extraHeaders: ResponseHeaders = {},
  ): Promise<boolean> {
    const map: Record<string, string> = {
      '/': 'index.html',
      '/index.html': 'index.html',
      '/manifest.webmanifest': 'manifest.webmanifest',
      '/icon.svg': 'icon.svg',
    };
    let file: string | undefined = map[pathname];
    if (!file && pathname.startsWith('/assets/')) {
      const relative = safeRelativeFile(pathname.slice('/assets/'.length));
      if (relative) file = `assets/${relative}`;
    }
    if (!file && pathname.startsWith('/fonts/')) {
      const relative = safeRelativeFile(pathname.slice('/fonts/'.length));
      if (relative) file = `fonts/${relative}`;
    }
    if (!file) return false;
    const absolute = path.resolve(WEB_DIR, file);
    const webRoot = path.resolve(WEB_DIR);
    if (!absolute.startsWith(`${webRoot}${path.sep}`)) return false;
    try {
      const body = await fs.readFile(absolute);
      const fontAsset = /\.(woff2|woff|ttf|otf)$/i.test(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': fontAsset ? 'public, max-age=31536000, immutable' : 'no-store',
        'content-length': body.length,
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'content-security-policy':
          "default-src 'self'; img-src 'self' data: blob: https: http:; media-src 'self' data: blob: https: http:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss: https:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        ...extraHeaders,
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return true;
    } catch (readError) {
      const code = isRecord(readError) ? readError.code : undefined;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        textResponse(res, 404, 'Asset not found');
      } else {
        textResponse(res, 500, `Asset unavailable: ${serializeError(readError)}`);
      }
      return true;
    }
  }

  /**
   * Stream the configured timer alert sound to an authorized console tab.
   *
   * Both the pomodoro and the countdown use this file. The console never learns
   * host filesystem paths; it only asks this route for the currently configured
   * file. Remote URLs are configured on the phone side and played directly, so
   * this route is only for local files.
   */
  async function servePomodoroSound(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const configured = settings().pomodoro.soundPath.trim();
    if (!configured) {
      jsonResponse(res, 404, { ok: false, error: 'no pomodoro sound configured' });
      return;
    }
    if (/^(https?:)?\/\//i.test(configured) || /^(data|blob):/i.test(configured)) {
      jsonResponse(res, 404, { ok: false, error: 'remote sound urls are played directly by the console' });
      return;
    }
    const absolute = path.resolve(configured);
    try {
      const stat = await fs.stat(absolute);
      if (!stat.isFile()) {
        jsonResponse(res, 404, { ok: false, error: 'pomodoro sound is not a file' });
        return;
      }
      if (stat.size > 64 * 1024 * 1024) {
        jsonResponse(res, 413, { ok: false, error: 'pomodoro sound is too large' });
        return;
      }
      const body = await fs.readFile(absolute);
      res.writeHead(200, {
        'content-type': MIME[path.extname(absolute).toLowerCase()] || 'application/octet-stream',
        'content-length': body.length,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (errorValue) {
      const code = isRecord(errorValue) ? errorValue.code : undefined;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        jsonResponse(res, 404, { ok: false, error: 'pomodoro sound file not found' });
      } else {
        jsonResponse(res, 500, { ok: false, error: serializeError(errorValue) });
      }
    }
  }

  async function handleQuickQaTranscribe(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      jsonResponse(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }
    if (!sameOrigin(req)) {
      jsonResponse(res, 403, { ok: false, error: 'origin rejected' });
      return;
    }
    if (!quickqa.isVoiceReady()) {
      jsonResponse(res, 409, { ok: false, error: hostMessage(locale(), 'quickqaVoiceNotReady') });
      return;
    }
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.startsWith('audio/wav') && !contentType.startsWith('application/octet-stream')) {
      jsonResponse(res, 415, { ok: false, error: 'audio/wav body required' });
      return;
    }
    const limits = readRecordingLimits(state.ctx);
    const limit = Math.min(MAX_AUDIO_BYTES, Math.max(44, limits.maxAudioBytes || MAX_AUDIO_BYTES));
    let audio: Buffer;
    try {
      audio = await readBinaryBody(req, limit);
    } catch (errorValue) {
      const message = serializeError(errorValue);
      if (/too large/i.test(message)) {
        jsonResponse(res, 413, { ok: false, error: hostMessage(locale(), 'quickqaTranscribeTooLarge') });
      } else {
        jsonResponse(res, 400, { ok: false, error: message });
      }
      return;
    }
    if (audio.length < 44) {
      jsonResponse(res, 400, { ok: false, error: hostMessage(locale(), 'quickqaTranscribeEmpty') });
      return;
    }
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    try {
      const result = await quickqa.transcribe(new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength), controller.signal);
      if (!result.text) {
        jsonResponse(res, 422, { ok: false, error: hostMessage(locale(), 'quickqaTranscribeEmpty') });
        return;
      }
      jsonResponse(res, 200, { ok: true, text: result.text, audioSeconds: result.audioSeconds });
    } catch (errorValue) {
      const message = serializeError(errorValue);
      state.log(`quickqa transcribe failed: ${message}`);
      if (/not-ready|unavailable/i.test(message)) {
        jsonResponse(res, 409, { ok: false, error: hostMessage(locale(), 'quickqaVoiceNotReady') });
      } else if (/empty/i.test(message)) {
        jsonResponse(res, 422, { ok: false, error: hostMessage(locale(), 'quickqaTranscribeEmpty') });
      } else if (controller.signal.aborted) {
        jsonResponse(res, 499, { ok: false, error: 'cancelled' });
      } else {
        jsonResponse(res, 502, { ok: false, error: hostMessage(locale(), 'quickqaTranscribeFailed') });
      }
    }
  }

  async function handleRemote(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!ipAllowed(req.socket.remoteAddress)) {
        textResponse(res, 403, 'This device is not allowed to access the console.');
        return;
      }
      const url = new URL(req.url || '/', `${protocol}://${req.headers.host || '127.0.0.1'}`);
      const pathname = url.pathname;
      const authorized = isAuthorized(req, url);

      if (pathname === '/' && !authorized) {
        textResponse(res, 401, unauthorizedPage(locale()), {
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
        });
        return;
      }
      const staticPath = pathname === '/'
        || pathname === '/index.html'
        || pathname === '/manifest.webmanifest'
        || pathname === '/icon.svg'
        || pathname.startsWith('/assets/')
        || pathname.startsWith('/fonts/');
      if (staticPath && !authorized) {
        textResponse(res, 401, 'Pairing required');
        return;
      }
      if (pathname === POMODORO_SOUND_PATH) {
        if (!authorized) {
          textResponse(res, 401, 'Pairing required');
          return;
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          textResponse(res, 405, 'Method not allowed');
          return;
        }
        await servePomodoroSound(req, res);
        return;
      }
      if (pathname === QUICKQA_TRANSCRIBE_PATH) {
        if (!authorized) {
          jsonResponse(res, 401, { ok: false, error: 'Pairing required' });
          return;
        }
        await handleQuickQaTranscribe(req, res);
        return;
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (await serveStatic(req, res, pathname, authHeaders(url))) return;
      }
      if (pathname === '/api/health') {
        jsonResponse(res, 200, { ok: true, version: VERSION, now: Date.now() });
        return;
      }
      if (pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }
      jsonResponse(res, 404, { ok: false, error: 'not found' });
    } catch (errorValue) {
      state.log(`request failed: ${serializeError(errorValue)}`);
      if (!res.headersSent) jsonResponse(res, 500, { ok: false, error: serializeError(errorValue) });
      else res.end();
    }
  }

  function authorizeSocket(req: IncomingMessage, url: URL): { ok: boolean; status?: number } {
    if (!ipAllowed(req.socket.remoteAddress)) return { ok: false, status: 403 };
    const origin = req.headers.origin;
    if (origin) {
      const host = req.headers.host;
      if (origin !== `http://${host}` && origin !== `https://${host}`) return { ok: false, status: 403 };
    }
    const value = settings();
    if (!value.tokenEnabled) return { ok: true };
    const cookie = cookieValue(req.headers.cookie, COOKIE_NAME);
    const query = url.searchParams.get('token');
    if (cookie === value.token || query === value.token) return { ok: true };
    return { ok: false, status: 401 };
  }

  async function listen(instance: HttpServer | HttpsServer, selectedPort: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (listenError: unknown): void => {
        instance.off('listening', onListening);
        reject(listenError);
      };
      const onListening = (): void => {
        instance.off('error', onError);
        resolve();
      };
      instance.once('error', onError);
      instance.once('listening', onListening);
      instance.listen(selectedPort, '0.0.0.0');
    });
  }

  async function createInstance(): Promise<HttpServer | HttpsServer> {
    const value = settings();
    let tlsOptions: { cert: Buffer; key: Buffer } | null = null;
    tlsError = null;
    tlsActive = false;
    tlsDomain = null;
    if (value.tls.enabled) {
      try {
        if (!value.tls.certPath || !value.tls.keyPath) throw new Error('Certificate and key paths are required');
        const cert = await fs.readFile(path.resolve(value.tls.certPath));
        const key = await fs.readFile(path.resolve(value.tls.keyPath));
        tlsOptions = { cert, key };
        tlsActive = true;
        tlsDomain = certificateDomain(cert);
      } catch (errorValue) {
        tlsError = serializeError(errorValue);
        tlsOptions = null;
        tlsActive = false;
        tlsDomain = null;
      }
    }
    protocol = tlsActive ? 'https' : 'http';
    const handler = (req: IncomingMessage, res: ServerResponse): void => {
      void handleRemote(req, res);
    };
    const instance = tlsOptions ? createHttpsServer(tlsOptions, handler) : createHttpServer(handler);
    instance.keepAliveTimeout = 30_000;
    instance.headersTimeout = 35_000;
    return instance;
  }

  async function start(): Promise<InfoPayload> {
    if (server || running) return getInfo();
    try {
      const instance = await createInstance();
      try {
        await listen(instance, preferredPort);
      } catch (listenError) {
        const code = isRecord(listenError) ? listenError.code : undefined;
        if (code !== 'EADDRINUSE' || preferredPort === 0) throw listenError;
        await listen(instance, 0);
      }
      server = instance;
      const address = server.address();
      port = typeof address === 'object' && address ? address.port : preferredPort;
      running = true;
      error = null;
      recomputeUrls();
      state.log(`listening on ${primaryUrl} (${urls.length} network${urls.length === 1 ? '' : 's'})`);
    } catch (errorValue) {
      error = serializeError(errorValue);
      running = false;
      server = null;
      state.log(`failed to start: ${error}`);
    }
    return getInfo();
  }

  async function stop(): Promise<void> {
    const instance = server;
    server = null;
    running = false;
    port = null;
    urls = [];
    primaryUrl = '';
    tlsDomain = null;
    if (!instance) return;
    try {
      instance.closeAllConnections?.();
      await new Promise<void>((resolve) => instance.close(() => resolve()));
    } catch {
      /* ignore */
    }
  }

  async function restart(): Promise<InfoPayload> {
    await stop();
    return start();
  }

  return {
    start,
    stop,
    restart,
    getInfo,
    getServer: () => server,
    recomputeUrls,
    interfaceEntries,
    ipAllowed,
    isAuthorized,
    authorizeSocket,
    remoteUrl,
  };
}

/** Local IPv4 parse used only for CIDR checks. */
function ipv4ToIntSafe(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

/** Exposed for tests that exercise certificate SAN parsing. */
export { certificateDomain };
