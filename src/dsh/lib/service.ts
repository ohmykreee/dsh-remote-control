/** LAN HTTP/WebSocket service, pairing, settings, and live device snapshots. */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { Server as HttpsServer } from 'node:https';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAccountService } from './account.js';
import { createAppMapping } from './app-mapping.js';
import type { MappedApp } from './app-mapping.js';
import { createPerformanceService } from './performance.js';
import { createPlatformAdapters } from './platform/index.js';
import { probeInfo, runProbe } from './probe.js';
import { qrSvg } from './qr.js';
import { collectSessions, createPendingTracker } from './sessions.js';
import { createSettingsStore } from './settings.js';
import {
  APP_NAMES_PATH,
  INFO_PATH,
  LOCATION_PATH,
  QR_PATH,
  ROUTE_PREFIX,
  SETTINGS_PATH,
  THEME_PATH,
  TOKEN_ROTATE_PATH,
  VERSION,
  finiteNumber,
  safeString,
  serializeError,
} from './util.js';
import { createWeatherService } from './weather.js';
import { createWebSocketHub } from './ws.js';
import type {
  DshContext,
  JsonRecord,
  NotificationItem,
  NotificationPayload,
  WebSocketAuthorizeDecision,
  WebSocketClient,
  WebSocketClientInfo,
  WebSocketHub,
} from './types.js';
import { isRecord } from './types.js';

const WEB_DIR = fileURLToPath(new URL('../web/', import.meta.url));
const DEFAULT_PORT = 38765;
const COOKIE_NAME = 'dsh_rc';
const BODY_LIMIT = 64 * 1024;
const POMODORO_SOUND_PATH = '/api/pomodoro/sound';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const SAFE_FILE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Sibling services are typed by derivation so no port order is assumed. */
type SettingsStore = ReturnType<typeof createSettingsStore>;
type SettingsValue = ReturnType<SettingsStore['get']>;
type AccountService = ReturnType<typeof createAccountService>;
type WeatherService = ReturnType<typeof createWeatherService>;
type PerformanceService = ReturnType<typeof createPerformanceService>;
type PlatformAdapters = ReturnType<typeof createPlatformAdapters>;
type AppMapping = ReturnType<typeof createAppMapping>;
type PendingTracker = ReturnType<typeof createPendingTracker>;
type SessionList = ReturnType<typeof collectSessions>;
type WeatherSnapshot = Awaited<ReturnType<WeatherService['getWeather']>>;
type AccountSnapshot = Awaited<ReturnType<AccountService['getAccount']>>;
type PerformanceSnapshot = Awaited<ReturnType<PerformanceService['sample']>>;
type MediaSnapshot = Awaited<ReturnType<PlatformAdapters['media']['getState']>>;

/** Response headers accepted by the JSON and text helpers. */
type ResponseHeaders = Record<string, string | number>;

/** Parsed IPv4 network of one interface. */
interface CidrInfo {
  network: number;
  mask: number;
  prefix: number;
  cidr: string;
}

/** One LAN interface as exposed to the settings panel. */
export interface InterfaceEntry {
  name: string;
  address: string;
  netmask: string;
  cidr: string | null;
  selected: boolean;
  url?: string;
}

/** One advertised console URL for a selected interface. */
export interface RemoteUrlEntry {
  name: string;
  address: string;
  url?: string;
}

/** Untrusted input forwarded to the weather service (`{}` = auto location). */
type WeatherInput = {
  latitude?: number | null;
  longitude?: number | null;
  name?: string;
};

/** Browser-facing settings snapshot pushed over the socket. */
export interface RemoteSettingsPayload {
  theme: string;
  temperatureUnit: string;
  notificationLimit: number;
  navPosition: string;
  balance: {
    spendWindow: string;
    lowThreshold: number | null;
    showPeakValley: boolean;
  };
  pomodoro: {
    enabled: boolean;
    focusMinutes: number;
    breakMinutes: number;
    soundPath: string;
    loopAlarm: boolean;
  };
  pageOrder: string[];
  pageEnabled: Record<string, boolean>;
}

/** Filtered notification view built from a raw probe payload. */
interface NotificationViewPayload {
  available: boolean;
  reason: string | null;
  liveOnly: boolean;
  notifications: NotificationItem[];
  apps: MappedApp[];
  enabledApps: string[];
  updatedAt: number;
}

/** Account view after the low-balance decoration is applied. */
type AccountView = AccountSnapshot & { lowBalance: boolean; lowThreshold: number | null };

/** Degraded account payload used when the account service throws. */
interface AccountFallback {
  available: false;
  signedIn: false;
  error: string;
  lowBalance: false;
}

/** Degraded weather payload used when the weather service rejects. */
interface WeatherFallback {
  ok: false;
  error: string;
}

/** Degraded performance payload used when sampling throws. */
interface PerformanceFallback {
  ok: false;
  error: string;
  cpu: { usage: null; model: string; cores: null };
  memory: { total: null; used: null; percent: null };
  gpu: { ok: false; error: string };
  temperatures: unknown[];
  sampledAt: number;
}

/** Degraded media payload used when the adapter throws. */
interface MediaFallback {
  ok: false;
  media: { ok: false; available: false; media: null; error: string };
  volume: { ok: false; volume: number; muted: boolean; error: string };
}

/** Notification payload used when the probe snapshot is unusable. */
interface NotificationFallbackPayload {
  available: false;
  reason: string;
  notifications: NotificationItem[];
  apps: MappedApp[];
}

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

/** Aggregate snapshot sent to a phone when it (re)connects. */
interface OverviewPayload {
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
  settings: ReturnType<SettingsStore['public']>;
  interfaces: InterfaceEntry[];
  apps: MappedApp[];
  clients: WebSocketClientInfo[];
  info: InfoPayload;
  capabilities: {
    notifications: unknown;
    media: unknown;
    volume: unknown;
    weather: { ok: unknown; updatedAt: unknown };
  };
  diagnostics: {
    platform: NodeJS.Platform;
    platformLabel: string;
    version: string;
    running: boolean;
    protocol: 'http' | 'https';
    clientCount: number;
    notificationApps: number;
  };
}

/** Options accepted by {@link createRemoteControlService}. */
export interface RemoteControlOptions {
  log?: (message: string) => void;
  locale?: string;
}

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
  handleTheme(req: IncomingMessage, res: ServerResponse): Promise<void>;
  handleTokenRotate(req: IncomingMessage, res: ServerResponse): Promise<void>;
  handleDisconnect(req: IncomingMessage, res: ServerResponse): Promise<void>;
  settingsStore: SettingsStore;
  applySettings(patch: JsonRecord): Promise<SettingsValue>;
  dispose(): void;
}

function safeRelativeFile(value: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (!decoded || decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/');
  if (!segments.every((segment) => segment && segment !== '.' && segment !== '..' && SAFE_FILE_SEGMENT.test(segment))) {
    return null;
  }
  return decoded;
}


function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

function ipv4ToInt(ip: string): number | null {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

function intToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

function prefixFromNetmask(netmask: string): number | null {
  const mask = ipv4ToInt(netmask);
  if (mask === null) return null;
  let prefix = 0;
  for (let bit = 31; bit >= 0; bit -= 1) {
    if (((mask >>> bit) & 1) === 1) prefix += 1;
    else break;
  }
  return prefix;
}

function cidrFor(address: string, netmask: string): CidrInfo | null {
  const ip = ipv4ToInt(address);
  const mask = ipv4ToInt(netmask);
  if (ip === null || mask === null) return null;
  const prefix = prefixFromNetmask(netmask);
  if (prefix === null) return null;
  return { network: ip & mask, mask, prefix, cidr: `${intToIpv4(ip & mask)}/${prefix}` };
}

function normalizeIp(value: string | undefined): string {
  const ip = String(value || '');
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function isLoopback(ip: string): boolean {
  return ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.');
}

function parsePort(value: string | number): number {
  const n = Number.parseInt(String(value), 10);
  return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : DEFAULT_PORT;
}

function jsonResponse(res: ServerResponse, status: number, value: unknown, extraHeaders: ResponseHeaders = {}): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function textResponse(res: ServerResponse, status: number, body: string, extraHeaders: ResponseHeaders = {}): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function unauthorizedPage(): string {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>需要配对</title>
<style>html,body{height:100%;margin:0;background:#05070d;color:#f4f7ff;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Noto Sans SC",sans-serif}main{height:100%;display:grid;place-items:center;padding:32px;box-sizing:border-box}.card{max-width:460px;padding:32px;border:1px solid #1b2436;border-radius:28px;background:#0c111c;box-shadow:0 30px 80px #0008}h1{font-size:24px;margin:0 0 12px}p{color:#93a0b8;margin:0 0 10px}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#4d6bff;margin-right:8px}</style>
<main><div class="card"><h1><span class="dot"></span>需要配对</h1><p>请从 DSH 侧边栏的远程控制台重新扫码。</p></main></html>`;
}

function readBody(req: IncomingMessage, limit: number = BODY_LIMIT): Promise<JsonRecord> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function createRemoteControlService(ctx: DshContext, options: RemoteControlOptions = {}): RemoteControlService {
  const log: (message: string) => void = options.log || (() => {});
  const locale = options.locale || 'zh';
  const settingsStore: SettingsStore = createSettingsStore();
  const appMapping: AppMapping = createAppMapping(settingsStore.dir);
  const pending: PendingTracker = createPendingTracker(ctx);
  const weather: WeatherService = createWeatherService();
  const performance: PerformanceService = createPerformanceService();
  const adapters: PlatformAdapters = createPlatformAdapters({ limit: 8 });
  const account: AccountService = createAccountService(ctx, { locale, getSettings: settingsStore.get });
  const preferredPort = parsePort(process.env.DSH_REMOTE_CONTROL_PORT || DEFAULT_PORT);
  const startedAt = Date.now();

  let server: HttpServer | HttpsServer | null = null;
  let hub: WebSocketHub | null = null;
  let port: number | null = null;
  let running = false;
  let protocol: 'http' | 'https' = 'http';
  let tlsActive = false;
  let tlsError: string | null = null;
  let error: string | null = null;
  let urls: RemoteUrlEntry[] = [];
  let primaryUrl = '';
  let disposed = false;
  let lastWeather: WeatherSnapshot | null = null;
  let loops: NodeJS.Timeout[] | null = null;
  const lastSnapshots = new Map<string, string>();
  let notificationsBusy = false;
  let mediaBusy = false;
  let accountBusy = false;
  let weatherBusy = false;
  let performanceBusy = false;
  let performanceCache: PerformanceSnapshot | null = null;
  let performanceAt = 0;

  function settings(): SettingsValue {
    return settingsStore.get();
  }

  function effectiveTheme(): string {
    const value = settings();
    return value.theme === 'dsh' ? value.dshTheme : value.theme;
  }

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
    const value = ipv4ToInt(ip);
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
    primaryUrl = urls[0]?.url || `${protocol}://127.0.0.1:${port}/`;
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
    const mediaStatus = adapters.media?.status?.() || {};
    const notificationStatus = adapters.notifications?.status?.() || {};
    return {
      version: VERSION,
      platform: adapters.platform,
      platformLabel: adapters.label,
      running,
      port,
      protocol,
      startedAt,
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
      qrPath: `${QR_PATH}?v=${startedAt}${value.tokenEnabled ? `&token=${encodeURIComponent(value.token)}` : ''}`,
      routes: {
        info: INFO_PATH,
        settings: SETTINGS_PATH,
        remote: remoteUrl(),
      },
      clients: hub?.info?.() ?? [],
      capabilities: {
        notifications: notificationStatus,
        media: mediaStatus.media ?? {},
        volume: mediaStatus.volume ?? {},
      },
    };
  }

  function remoteSettings(): RemoteSettingsPayload {
    return {
      theme: effectiveTheme(),
      temperatureUnit: settings().temperatureUnit,
      notificationLimit: settings().notifications.limit,
      navPosition: settings().navPosition,
      balance: { ...settings().balance },
      pomodoro: { ...settings().pomodoro },
      pageOrder: [...settings().pageOrder],
      pageEnabled: { ...settings().pageEnabled },
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
    if (!file && pathname.startsWith('/weather-icons/')) {
      const name = path.basename(pathname);
      if (/^[A-Z_]+\.svg$/.test(name)) file = `weather-icons/${name}`;
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
          "default-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob: https: http:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss: https:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
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
   * Stream the configured pomodoro sound file to an authorized console tab.
   *
   * The console never learns host filesystem paths; it only asks this route for
   * the currently configured file. Remote URLs are configured on the phone
   * side and played directly, so this route is only for local files.
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

  function sameOrigin(req: IncomingMessage): boolean {    const origin = req.headers.origin;
    if (!origin) return true;
    const host = req.headers.host;
    return origin === `http://${host}` || origin === `https://${host}`;
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
        textResponse(res, 401, unauthorizedPage(), {
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
        || pathname.startsWith('/fonts/')
        || pathname.startsWith('/weather-icons/');
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
      log(`request failed: ${serializeError(errorValue)}`);
      if (!res.headersSent) jsonResponse(res, 500, { ok: false, error: serializeError(errorValue) });
      else res.end();
    }
  }

  function notificationView(raw: NotificationPayload): NotificationViewPayload {
    const value = settings();
    const enabled = new Set<string>(value.notifications.enabledApps);
    const apps = appMapping.list();
    const list = (Array.isArray(raw?.notifications) ? raw.notifications : [])
      .filter((item) => enabled.size === 0 || enabled.has(item.appKey ?? ''))
      .slice(0, value.notifications.limit)
      .map((item) => {
        const appName = appMapping.displayName(item.appKey ?? '');
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
    let raw: NotificationPayload;
    try {
      raw = await adapters.notifications.getNotifications();
    } catch (errorValue) {
      raw = { available: false, reason: serializeError(errorValue), notifications: [], apps: [] };
    }
    if (Array.isArray(raw.apps)) {
      appMapping.record(
        raw.apps.map((app) => ({ key: app.key, count: app.count })),
        'notification',
      );
    }
    return notificationView(raw);
  }

  async function getWeatherView(): Promise<WeatherSnapshot> {
    const value = settings();
    let input: WeatherInput = {};
    if (value.weather.mode === 'manual') {
      if (value.weather.latitude !== null && value.weather.longitude !== null) {
        input = {
          latitude: value.weather.latitude,
          longitude: value.weather.longitude,
          name: value.weather.name,
        };
      }
    }
    const result: WeatherSnapshot = await weather.getWeather(input);
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
      return decorateAccount(await account.getAccount());
    } catch (errorValue) {
      return {
        available: false,
        signedIn: false,
        error: serializeError(errorValue),
        lowBalance: false,
      };
    }
  }

  async function getPerformanceView(force: boolean = false): Promise<PerformanceSnapshot | PerformanceFallback> {
    const now = Date.now();
    if (!force && performanceCache && now - performanceAt < 1600) return performanceCache;
    try {
      performanceCache = await performance.sample(force);
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
        sessions = collectSessions(ctx, pending);
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
      const value = await adapters.media.getState();
      const media = value.media?.media ?? null;
      if (media?.appId) {
        appMapping.record([{ key: media.appId }], 'music');
        media.appName = appMapping.displayName(media.appId);
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
    let sessions: SessionList = [];
    try {
      sessions = collectSessions(ctx, pending);
    } catch {
      return;
    }
    push('sessions', sessions, force);
  }

  async function pushNotifications(force: boolean = false): Promise<void> {
    if (!hub || hub.size() === 0 || notificationsBusy || !settings().pageEnabled.home) return;
    notificationsBusy = true;
    try {
      const view = await getNotificationsView();
      push('notifications', view, force);
    } finally {
      notificationsBusy = false;
    }
  }

  async function pushAccount(force: boolean = false): Promise<void> {
    if (!hub || hub.size() === 0 || accountBusy || !settings().pageEnabled.sessions) return;
    accountBusy = true;
    try {
      const value = await getAccountView();
      push('account', value, force);
    } finally {
      accountBusy = false;
    }
  }

  async function pushWeather(force: boolean = false): Promise<void> {
    if (!hub || hub.size() === 0 || weatherBusy || !settings().pageEnabled.home) return;
    weatherBusy = true;
    try {
      const value = await getWeatherView();
      push('weather', value, force);
    } finally {
      weatherBusy = false;
    }
  }

  async function pushMedia(force: boolean = false): Promise<void> {
    if (!hub || hub.size() === 0 || mediaBusy || !settings().pageEnabled.music) return;
    mediaBusy = true;
    try {
      const value = await buildMedia();
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
      const value = await getPerformanceView(force);
      push('performance', value, force);
    } finally {
      performanceBusy = false;
    }
  }

  function pushSettings(force: boolean = false): void {
    push('settings', remoteSettings(), force);
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
      client.send({ type: 'welcome', settings: remoteSettings() });
      const enabled = settings().pageEnabled;
      const [overview, media, performanceView] = await Promise.all([
        buildOverview(),
        enabled.music ? buildMedia() : Promise.resolve(null),
        enabled.performance ? getPerformanceView() : Promise.resolve(null),
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
    if (message.type === 'action') {
      const action = safeString(message.action, 40).toLowerCase();
      if (!['playpause', 'next', 'previous', 'seek', 'volume', 'mute'].includes(action)) {
        client.send({ type: 'action-result', ok: false, action, error: 'Unsupported action' });
        return;
      }
      try {
        const value = finiteNumber(message.value, null);
        await adapters.media.control(action, value);
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
      client.send({ type: 'settings', data: remoteSettings() });
      return;
    }
    if (message.type === 'ping') {
      client.send({ type: 'pong' });
    }
  }

  function authorizeSocket(req: IncomingMessage, url: URL): WebSocketAuthorizeDecision {
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

  function attachHub(instance: HttpServer | HttpsServer): WebSocketHub {
    return createWebSocketHub({
      server: instance,
      path: '/ws',
      authorize: authorizeSocket,
      onConnection(client: WebSocketClient): void {
        startLoops();
        pushClients();
        void sendInitial(client);
      },
      onMessage(client: WebSocketClient, message: unknown): void {
        void handleSocketMessage(client, message);
      },
      onClose(): void {
        if (!hub || hub.size() === 0) stopLoops();
        pushClients();
      },
    });
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
    if (value.tls.enabled) {
      try {
        if (!value.tls.certPath || !value.tls.keyPath) throw new Error('Certificate and key paths are required');
        const cert = await fs.readFile(path.resolve(value.tls.certPath));
        const key = await fs.readFile(path.resolve(value.tls.keyPath));
        tlsOptions = { cert, key };
        tlsActive = true;
      } catch (errorValue) {
        tlsError = serializeError(errorValue);
        tlsOptions = null;
        tlsActive = false;
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
    if (server || running || disposed) return getInfo();
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
      hub = attachHub(server);
      if (disposed) {
        stopLoops();
        hub.dispose();
        hub = null;
        await stopServer();
        return getInfo();
      }
      log(`listening on ${primaryUrl} (${urls.length} network${urls.length === 1 ? '' : 's'})`);
    } catch (errorValue) {
      error = serializeError(errorValue);
      running = false;
      server = null;
      hub = null;
      log(`failed to start: ${error}`);
    }
    return getInfo();
  }

  async function stopServer(): Promise<void> {
    stopLoops();
    const currentHub = hub;
    hub = null;
    currentHub?.dispose?.();
    const instance = server;
    server = null;
    running = false;
    port = null;
    urls = [];
    primaryUrl = '';
    if (!instance) return;
    try {
      instance.closeAllConnections?.();
      await new Promise<void>((resolve) => instance.close(() => resolve()));
    } catch {
      /* ignore */
    }
  }

  async function restartServer(): Promise<InfoPayload> {
    await stopServer();
    return start();
  }

  async function getSettingsPayload(): Promise<SettingsPayload> {
    const notifications = await getNotificationsView();
    const mediaStatus = adapters.media?.status?.() || {};
    return {
      ok: true,
      settings: settingsStore.public(),
      interfaces: interfaceEntries(false),
      apps: appMapping.list(),
      clients: hub?.info?.() ?? [],
      info: getInfo(),
      capabilities: {
        notifications: adapters.notifications?.status?.() || {},
        media: mediaStatus.media || {},
        volume: mediaStatus.volume || {},
        weather: {
          ok: lastWeather?.ok ?? null,
          updatedAt: lastWeather?.updatedAt ?? null,
        },
      },
      diagnostics: {
        platform: adapters.platform,
        platformLabel: adapters.label,
        version: VERSION,
        running,
        protocol,
        clientCount: hub?.size?.() ?? 0,
        notificationApps: notifications.apps.length,
      },
    };
  }

  async function applySettings(patch: JsonRecord): Promise<SettingsValue> {
    const before = settingsStore.get();
    const sanitized: JsonRecord = patch && typeof patch === 'object' ? { ...patch } : {};
    delete sanitized.token;
    delete sanitized.tokenRotatedAt;
    const next = settingsStore.update(sanitized);
    const tlsChanged = JSON.stringify(before.tls) !== JSON.stringify(next.tls);
    const authChanged = before.tokenEnabled !== next.tokenEnabled;
    const interfacesChanged = JSON.stringify(before.allowedInterfaces) !== JSON.stringify(next.allowedInterfaces);
    if (authChanged || interfacesChanged) {
      hub?.closeAll('settings changed');
    }
    if (tlsChanged) {
      await restartServer();
    } else {
      recomputeUrls();
    }
    pushSettings(true);
    if (next.pageEnabled.home) {
      if (JSON.stringify(before.notifications) !== JSON.stringify(next.notifications) || !before.pageEnabled.home) void pushNotifications(true);
      if (JSON.stringify(before.weather) !== JSON.stringify(next.weather) || !before.pageEnabled.home) void pushWeather(true);
    }
    if (next.pageEnabled.sessions) {
      if (JSON.stringify(before.balance) !== JSON.stringify(next.balance) || !before.pageEnabled.sessions) {
        void pushAccount(true);
        void pushSessions(true);
      }
    }
    if (next.pageEnabled.music && !before.pageEnabled.music) void pushMedia(true);
    if (next.pageEnabled.performance && !before.pageEnabled.performance) void pushPerformance(true);
    return next;
  }

  async function handleInfo(req: IncomingMessage, res: ServerResponse): Promise<void> {
    jsonResponse(res, 200, getInfo());
  }

  async function handleSettingsGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
    jsonResponse(res, 200, await getSettingsPayload());
  }

  async function handleSettingsPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!sameOrigin(req)) {
      jsonResponse(res, 403, { ok: false, error: 'origin rejected' });
      return;
    }
    try {
      const body = await readBody(req);
      await applySettings(body);
      jsonResponse(res, 200, await getSettingsPayload());
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
      const updated = appMapping.rename(key, name);
      if (!updated) {
        jsonResponse(res, 404, { ok: false, error: 'application has not been recorded yet' });
        return;
      }
      void pushNotifications(true);
      void pushMedia(true);
      jsonResponse(res, 200, await getSettingsPayload());
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
        weather.resetLocation();
        void pushWeather(true);
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
      settingsStore.setDshTheme(theme);
      pushSettings(true);
      jsonResponse(res, 200, { ok: true, settings: settingsStore.public() });
    } catch (errorValue) {
      jsonResponse(res, 400, { ok: false, error: serializeError(errorValue) });
    }
  }

  async function handleTokenRotate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!sameOrigin(req)) {
      jsonResponse(res, 403, { ok: false, error: 'origin rejected' });
      return;
    }
    settingsStore.rotateToken();
    hub?.closeAll('token rotated');
    pushSettings(true);
    jsonResponse(res, 200, await getSettingsPayload());
  }

  async function handleDisconnect(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!sameOrigin(req)) {
      jsonResponse(res, 403, { ok: false, error: 'origin rejected' });
      return;
    }
    try {
      const body = await readBody(req);
      const id = safeString(body?.id, 80);
      if (id) hub?.close(id, 'disconnected by host');
      jsonResponse(res, 200, { ok: true, clients: hub?.info?.() ?? [] });
    } catch (errorValue) {
      jsonResponse(res, 400, { ok: false, error: serializeError(errorValue) });
    }
  }

  async function handleQr(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!primaryUrl) {
      textResponse(res, 503, 'Remote control server is not running');
      return;
    }
    const svg = qrSvg(remoteUrl(), { cellSize: 8, margin: 4, label: 'Remote control pairing QR code' });
    res.writeHead(200, {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(svg),
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : svg);
  }

  async function handleDisconnectRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    return handleDisconnect(req, res);
  }

  return {
    start,
    stop: stopServer,
    restart: restartServer,
    getInfo,
    handleInfo,
    handleQr,
    handleSettingsGet,
    handleSettingsPost,
    handleAppNames,
    handleLocation,
    handleTheme,
    handleTokenRotate,
    handleDisconnect: handleDisconnectRequest,
    settingsStore,
    applySettings,
    dispose() {
      disposed = true;
      pending.dispose();
      adapters.dispose();
      appMapping.dispose();
      void stopServer();
    },
  };
}
