/** Reads the Windows notification center database and normalizes toast XML. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { basename, decodeXml, safeString, serializeError, sniffImageMediaType } from './util.js';

const CACHE_TTL_MS = 2500;
const ERROR_TTL_MS = 6000;
const AVATAR_LIMIT_BYTES = 768 * 1024;

const APP_LABELS = {
  QQ: 'QQ',
  'com.bilibili.bilibiliPC': '哔哩哔哩',
  BiliBiliPC: '哔哩哔哩',
  'com.squirrel.Discord.Discord': 'Discord',
  'com.oplus.devicespace': 'OPPO 互传',
  'dev.zcode.app': 'ZCode',
  'electron.app.ZCode': 'ZCode',
  'FirefoxToast-308046B0AF4A39CB': 'Firefox',
  'Microsoft.ScreenSketch_8wekyb3d8bbwe!App': '截图工具',
  'Microsoft.WindowsTerminal_8wekyb3d8bbwe!App': '终端',
  'Microsoft.VisualStudioCode_8wekyb3d8bbwe!VSCode': 'Visual Studio Code',
  'Microsoft.MicrosoftEdge.Stable_8wekyb3d8bbwe!App': 'Microsoft Edge',
  'Microsoft.OutlookForWindows_8wekyb3d8bbwe!Microsoft.OutlookforWindows': 'Outlook',
  'Microsoft.Office.OUTLOOK.EXE.15': 'Outlook',
  'Microsoft.YourPhone_8wekyb3d8bbwe!App': '手机连接',
  'Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic': '媒体播放器',
  'Microsoft.WindowsStore_8wekyb3d8bbwe!App': 'Microsoft Store',
  'Microsoft.Todos_8wekyb3d8bbwe!App': 'Microsoft To Do',
  'Microsoft.Paint_8wekyb3d8bbwe!App': '画图',
  'Microsoft.WindowsNotepad_8wekyb3d8bbwe!App': '记事本',
  'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App': '计算器',
  'Microsoft.Windows.Photos_8wekyb3d8bbwe!App': '照片',
  'Windows.Defender.SecurityCenter': 'Windows 安全中心',
};

const avatarCache = new Map();

function appNameFromId(primaryId) {
  const id = safeString(primaryId, 240);
  if (!id) return 'Windows';
  if (APP_LABELS[id]) return APP_LABELS[id];
  if (id.startsWith('NotifyIconGeneratedAumid_')) return '桌面应用';
  if (/[\\/]/.test(id) && /\.exe$/i.test(id)) return basename(id).replace(/\.exe$/i, '');
  if (id.startsWith('Microsoft.MicrosoftEdge')) return 'Microsoft Edge';
  if (id.startsWith('Microsoft.ScreenSketch')) return '截图工具';
  let base = id.split('!')[0] || id;
  base = base.replace(/_[a-z0-9]{8,}$/i, '');
  const tail = base.split('.').filter(Boolean).pop();
  if (!tail) return id;
  return tail
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .slice(0, 48);
}

function filetimeToUnixMs(value) {
  const filetime = Number(value);
  if (!Number.isFinite(filetime) || filetime <= 0) return null;
  return Math.round(filetime / 10000 - 11644473600000);
}

function parseToastXml(payload) {
  let xml = payload;
  if (xml instanceof Uint8Array) xml = Buffer.from(xml).toString('utf8');
  else if (Buffer.isBuffer(xml)) xml = xml.toString('utf8');
  else xml = String(xml ?? '');
  const texts = [];
  for (const match of xml.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)) {
    const text = decodeXml(match[1]).replace(/\s+/g, ' ').trim();
    if (text) texts.push(text);
  }
  const images = [];
  for (const match of xml.matchAll(/<image\b([^>]*)>/gi)) {
    const attrs = match[1];
    const srcMatch = attrs.match(/\bsrc\s*=\s*"([^"]*)"/i) || attrs.match(/\bsrc\s*=\s*'([^']*)'/i);
    if (!srcMatch) continue;
    const placementMatch = attrs.match(/\bplacement\s*=\s*"([^"]*)"/i);
    images.push({
      src: decodeXml(srcMatch[1]).trim(),
      placement: placementMatch ? placementMatch[1].toLowerCase() : 'inline',
    });
  }
  const preferredImage =
    images.find((image) => image.placement === 'applogooverride')?.src ||
    images.find((image) => image.placement === 'hero')?.src ||
    images[0]?.src ||
    '';
  const launchMatch = xml.match(/\blaunch\s*=\s*"([^"]*)"/i);
  return {
    texts,
    image: preferredImage,
    launch: launchMatch ? decodeXml(launchMatch[1]) : '',
    hasInlineImage: images.some((image) => image.placement !== 'applogooverride'),
  };
}

function avatarDataUrl(filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  if (!/^[a-z]:[\\/]/i.test(filePath) && !filePath.startsWith('\\\\')) return null;
  const now = Date.now();
  const cached = avatarCache.get(filePath);
  if (cached && now - cached.at < 60_000) return cached.value;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0 || stat.size > AVATAR_LIMIT_BYTES) {
      avatarCache.set(filePath, { at: now, value: null });
      return null;
    }
    const bytes = fs.readFileSync(filePath);
    const mediaType = sniffImageMediaType(bytes);
    if (!mediaType) {
      avatarCache.set(filePath, { at: now, value: null });
      return null;
    }
    const value = `data:${mediaType};base64,${bytes.toString('base64')}`;
    avatarCache.set(filePath, { at: now, value });
    return value;
  } catch {
    avatarCache.set(filePath, { at: now, value: null });
    return null;
  }
}

function databasePath() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'Microsoft', 'Windows', 'Notifications', 'wpndatabase.db');
}

function copyDatabaseForRead(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rc-wpn-'));
  const target = path.join(dir, 'wpndatabase.db');
  fs.copyFileSync(source, target);
  for (const suffix of ['-wal', '-shm']) {
    const extra = source + suffix;
    if (fs.existsSync(extra)) {
      try {
        fs.copyFileSync(extra, target + suffix);
      } catch {
        /* A missing WAL copy still leaves a readable main database. */
      }
    }
  }
  return {
    target,
    cleanup() {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}

async function readNotificationsFromDatabase(limit) {
  if (process.platform !== 'win32') {
    return { available: false, reason: 'Windows only', notifications: [], apps: [] };
  }
  const source = databasePath();
  if (!fs.existsSync(source)) {
    return { available: false, reason: 'Windows notification database not found', notifications: [], apps: [] };
  }

  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    return {
      available: false,
      reason: 'This Node runtime does not expose node:sqlite',
      notifications: [],
      apps: [],
    };
  }

  let db;
  let copy = null;
  try {
    try {
      db = new DatabaseSync(source, { readOnly: true });
    } catch {
      copy = copyDatabaseForRead(source);
      db = new DatabaseSync(copy.target, { readOnly: true });
    }

    const rows = db
      .prepare(
        `select n.Id, n.HandlerId, n.Payload, n.Type,
                cast(n.ArrivalTime as text) as ArrivalTime,
                cast(n.ExpiryTime as text) as ExpiryTime,
                h.PrimaryId, h.HandlerType
           from Notification n
           left join NotificationHandler h on h.RecordId = n.HandlerId
          where n.Type = 'toast'
          order by cast(n.ArrivalTime as integer) desc
          limit ?`,
      )
      .all(Math.max(limit * 4, 40));

    const now = Date.now();
    const notifications = [];
    const apps = new Map();
    for (const row of rows) {
      const receivedAt = filetimeToUnixMs(row.ArrivalTime);
      if (!receivedAt || receivedAt > now + 60_000 || now - receivedAt > 7 * 24 * 60 * 60 * 1000) continue;
      const expiry = filetimeToUnixMs(row.ExpiryTime);
      if (expiry && expiry < now) continue;
      const parsed = parseToastXml(row.Payload);
      if (parsed.texts.length === 0 && !parsed.image) continue;
      const appKey = safeString(row.PrimaryId || `handler-${row.HandlerId}`, 240);
      const appName = appNameFromId(appKey);
      const title = parsed.texts[0] || appName;
      let body = parsed.texts.slice(1).join('  ');
      if (body === title) body = '';
      if (body.length > 260) body = body.slice(0, 258) + '…';
      const avatar = avatarDataUrl(parsed.image);
      if (!apps.has(appKey)) {
        apps.set(appKey, { key: appKey, name: appName, count: 0 });
      }
      apps.get(appKey).count += 1;
      notifications.push({
        id: String(row.Id),
        appKey,
        appName,
        title: title.slice(0, 160),
        body,
        avatar,
        hasImage: parsed.hasInlineImage,
        receivedAt,
        isGroup: /群|group|频道|channel/i.test(title),
      });
      if (notifications.length >= limit) break;
    }

    return {
      available: true,
      source: 'windows-notification-database',
      notifications,
      apps: [...apps.values()].sort((a, b) => b.count - a.count),
      updatedAt: now,
    };
  } catch (error) {
    return {
      available: false,
      reason: serializeError(error),
      notifications: [],
      apps: [],
      updatedAt: Date.now(),
    };
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
    copy?.cleanup();
  }
}

export function createNotificationService(options = {}) {
  const limit = Math.max(1, Math.min(20, Number(options.limit) || 8));
  let cache = null;
  let cacheAt = 0;

  async function getNotifications() {
    const now = Date.now();
    const ttl = cache?.available ? CACHE_TTL_MS : ERROR_TTL_MS;
    if (cache && now - cacheAt < ttl) return { ...cache, cached: true };
    const result = await readNotificationsFromDatabase(limit);
    cache = result;
    cacheAt = now;
    return result;
  }

  function status() {
    return cache
      ? {
          available: cache.available,
          reason: cache.reason || null,
          count: cache.notifications?.length ?? 0,
          updatedAt: cache.updatedAt ?? null,
        }
      : { available: null, reason: null, count: null, updatedAt: null };
  }

  return { getNotifications, status };
}
