/** macOS adapters: Notification Center database, MediaRemote CLI, AppleScript volume. */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { basename, finiteNumber, safeString, serializeError } from '../util.js';

const execFileAsync = promisify(execFile);

const APP_LABELS = {
  'com.apple.Music': '音乐',
  'com.apple.iTunes': '音乐',
  'com.spotify.client': 'Spotify',
  'com.tencent.xinWeChat': '微信',
  'com.tencent.qq': 'QQ',
  'com.microsoft.teams2': 'Microsoft Teams',
  'com.microsoft.Outlook': 'Outlook',
  'com.google.Chrome': 'Google Chrome',
  'com.apple.Safari': 'Safari',
  'com.apple.mail': '邮件',
  'com.apple.reminders': '提醒事项',
  'com.apple.iCal': '日历',
};

function findExecutable(name) {
  const paths = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of paths) {
    const candidate = path.join(dir, name);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

async function run(exe, args, timeout = 10_000) {
  const { stdout } = await execFileAsync(exe, args, {
    timeout,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    encoding: 'utf8',
  });
  return String(stdout).trim();
}

function appleTimeToMs(value) {
  const n = finiteNumber(value, null);
  if (n === null || n <= 0) return null;
  const seconds = n > 10_000_000_000 ? n / 1000 : n;
  return Math.round((seconds + 978307200) * 1000);
}

function readPlistStrings(parsed) {
  const req = parsed?.req && typeof parsed.req === 'object' ? parsed.req : parsed;
  const pick = (...keys) => {
    for (const key of keys) {
      const value = req?.[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (value && typeof value === 'object') {
        if (typeof value.string === 'string' && value.string.trim()) return value.string.trim();
        if (typeof value.stringValue === 'string' && value.stringValue.trim()) return value.stringValue.trim();
      }
    }
    return '';
  };
  return {
    title: pick('titl', 'title'),
    subtitle: pick('subt', 'subtitle'),
    body: pick('body', 'mess'),
    app: pick('app', 'appName', 'bundleIdentifier'),
  };
}

async function readNotificationCenter(limit) {
  const dbPath = path.join(
    os.homedir(),
    'Library',
    'Group Containers',
    'group.com.apple.usernoted',
    'db2',
    'db',
  );
  if (!fs.existsSync(dbPath)) {
    return {
      available: false,
      reason: 'Notification Center database not found',
      notifications: [],
      apps: [],
    };
  }
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    return { available: false, reason: 'node:sqlite unavailable', notifications: [], apps: [] };
  }
  const plutil = findExecutable('plutil') || '/usr/bin/plutil';
  let db;
  const tempFiles = [];
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const tables = db
      .prepare("select name from sqlite_master where type = 'table'")
      .all()
      .map((row) => String(row.name));
    const recordTable =
      tables.find((name) => name.toLowerCase() === 'record') ||
      tables.find((name) => name.toLowerCase().includes('record'));
    if (!recordTable) throw new Error('Notification Center record table not found');
    const quoted = `"${recordTable.replace(/"/g, '""')}"`;
    const columns = db
      .prepare(`pragma table_info(${quoted})`)
      .all()
      .map((row) => String(row.name));
    const dataColumn = columns.find((name) => /^(data|plist|record)$/i.test(name)) || columns.find((name) => /data/i.test(name));
    if (!dataColumn) throw new Error('Notification Center payload column not found');
    const appColumn = columns.find((name) => /app.*id|bundle/i.test(name));
    const dateColumn = columns.find((name) => /deliver|date|time/i.test(name));
    const select = [
      `"${dataColumn.replace(/"/g, '""')}" as payload`,
      appColumn ? `"${appColumn.replace(/"/g, '""')}" as appId` : "'' as appId",
      dateColumn ? `"${dateColumn.replace(/"/g, '""')}" as deliveredAt` : '0 as deliveredAt',
    ].join(', ');
    const rows = db
      .prepare(`select ${select} from ${quoted} order by ${dateColumn ? `"${dateColumn.replace(/"/g, '""')}"` : 'rowid'} desc limit ?`)
      .all(Math.max(limit * 3, 24));

    const appNames = new Map();
    const appTable = tables.find((name) => name.toLowerCase() === 'app');
    if (appTable) {
      try {
        const appColumns = db.prepare(`pragma table_info("${appTable}")`).all().map((row) => String(row.name));
        const idCol = appColumns.find((name) => /identifier|bundle/i.test(name));
        const nameCol = appColumns.find((name) => /name|display/i.test(name));
        if (idCol && nameCol) {
          for (const row of db.prepare(`select "${idCol}" as id, "${nameCol}" as name from "${appTable}"`).all()) {
            if (row.id && row.name) appNames.set(String(row.id), String(row.name));
          }
        }
      } catch {
        /* names are optional */
      }
    }

    const notifications = [];
    const apps = new Map();
    for (const row of rows) {
      if (!row.payload) continue;
      const temp = path.join(os.tmpdir(), `dsh-rc-nc-${process.pid}-${notifications.length}.plist`);
      tempFiles.push(temp);
      try {
        fs.writeFileSync(temp, Buffer.from(row.payload));
        const json = await run(plutil, ['-convert', 'json', '-o', '-', '--', temp], 5000);
        const parsed = JSON.parse(json);
        const strings = readPlistStrings(parsed);
        const appKey = safeString(row.appId || strings.app || 'macOS', 240);
        const appName = appNames.get(appKey) || APP_LABELS[appKey] || appKey.split('.').pop() || 'macOS';
        const receivedAt = appleTimeToMs(row.deliveredAt) || Date.now();
        const title = strings.title || appName;
        const body = [strings.subtitle, strings.body].filter(Boolean).join('  ');
        if (!title && !body) continue;
        if (!apps.has(appKey)) apps.set(appKey, { key: appKey, name: appName, count: 0 });
        apps.get(appKey).count += 1;
        notifications.push({
          id: `${receivedAt}-${notifications.length}`,
          appKey,
          appName,
          title: title.slice(0, 160),
          body: body.slice(0, 260),
          avatar: null,
          hasImage: false,
          receivedAt,
          isGroup: false,
        });
      } catch {
        /* one unreadable record should not hide the rest */
      }
      if (notifications.length >= limit) break;
    }
    return {
      available: true,
      source: 'macos-notification-center',
      liveOnly: false,
      notifications,
      apps: [...apps.values()].sort((a, b) => b.count - a.count),
      updatedAt: Date.now(),
    };
  } catch (error) {
    return {
      available: false,
      reason: `Notification Center is not readable (grant Full Disk Access to the terminal/DSH): ${serializeError(error)}`,
      notifications: [],
      apps: [],
    };
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
    for (const file of tempFiles) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

export function createMacNotifications(options = {}) {
  const limit = Math.max(1, Math.min(20, Number(options.limit) || 8));
  let cache = null;
  let at = 0;
  return {
    async getNotifications() {
      if (cache && Date.now() - at < 4000) return { ...cache, cached: true };
      cache = await readNotificationCenter(limit);
      at = Date.now();
      return cache;
    },
    status() {
      return cache
        ? { available: cache.available, reason: cache.reason || null, count: cache.notifications?.length ?? 0, updatedAt: cache.updatedAt ?? null }
        : { available: null, reason: null, count: null, updatedAt: null };
    },
  };
}

function parseNowPlayingOutput(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

async function readVolume() {
  try {
    const text = await run('/usr/bin/osascript', ['-e', 'output volume of (get volume settings)']);
    const mutedText = await run('/usr/bin/osascript', ['-e', 'output muted of (get volume settings)']);
    return {
      ok: true,
      volume: Math.max(0, Math.min(1, (finiteNumber(text, 50) ?? 50) / 100)),
      muted: String(mutedText).toLowerCase() === 'true',
      error: null,
      updatedAt: Date.now(),
    };
  } catch (error) {
    return { ok: false, volume: 0.5, muted: false, error: serializeError(error), updatedAt: Date.now() };
  }
}

async function setVolume(volume, muteToggle = false) {
  try {
    if (muteToggle) {
      const current = await run('/usr/bin/osascript', ['-e', 'output muted of (get volume settings)']);
      const muted = String(current).toLowerCase() === 'true';
      await run('/usr/bin/osascript', ['-e', `set volume output muted ${muted ? 'false' : 'true'}`]);
    } else {
      const level = Math.round(Math.max(0, Math.min(1, volume)) * 100);
      await run('/usr/bin/osascript', ['-e', `set volume output volume ${level}`]);
    }
    return await readVolume();
  } catch (error) {
    return { ok: false, volume, muted: false, error: serializeError(error), updatedAt: Date.now() };
  }
}

export function createMacMedia() {
  let cache = null;
  let at = 0;
  let volumeCache = null;
  let volumeAt = 0;
  const nowPlaying = findExecutable('nowplaying-cli');

  async function readMedia() {
    if (!nowPlaying) {
      return { ok: false, available: false, media: null, error: 'Install nowplaying-cli (brew install nowplaying-cli) for system-wide Now Playing', updatedAt: Date.now() };
    }
    try {
      const output = await run(nowPlaying, [
        'get',
        'title',
        'artist',
        'album',
        'duration',
        'elapsedTime',
        'playbackRate',
        'artworkData',
        'artworkMIMEType',
      ]);
      const values = parseNowPlayingOutput(output);
      if (!values.title && !values.artist) {
        return { ok: true, available: true, media: null, error: null, updatedAt: Date.now() };
      }
      const duration = finiteNumber(values.duration, 0) || 0;
      const position = finiteNumber(values.elapsedTime, 0) || 0;
      const rate = finiteNumber(values.playbackRate, 0) || 0;
      let thumbnail = null;
      if (values.artworkData && values.artworkData.length < 8_000_000 && /^[A-Za-z0-9+/=\s]+$/.test(values.artworkData)) {
        const mime = values.artworkMIMEType || 'image/jpeg';
        thumbnail = `data:${mime};base64,${values.artworkData.replace(/\s+/g, '')}`;
      }
      return {
        ok: true,
        available: true,
        media: {
          appId: 'macOS',
          title: values.title || '未命名媒体',
          artist: values.artist || '',
          album: values.album || '',
          albumArtist: '',
          playbackStatus: rate > 0 ? 'Playing' : 'Paused',
          autoRepeatMode: values.repeatMode || '',
          shuffleActive: values.shuffleMode === '1',
          position,
          startTime: 0,
          endTime: duration,
          minSeekTime: 0,
          maxSeekTime: duration,
          lastUpdatedAt: Date.now(),
          canPlayPause: true,
          canNext: true,
          canPrevious: true,
          canSeek: duration > 0,
          thumbnail,
          thumbnailType: thumbnail ? values.artworkMIMEType || 'image/jpeg' : null,
          sampledAt: Date.now(),
        },
        error: null,
        updatedAt: Date.now(),
      };
    } catch (error) {
      return { ok: false, available: true, media: null, error: serializeError(error), updatedAt: Date.now() };
    }
  }

  async function getMedia(force = false) {
    if (!force && cache && Date.now() - at < 1400) return { ...cache, cached: true };
    cache = await readMedia();
    at = Date.now();
    return cache;
  }

  async function getVolume(force = false) {
    if (!force && volumeCache && Date.now() - volumeAt < 3000) return { ...volumeCache, cached: true };
    volumeCache = await readVolume();
    volumeAt = Date.now();
    return volumeCache;
  }

  async function getState() {
    const [media, volume] = await Promise.all([getMedia(), getVolume()]);
    return { ok: media.ok || volume.ok, media, volume, sampledAt: Date.now() };
  }

  async function control(action, value = null) {
    const normalized = String(action || '').toLowerCase();
    if (normalized === 'volume') return { ok: true, action, volume: await setVolume(finiteNumber(value, 0.5) ?? 0.5) };
    if (normalized === 'mute') return { ok: true, action, volume: await setVolume(0.5, true) };
    if (!nowPlaying) throw new Error('nowplaying-cli is required for macOS media control');
    const commands = {
      playpause: ['togglePlayPause'],
      next: ['next'],
      previous: ['previous'],
      seek: ['seek', String(Math.max(0, finiteNumber(value, 0) ?? 0))],
    };
    const args = commands[normalized];
    if (!args) throw new Error('Unsupported media action');
    await run(nowPlaying, args);
    cache = null;
    return { ok: true, action: normalized, media: await getMedia(true) };
  }

  function status() {
    return {
      media: cache ? { ok: cache.ok, available: cache.available, error: cache.error, updatedAt: cache.updatedAt } : { ok: null, available: null, error: null, updatedAt: null },
      volume: volumeCache ? { ok: volumeCache.ok, error: volumeCache.error, updatedAt: volumeCache.updatedAt } : { ok: null, error: null, updatedAt: null },
    };
  }

  return { getState, getMedia, getVolume, control, status };
}
