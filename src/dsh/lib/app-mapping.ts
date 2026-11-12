/**
 * Application-name mapping and history for notifications and media.
 *
 * The native probe reports only the raw OS application identity (a Windows
 * notification handler id / SMTC AUMID, or an MPRIS bus name). This module owns
 * every display name:
 *
 *  - a built-in default table for well-known Windows apps,
 *  - generic derivation for executable paths, package AUMIDs and MPRIS names,
 *  - the history of every application the console has seen (first/last seen,
 *    notification count, which console page reported it),
 *  - user renames from the "app mapping" settings tab, persisted on disk and
 *    applied to both notifications and the music player.
 */

import fs from 'node:fs';
import path from 'node:path';
import { isRecord } from './types.js';

/** Where an application id was observed. */
export type AppSource = 'notification' | 'music';

/** An application reported by the probe. */
export interface AppObservation {
  key: string;
  /** Notifications seen for this app in one snapshot (max wins). */
  count?: number;
}

/** Built-in names for well-known Windows application ids. */
const DEFAULT_APP_NAMES: Record<string, string> = {
  qq: 'QQ',
  'com.bilibili.bilibilipc': '哔哩哔哩',
  'bilbilipc': '哔哩哔哩',
  'com.squirrel.discord.discord': 'Discord',
  'com.oplus.devicespace': 'OPPO 互传',
  'dev.zcode.app': 'ZCode',
  'electron.app.zcode': 'ZCode',
  'firefoxtoast-308046b0af4a39cb': 'Firefox',
  'microsoft.screensketch_8wekyb3d8bbwe!app': '截图工具',
  'microsoft.windowsterminal_8wekyb3d8bbwe!app': '终端',
  'microsoft.visualstudiocode_8wekyb3d8bbwe!vscode': 'Visual Studio Code',
  'microsoft.microsoftedge.stable_8wekyb3d8bbwe!app': 'Microsoft Edge',
  'microsoft.outlookforwindows_8wekyb3d8bbwe!microsoft.outlookforwindows': 'Outlook',
  'microsoft.office.outlook.exe.15': 'Outlook',
  'microsoft.yourphone_8wekyb3d8bbwe!app': '手机连接',
  'microsoft.zunemusic_8wekyb3d8bbwe!microsoft.zunemusic': '媒体播放器',
  'microsoft.windowsstore_8wekyb3d8bbwe!app': 'Microsoft Store',
  'microsoft.todos_8wekyb3d8bbwe!app': 'Microsoft To Do',
  'microsoft.paint_8wekyb3d8bbwe!app': '画图',
  'microsoft.windowsnotepad_8wekyb3d8bbwe!app': '记事本',
  'microsoft.windowscalculator_8wekyb3d8bbwe!app': '计算器',
  'microsoft.windows.photos_8wekyb3d8bbwe!app': '照片',
  'windows.defender.securitycenter': 'Windows 安全中心',
  'microsoft.zunemusic_8wekyb3d8bbwe': '媒体播放器',
  'cloudmusic.exe': '网易云音乐',
  'qqmusic.exe': 'QQ音乐',
  'kugou.exe': '酷狗音乐',
  'kgmusic.exe': '酷狗音乐',
  'kwmusic.exe': '酷我音乐',
  'kwservice.exe': '酷我音乐',
  'sodamusic.exe': '汽水音乐',
  'wesing.exe': '全民K歌',
  'spotify.exe': 'Spotify',
  'applemusic.exe': 'Apple Music',
  'youtube music.exe': 'YouTube Music',
  'cider.exe': 'Cider',
};

/** One persisted application entry, as stored in `app-mapping.json`. */
interface StoredApp {
  key: string;
  customName: string | null;
  firstSeen: number;
  lastSeen: number;
  count: number;
  sources: string[];
}

/** Browser-facing application entry. */
export interface MappedApp {
  key: string;
  name: string;
  /** User override, or `null` when the default name is used. */
  customName: string | null;
  /** Built-in/derived name, `null` when nothing better than the raw id exists. */
  defaultName: string | null;
  count: number;
  firstSeen: number;
  lastSeen: number;
  sources: string[];
}

/** Storage API returned by {@link createAppMapping}. */
export interface AppMapping {
  record(observations: AppObservation[], source: AppSource): void;
  rename(key: string, name: string | null): MappedApp | null;
  displayName(key: string): string;
  list(): MappedApp[];
  get(key: string): MappedApp | null;
  flush(): void;
  dispose(): void;
}

const MAX_APPS = 300;
const MAX_NAME_CHARS = 60;
const MAX_KEY_CHARS = 240;

/** Turn `SomePascalCaseName` into `Some Pascal Case Name`. */
function spacesBetweenWords(value: string): string {
  let output = '';
  let previousLower = false;
  for (const character of value) {
    if (character === '-' || character === '_') {
      output += ' ';
    } else {
      if (character === character.toUpperCase() && character !== character.toLowerCase() && previousLower) {
        output += ' ';
      }
      output += character;
    }
    previousLower = character === character.toLowerCase() && character !== character.toUpperCase();
  }
  return output.trim();
}

/** Derive a readable name from a raw Windows/Linux application id. */
export function defaultAppName(rawKey: string): string | null {
  const key = String(rawKey || '').trim();
  if (!key) return null;
  const exact = DEFAULT_APP_NAMES[key.toLowerCase()];
  if (exact) return exact;

  // Windows executable path (desktop notification handler).
  if ((key.includes('\\') || key.includes('/')) && key.toLowerCase().endsWith('.exe')) {
    const base = key.split(/[\\/]/).pop() || key;
    return base.replace(/\.exe$/i, '') || null;
  }
  if (key.startsWith('NotifyIconGeneratedAumid_')) return '桌面应用';
  if (key.toLowerCase().startsWith('microsoft.microsoftedge')) return 'Microsoft Edge';
  if (key.toLowerCase().startsWith('microsoft.screensketch')) return '截图工具';

  // Generic media-source heuristics (SMTC AUMIDs and browser processes).
  if (/bilibili/i.test(key)) return '哔哩哔哩';
  if (/youtube[-_ ]?music|ytmusic/i.test(key)) return 'YouTube Music';
  if (/cloudmusic|netease|163music|网易云/i.test(key)) return '网易云音乐';
  if (/qqmusic|qq音乐/i.test(key)) return 'QQ音乐';
  if (/kugou|kgmusic|酷狗/i.test(key)) return '酷狗音乐';
  if (/kwmusic|kwservice|kuwo|酷我/i.test(key)) return '酷我音乐';
  if (/sodamusic|汽水音乐/i.test(key)) return '汽水音乐';
  if (/wesing|全民k歌/i.test(key)) return '全民K歌';
  if (/cider/i.test(key)) return 'Cider';
  if (/applemusic|apple[ .]music|com\.apple\.music/i.test(key)) return 'Apple Music';
  if (/spotify/i.test(key)) return 'Spotify';
  if (/msedge/i.test(key)) return 'Microsoft Edge';
  if (/brave/i.test(key)) return 'Brave';
  if (/vivaldi/i.test(key)) return 'Vivaldi';
  if (/firefox/i.test(key)) return 'Firefox';
  if (/chrome/i.test(key)) return 'Chrome';

  // MPRIS bus name: org.mpris.MediaPlayer2.<player>
  if (key.startsWith('org.mpris.MediaPlayer2.')) {
    const tail = key.slice('org.mpris.MediaPlayer2.'.length).replace(/[._-]+/g, ' ').trim();
    return tail ? tail.replace(/\b\w/g, (letter) => letter.toUpperCase()) : null;
  }

  // Windows package AUMID: Package_family!EntryPoint
  let base = key.split('!')[0];
  const underscore = base.lastIndexOf('_');
  if (underscore > 0) {
    const suffix = base.slice(underscore + 1);
    if (suffix.length >= 8 && /^[a-z0-9]+$/.test(suffix)) base = base.slice(0, underscore);
  }
  const tail = base.split('.').filter(Boolean).pop() || '';
  const spaced = spacesBetweenWords(tail);
  return spaced || null;
}

function sanitizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_CHARS);
  return name || null;
}

function sanitizeSources(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is AppSource => item === 'notification' || item === 'music'))];
}

/** Rebuild the persisted entry map, dropping records that make no sense. */
function readEntries(value: unknown): Record<string, StoredApp> {
  const apps: Record<string, StoredApp> = {};
  if (!isRecord(value)) return apps;
  for (const entry of Object.values(value)) {
    if (!isRecord(entry) || typeof entry.key !== 'string' || !entry.key) continue;
    const key = entry.key.slice(0, MAX_KEY_CHARS);
    apps[key] = {
      key,
      customName: sanitizeName(entry.customName),
      firstSeen: Number(entry.firstSeen) || Number(entry.lastSeen) || 0,
      lastSeen: Number(entry.lastSeen) || 0,
      count: Math.max(0, Math.round(Number(entry.count) || 0)),
      sources: sanitizeSources(entry.sources),
    };
  }
  return apps;
}

/** Seed the history from the pre-mapping `notification-cache.json`, if any. */
function readLegacyCache(directory: string): Record<string, StoredApp> {
  const apps: Record<string, StoredApp> = {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(directory, 'notification-cache.json'), 'utf8'));
    if (!isRecord(parsed) || !isRecord(parsed.apps)) return apps;
    for (const entry of Object.values(parsed.apps)) {
      if (!isRecord(entry) || typeof entry.key !== 'string' || !entry.key) continue;
      const key = entry.key.slice(0, MAX_KEY_CHARS);
      apps[key] = {
        key,
        customName: null,
        firstSeen: Number(entry.lastSeen) || 0,
        lastSeen: Number(entry.lastSeen) || 0,
        count: Math.max(0, Math.round(Number(entry.count) || 0)),
        sources: ['notification'],
      };
    }
  } catch {
    /* no legacy cache */
  }
  return apps;
}

export function createAppMapping(directory: string): AppMapping {
  const dir = directory;
  const file = path.join(dir, 'app-mapping.json');
  fs.mkdirSync(dir, { recursive: true });

  let apps: Record<string, StoredApp> = {};
  let loaded = false;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (isRecord(parsed) && isRecord(parsed.apps)) {
      apps = readEntries(parsed.apps);
      loaded = true;
    }
  } catch {
    apps = {};
  }
  if (!loaded) apps = readLegacyCache(dir);

  let timer: NodeJS.Timeout | null = null;

  function resolve(entry: StoredApp): MappedApp {
    const defaultName = defaultAppName(entry.key);
    return {
      key: entry.key,
      name: entry.customName || defaultName || entry.key,
      customName: entry.customName,
      defaultName,
      count: entry.count,
      firstSeen: entry.firstSeen,
      lastSeen: entry.lastSeen,
      sources: [...entry.sources],
    };
  }

  function flush(): void {
    timer = null;
    const temporary = `${file}.tmp-${process.pid}`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, updatedAt: Date.now(), apps }, null, 2), 'utf8');
      fs.renameSync(temporary, file);
    } catch {
      /* mapping must never break notifications */
    }
  }

  function schedule(): void {
    if (timer) return;
    timer = setTimeout(flush, 1200);
    timer.unref?.();
  }

  function trimToLimit(): void {
    const entries = Object.values(apps);
    if (entries.length <= MAX_APPS) return;
    entries.sort((left, right) => right.lastSeen - left.lastSeen);
    apps = Object.fromEntries(entries.slice(0, MAX_APPS).map((entry) => [entry.key, entry]));
  }

  function record(observations: AppObservation[], source: AppSource): void {
    if (!Array.isArray(observations) || observations.length === 0) return;
    let changed = false;
    const now = Date.now();
    for (const observation of observations) {
      if (!isRecord(observation)) continue;
      const rawKey = typeof observation.key === 'string' ? observation.key.trim() : '';
      if (!rawKey) continue;
      const key = rawKey.slice(0, MAX_KEY_CHARS);
      const count = Math.max(0, Math.round(Number(observation.count) || 0));
      const previous = apps[key];
      const sources = new Set(previous?.sources ?? []);
      sources.add(source);
      const sourcesChanged = sources.size !== (previous?.sources.length ?? 0);
      // Only refresh the timestamp when something changed or the last sighting
      // is old: the console polls notifications every few seconds and the file
      // should not be rewritten on every poll.
      const stale = !previous || now - previous.lastSeen > 60_000;
      if (previous && previous.count === count && !sourcesChanged && !stale) continue;
      apps[key] = {
        key,
        customName: previous?.customName ?? null,
        firstSeen: previous?.firstSeen || now,
        lastSeen: now,
        count: Math.max(count, previous?.count ?? 0),
        sources: [...sources],
      };
      changed = true;
    }
    if (changed) {
      trimToLimit();
      schedule();
    }
  }

  function rename(key: string, name: string | null): MappedApp | null {
    const rawKey = String(key || '').trim();
    if (!rawKey) return null;
    const trimmedKey = rawKey.slice(0, MAX_KEY_CHARS);
    const previous = apps[trimmedKey];
    if (!previous) return null;
    const customName = sanitizeName(name);
    if (previous.customName === customName) return resolve(previous);
    apps[trimmedKey] = { ...previous, customName };
    flush();
    return resolve(apps[trimmedKey]);
  }

  function displayName(key: string): string {
    const trimmedKey = String(key || '').trim().slice(0, MAX_KEY_CHARS);
    if (!trimmedKey) return '未知应用';
    const stored = apps[trimmedKey];
    if (stored?.customName) return stored.customName;
    return defaultAppName(trimmedKey) || trimmedKey;
  }

  function list(): MappedApp[] {
    return Object.values(apps)
      .map(resolve)
      .sort((left, right) => right.lastSeen - left.lastSeen || right.count - left.count);
  }

  function get(key: string): MappedApp | null {
    const stored = apps[String(key || '').trim().slice(0, MAX_KEY_CHARS)];
    return stored ? resolve(stored) : null;
  }

  function dispose(): void {
    if (timer) {
      clearTimeout(timer);
      flush();
    }
  }

  return { record, rename, displayName, list, get, flush, dispose };
}
