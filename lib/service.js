/** LAN HTTP/WebSocket service, pairing, settings, and live device snapshots. */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAccountService } from './account.js';
import { createNotificationCache, } from './notification-cache.js';
import { createPerformanceService } from './performance.js';
import { createPlatformAdapters } from './platform/index.js';
import { qrSvg } from './qr.js';
import { collectSessions, createPendingTracker } from './sessions.js';
import { createSettingsStore } from './settings.js';
import {
  INFO_PATH,
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

const WEB_DIR = fileURLToPath(new URL('../web/', import.meta.url));
const DEFAULT_PORT = 38765;
const COOKIE_NAME = 'dsh_rc';
const BODY_LIMIT = 64 * 1024;

const MIME = {
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
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const SAFE_FILE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function safeRelativeFile(value) {
  let decoded;
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


function cookieValue(header, name) {
  if (!header) return null;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

function ipv4ToInt(ip) {
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

function intToIpv4(value) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

function prefixFromNetmask(netmask) {
  const mask = ipv4ToInt(netmask);
  if (mask === null) return null;
  let prefix = 0;
  for (let bit = 31; bit >= 0; bit -= 1) {
    if (((mask >>> bit) & 1) === 1) prefix += 1;
    else break;
  }
  return prefix;
}

function cidrFor(address, netmask) {
  const ip = ipv4ToInt(address);
  const mask = ipv4ToInt(netmask);
  if (ip === null || mask === null) return null;
  const prefix = prefixFromNetmask(netmask);
  if (prefix === null) return null;
  return { network: ip & mask, mask, prefix, cidr: `${intToIpv4(ip & mask)}/${prefix}` };
}

function normalizeIp(value) {
  const ip = String(value || '');
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function isLoopback(ip) {
  return ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.');
}

function parsePort(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : DEFAULT_PORT;
}

function jsonResponse(res, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function textResponse(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function unauthorizedPage() {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>需要配对</title>
<style>html,body{height:100%;margin:0;background:#05070d;color:#f4f7ff;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Noto Sans SC",sans-serif}main{height:100%;display:grid;place-items:center;padding:32px;box-sizing:border-box}.card{max-width:460px;padding:32px;border:1px solid #1b2436;border-radius:28px;background:#0c111c;box-shadow:0 30px 80px #0008}h1{font-size:24px;margin:0 0 12px}p{color:#93a0b8;margin:0 0 10px}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#4d6bff;margin-right:8px}</style>
<main><div class="card"><h1><span class="dot"></span>需要配对</h1><p>请从 DSH 侧边栏的远程控制台重新扫码。</p></main></html>`;
}

function readBody(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
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

export function createRemoteControlService(ctx, options = {}) {
  const log = options.log || (() => {});
  const locale = options.locale || 'zh';
  const settingsStore = createSettingsStore();
  const notificationCache = createNotificationCache(settingsStore.dir);
  const pending = createPendingTracker(ctx);
  const weather = createWeatherService();
  const performance = createPerformanceService();
  const adapters = createPlatformAdapters({ limit: 8 });
  const account = createAccountService(ctx, { locale, getSettings: settingsStore.get });
  const preferredPort = parsePort(process.env.DSH_REMOTE_CONTROL_PORT || DEFAULT_PORT);
  const startedAt = Date.now();

  let server = null;
  let hub = null;
  let port = null;
  let running = false;
  let protocol = 'http';
  let tlsActive = false;
  let tlsError = null;
  let error = null;
  let urls = [];
  let primaryUrl = '';
  let disposed = false;
  let lastWeather = null;
  let loops = null;
  const lastSnapshots = new Map();
  let notificationsBusy = false;
  let mediaBusy = false;
  let accountBusy = false;
  let weatherBusy = false;
  let performanceBusy = false;
  let performanceCache = null;
  let performanceAt = 0;

  function settings() {
    return settingsStore.get();
  }

  function effectiveTheme() {
    const value = settings();
    return value.theme === 'dsh' ? value.dshTheme : value.theme;
  }

  function interfaceEntries(withUrls = false) {
    const selected = settings().allowedInterfaces;
    const entries = [];
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

  function selectedNetworks() {
    return interfaceEntries()
      .filter((entry) => entry.selected)
      .map((entry) => cidrFor(entry.address, entry.netmask))
      .filter(Boolean);
  }

  function ipAllowed(remoteAddress) {
    const ip = normalizeIp(remoteAddress);
    if (!ip) return false;
    if (isLoopback(ip)) return true;
    const value = ipv4ToInt(ip);
    if (value === null) return false;
    return selectedNetworks().some((network) => (value & network.mask) === (network.network & network.mask));
  }

  function recomputeUrls() {
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

  function remoteTokenQuery() {
    const value = settings();
    return value.tokenEnabled ? `?token=${encodeURIComponent(value.token)}` : '';
  }

  function remoteUrl() {
    if (!primaryUrl) return '';
    return `${primaryUrl}${remoteTokenQuery()}`;
  }

  function getInfo() {
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

  function remoteSettings() {
    return {
      theme: effectiveTheme(),
      temperatureUnit: settings().temperatureUnit,
      notificationLimit: settings().notifications.limit,
      pageOrder: [...settings().pageOrder],
      pageEnabled: { ...settings().pageEnabled },
    };
  }

  function isAuthorized(req, url) {
    if (!ipAllowed(req.socket.remoteAddress)) return false;
    const value = settings();
    if (!value.tokenEnabled) return true;
    return url.searchParams.get('token') === value.token || cookieValue(req.headers.cookie, COOKIE_NAME) === value.token;
  }

  function authHeaders(url) {
    const value = settings();
    if (!value.tokenEnabled || url.searchParams.get('token') !== value.token) return {};
    return {
      'set-cookie': `${COOKIE_NAME}=${value.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${tlsActive ? '; Secure' : ''}`,
    };
  }

  async function serveStatic(req, res, pathname, extraHeaders = {}) {
    const map = {
      '/': 'index.html',
      '/index.html': 'index.html',
      '/manifest.webmanifest': 'manifest.webmanifest',
      '/icon.svg': 'icon.svg',
    };
    let file = map[pathname];
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
          "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        ...extraHeaders,
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return true;
    } catch (readError) {
      if (readError?.code === 'ENOENT' || readError?.code === 'ENOTDIR') {
        textResponse(res, 404, 'Asset not found');
      } else {
        textResponse(res, 500, `Asset unavailable: ${serializeError(readError)}`);
      }
      return true;
    }
  }

  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    const host = req.headers.host;
    return origin === `http://${host}` || origin === `https://${host}`;
  }

  async function handleRemote(req, res) {
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

  function notificationView(raw) {
    const value = settings();
    const enabled = new Set(value.notifications.enabledApps);
    const apps = notificationCache.list();
    const list = (Array.isArray(raw?.notifications) ? raw.notifications : [])
      .filter((item) => enabled.size === 0 || enabled.has(item.appKey))
      .slice(0, value.notifications.limit);
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

  async function getNotificationsView() {
    let raw;
    try {
      raw = await adapters.notifications.getNotifications();
    } catch (errorValue) {
      raw = { available: false, reason: serializeError(errorValue), notifications: [], apps: [] };
    }
    if (Array.isArray(raw.apps)) notificationCache.merge(raw.apps);
    return notificationView(raw);
  }

  async function getWeatherView() {
    const value = settings();
    let input = {};
    if (value.weather.mode === 'manual') {
      if (value.weather.latitude !== null && value.weather.longitude !== null) {
        input = {
          latitude: value.weather.latitude,
          longitude: value.weather.longitude,
          name: value.weather.name,
        };
      }
    }
    const result = await weather.getWeather(input);
    result.forecastMode = value.weather.forecastMode === 'daily' ? 'daily' : 'hourly';
    lastWeather = result;
    return result;
  }

  function decorateAccount(value) {
    const configured = settings().balance.lowThreshold;
    const threshold = configured === null || configured === '' ? null : Number(configured);
    if (
      value?.signedIn &&
      value.balance &&
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

  async function getAccountView() {
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

  async function getPerformanceView(force = false) {
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

  async function buildOverview() {
    const enabled = settings().pageEnabled;
    const [weatherResult, notificationsResult, accountResult, performanceResult] = await Promise.allSettled([
      enabled.home ? getWeatherView() : Promise.resolve(null),
      enabled.home ? getNotificationsView() : Promise.resolve(null),
      enabled.sessions ? getAccountView() : Promise.resolve(null),
      enabled.performance ? getPerformanceView() : Promise.resolve(null),
    ]);
    let sessions = [];
    let sessionsError = null;
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
          : { ok: false, error: serializeError(weatherResult.reason) },
      notifications:
        notificationsResult.status === 'fulfilled' && notificationsResult.value
          ? notificationsResult.value
          : { available: false, reason: serializeError(notificationsResult.reason), notifications: [], apps: [] },
      account:
        accountResult.status === 'fulfilled' && accountResult.value
          ? accountResult.value
          : { available: false, signedIn: false, error: serializeError(accountResult.reason), lowBalance: false },
      performance:
        performanceResult.status === 'fulfilled' && performanceResult.value
          ? performanceResult.value
          : null,
      settings: remoteSettings(),
    };
  }

  async function buildMedia() {
    try {
      const value = await adapters.media.getState();
      return value;
    } catch (errorValue) {
      return {
        ok: false,
        media: { ok: false, available: false, media: null, error: serializeError(errorValue) },
        volume: { ok: false, volume: 0.5, muted: false, error: serializeError(errorValue) },
      };
    }
  }

  function push(type, data, force = false) {
    if (!hub || hub.size() === 0) return;
    let serialized;
    try {
      serialized = JSON.stringify(data);
    } catch {
      return;
    }
    if (!force && lastSnapshots.get(type) === serialized) return;
    lastSnapshots.set(type, serialized);
    hub.broadcast({ type, data });
  }

  async function pushSessions(force = false) {
    if (!hub || hub.size() === 0 || !settings().pageEnabled.sessions) return;
    let sessions = [];
    try {
      sessions = collectSessions(ctx, pending);
    } catch {
      return;
    }
    push('sessions', sessions, force);
  }

  async function pushNotifications(force = false) {
    if (!hub || hub.size() === 0 || notificationsBusy || !settings().pageEnabled.home) return;
    notificationsBusy = true;
    try {
      const view = await getNotificationsView();
      push('notifications', view, force);
    } finally {
      notificationsBusy = false;
    }
  }

  async function pushAccount(force = false) {
    if (!hub || hub.size() === 0 || accountBusy || !settings().pageEnabled.sessions) return;
    accountBusy = true;
    try {
      const value = await getAccountView();
      push('account', value, force);
    } finally {
      accountBusy = false;
    }
  }

  async function pushWeather(force = false) {
    if (!hub || hub.size() === 0 || weatherBusy || !settings().pageEnabled.home) return;
    weatherBusy = true;
    try {
      const value = await getWeatherView();
      push('weather', value, force);
    } finally {
      weatherBusy = false;
    }
  }

  async function pushMedia(force = false) {
    if (!hub || hub.size() === 0 || mediaBusy || !settings().pageEnabled.music) return;
    mediaBusy = true;
    try {
      const value = await buildMedia();
      push('media', value, force);
    } finally {
      mediaBusy = false;
    }
  }

  async function pushPerformance(force = false) {
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

  function pushSettings(force = false) {
    push('settings', remoteSettings(), force);
  }

  function pushClients() {
    if (!hub) return;
    push('clients', hub.info(), true);
  }

  function startLoops() {
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

  function stopLoops() {
    if (!loops) return;
    for (const timer of loops) clearInterval(timer);
    loops = null;
  }

  async function sendInitial(client) {
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

  async function handleSocketMessage(client, message) {
    if (!message || typeof message !== 'object') return;
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

  function authorizeSocket(req, url) {
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

  function attachHub(instance) {
    return createWebSocketHub({
      server: instance,
      path: '/ws',
      authorize: authorizeSocket,
      onConnection(client) {
        startLoops();
        pushClients();
        void sendInitial(client);
      },
      onMessage(client, message) {
        void handleSocketMessage(client, message);
      },
      onClose() {
        if (!hub || hub.size() === 0) stopLoops();
        pushClients();
      },
    });
  }

  async function listen(instance, selectedPort) {
    await new Promise((resolve, reject) => {
      const onError = (listenError) => {
        instance.off('listening', onListening);
        reject(listenError);
      };
      const onListening = () => {
        instance.off('error', onError);
        resolve();
      };
      instance.once('error', onError);
      instance.once('listening', onListening);
      instance.listen(selectedPort, '0.0.0.0');
    });
  }

  async function createInstance() {
    const value = settings();
    let tlsOptions = null;
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
    const handler = (req, res) => {
      void handleRemote(req, res);
    };
    const instance = tlsOptions ? createHttpsServer(tlsOptions, handler) : createHttpServer(handler);
    instance.keepAliveTimeout = 30_000;
    instance.headersTimeout = 35_000;
    return instance;
  }

  async function start() {
    if (server || running || disposed) return getInfo();
    try {
      const instance = await createInstance();
      try {
        await listen(instance, preferredPort);
      } catch (listenError) {
        if (listenError?.code !== 'EADDRINUSE' || preferredPort === 0) throw listenError;
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

  async function stopServer() {
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
      await new Promise((resolve) => instance.close(() => resolve()));
    } catch {
      /* ignore */
    }
  }

  async function restartServer() {
    await stopServer();
    return start();
  }

  async function getSettingsPayload() {
    const notifications = await getNotificationsView();
    const mediaStatus = adapters.media?.status?.() || {};
    return {
      ok: true,
      settings: settingsStore.public(),
      interfaces: interfaceEntries(false),
      apps: notificationCache.list(),
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

  async function applySettings(patch) {
    const before = settingsStore.get();
    const sanitized = patch && typeof patch === 'object' ? { ...patch } : {};
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

  async function handleInfo(req, res) {
    jsonResponse(res, 200, getInfo());
  }

  async function handleSettingsGet(req, res) {
    jsonResponse(res, 200, await getSettingsPayload());
  }

  async function handleSettingsPost(req, res) {
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

  async function handleTheme(req, res) {
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

  async function handleTokenRotate(req, res) {
    if (!sameOrigin(req)) {
      jsonResponse(res, 403, { ok: false, error: 'origin rejected' });
      return;
    }
    settingsStore.rotateToken();
    hub?.closeAll('token rotated');
    pushSettings(true);
    jsonResponse(res, 200, await getSettingsPayload());
  }

  async function handleDisconnect(req, res) {
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

  async function handleQr(req, res) {
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

  async function handleDisconnectRequest(req, res) {
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
    handleTheme,
    handleTokenRotate,
    handleDisconnect: handleDisconnectRequest,
    settingsStore,
    applySettings,
    dispose() {
      disposed = true;
      pending.dispose();
      adapters.dispose();
      notificationCache.dispose();
      void stopServer();
    },
  };
}
