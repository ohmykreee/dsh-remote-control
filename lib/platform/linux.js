/**
 * Linux adapters: MPRIS through playerctl, PipeWire/PulseAudio/ALSA volume,
 * and live org.freedesktop.Notifications D-Bus traffic.
 */

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { basename, finiteNumber, safeString, serializeError, sniffImageMediaType } from '../util.js';

const execFileAsync = promisify(execFile);

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
    maxBuffer: 16 * 1024 * 1024,
    encoding: 'utf8',
  });
  return String(stdout).trim();
}

function unescapeDbus(value) {
  return value
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r');
}

function readIcon(icon) {
  if (!icon || !path.isAbsolute(icon)) return null;
  try {
    const stat = fs.statSync(icon);
    if (!stat.isFile() || stat.size === 0 || stat.size > 512 * 1024) return null;
    const bytes = fs.readFileSync(icon);
    const media = sniffImageMediaType(bytes) || 'image/png';
    return `data:${media};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

export function createLinuxNotifications(options = {}) {
  const limit = Math.max(1, Math.min(20, Number(options.limit) || 8));
  let child = null;
  let buffer = '';
  let items = [];
  let error = null;
  let started = false;
  let updatedAt = null;

  function ensureMonitor() {
    if (started) return;
    started = true;
    const exe = findExecutable('dbus-monitor');
    if (!exe) {
      error = 'dbus-monitor not found; install dbus tools to receive live notifications';
      return;
    }
    try {
      child = spawn(exe, ['--session', "type='method_call',interface='org.freedesktop.Notifications',member='Notify'"], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        const blocks = buffer.split(/\n\n+/);
        buffer = blocks.pop() || '';
        for (const block of blocks) consumeBlock(block);
      });
      child.stderr.on('data', (chunk) => {
        const text = String(chunk).trim();
        if (text && !text.includes('Failed to become monitor')) error = text.slice(0, 300);
      });
      child.on('error', (err) => {
        error = serializeError(err);
      });
      child.on('exit', (code) => {
        child = null;
        if (code !== 0 && !error) error = `dbus-monitor exited with code ${code}`;
      });
    } catch (err) {
      error = serializeError(err);
    }
  }

  function consumeBlock(block) {
    if (!block.includes('member=Notify') && !block.includes('member="Notify"')) return;
    const strings = [];
    for (const match of block.matchAll(/string\s+"((?:\\.|[^"\\])*)"/g)) {
      strings.push(unescapeDbus(match[1]));
    }
    if (strings.length < 3) return;
    const appName = strings[0] || '通知';
    const icon = strings[1] || '';
    const title = strings[2] || appName;
    const body = strings[3] || '';
    const receivedAt = Date.now();
    const appKey = appName;
    items = [
      {
        id: `${receivedAt}-${Math.random().toString(36).slice(2, 8)}`,
        appKey,
        appName,
        title: title.slice(0, 160),
        body: body.slice(0, 260),
        avatar: readIcon(icon),
        hasImage: false,
        receivedAt,
        isGroup: false,
      },
      ...items,
    ].slice(0, limit);
    updatedAt = receivedAt;
    error = null;
  }

  async function getNotifications() {
    ensureMonitor();
    const apps = new Map();
    for (const item of items) {
      if (!apps.has(item.appKey)) apps.set(item.appKey, { key: item.appKey, name: item.appName, count: 0 });
      apps.get(item.appKey).count += 1;
    }
    return {
      available: !error,
      reason: error,
      source: 'linux-dbus-notifications',
      liveOnly: true,
      notifications: items,
      apps: [...apps.values()].sort((a, b) => b.count - a.count),
      updatedAt: updatedAt || Date.now(),
    };
  }

  function status() {
    return {
      available: started ? !error : null,
      reason: error,
      count: items.length,
      updatedAt,
      liveOnly: true,
    };
  }

  function dispose() {
    try {
      child?.kill();
    } catch {
      /* ignore */
    }
    child = null;
  }

  return { getNotifications, status, dispose };
}

async function readSystemVolume() {
  const wpctl = findExecutable('wpctl');
  if (wpctl) {
    try {
      const text = await run(wpctl, ['get-volume', '@DEFAULT_AUDIO_SINK@']);
      const match = text.match(/Volume:\s*([0-9.]+)/i);
      const volume = match ? Number(match[1]) : 0.5;
      return { ok: true, volume: Math.max(0, Math.min(1, volume)), muted: /\[MUTED\]/i.test(text), error: null, updatedAt: Date.now(), backend: 'wpctl' };
    } catch {
      /* try pactl */
    }
  }
  const pactl = findExecutable('pactl');
  if (pactl) {
    try {
      const text = await run(pactl, ['get-sink-volume', '@DEFAULT_SINK@']);
      const match = text.match(/(\d+)%/);
      const muted = /Mute:\s*yes/i.test(await run(pactl, ['get-sink-mute', '@DEFAULT_SINK@']));
      return { ok: true, volume: match ? Number(match[1]) / 100 : 0.5, muted, error: null, updatedAt: Date.now(), backend: 'pactl' };
    } catch {
      /* try amixer */
    }
  }
  const amixer = findExecutable('amixer');
  if (amixer) {
    try {
      const text = await run(amixer, ['get', 'Master']);
      const match = text.match(/\[(\d+)%\]/);
      return { ok: true, volume: match ? Number(match[1]) / 100 : 0.5, muted: /\[off\]/i.test(text), error: null, updatedAt: Date.now(), backend: 'amixer' };
    } catch (error) {
      return { ok: false, volume: 0.5, muted: false, error: serializeError(error), updatedAt: Date.now() };
    }
  }
  return { ok: false, volume: 0.5, muted: false, error: 'No supported audio backend (wpctl, pactl, amixer)', updatedAt: Date.now() };
}

async function setSystemVolume(volume, toggleMute = false) {
  const wpctl = findExecutable('wpctl');
  if (wpctl) {
    try {
      if (toggleMute) await run(wpctl, ['set-mute', '@DEFAULT_AUDIO_SINK@', 'toggle']);
      else await run(wpctl, ['set-volume', '@DEFAULT_AUDIO_SINK@', String(Math.max(0, Math.min(1, volume)))]);
      return await readSystemVolume();
    } catch {
      /* fall through */
    }
  }
  const pactl = findExecutable('pactl');
  if (pactl) {
    try {
      if (toggleMute) await run(pactl, ['set-sink-mute', '@DEFAULT_SINK@', 'toggle']);
      else await run(pactl, ['set-sink-volume', '@DEFAULT_SINK@', `${Math.round(Math.max(0, Math.min(1, volume)) * 100)}%`]);
      return await readSystemVolume();
    } catch {
      /* fall through */
    }
  }
  const amixer = findExecutable('amixer');
  if (amixer) {
    try {
      if (toggleMute) await run(amixer, ['set', 'Master', 'toggle']);
      else await run(amixer, ['set', 'Master', `${Math.round(Math.max(0, Math.min(1, volume)) * 100)}%`]);
      return await readSystemVolume();
    } catch (error) {
      return { ok: false, volume, muted: false, error: serializeError(error), updatedAt: Date.now() };
    }
  }
  return { ok: false, volume, muted: false, error: 'No supported audio backend', updatedAt: Date.now() };
}

function playerLabel(player) {
  return String(player || '')
    .replace(/^org\.mpris\.MediaPlayer2\./, '')
    .replace(/^instance\d+\./, '')
    .replace(/[._]/g, ' ')
    .trim() || '媒体播放器';
}

async function coverFromArtUrl(url) {
  if (!url) return null;
  try {
    if (url.startsWith('data:')) return url.length < 5_000_000 ? url : null;
    if (url.startsWith('file://')) {
      const filePath = decodeURIComponent(url.slice(7));
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > 4 * 1024 * 1024) return null;
      const bytes = fs.readFileSync(filePath);
      const media = sniffImageMediaType(bytes) || 'image/jpeg';
      return `data:${media};base64,${bytes.toString('base64')}`;
    }
    if (/^https?:\/\//i.test(url)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return null;
        const type = response.headers.get('content-type') || 'image/jpeg';
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length === 0 || bytes.length > 4 * 1024 * 1024) return null;
        return `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`;
      } finally {
        clearTimeout(timer);
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function createLinuxMedia() {
  const playerctl = findExecutable('playerctl');
  let cache = null;
  let at = 0;
  let volumeCache = null;
  let volumeAt = 0;
  let selectedPlayer = null;

  async function listPlayers() {
    if (!playerctl) return [];
    try {
      const text = await run(playerctl, ['-l']);
      return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  async function choosePlayer() {
    const players = await listPlayers();
    if (players.length === 0) return null;
    if (selectedPlayer && players.includes(selectedPlayer)) {
      try {
        const status = await run(playerctl, ['-p', selectedPlayer, 'status']);
        if (/playing/i.test(status)) return selectedPlayer;
      } catch {
        /* fall through */
      }
    }
    for (const player of players) {
      try {
        const status = await run(playerctl, ['-p', player, 'status']);
        if (/playing/i.test(status)) {
          selectedPlayer = player;
          return player;
        }
      } catch {
        /* keep looking */
      }
    }
    selectedPlayer = players[0];
    return selectedPlayer;
  }

  async function readMedia() {
    if (!playerctl) {
      return { ok: false, available: false, media: null, error: 'Install playerctl for MPRIS media support', updatedAt: Date.now() };
    }
    const player = await choosePlayer();
    if (!player) return { ok: true, available: true, media: null, error: null, updatedAt: Date.now() };
    try {
      const metadata = await run(playerctl, [
        '-p',
        player,
        'metadata',
        '--format',
        '{{title}}|||{{artist}}|||{{album}}|||{{mpris:artUrl}}',
      ]);
      const [title = '', artist = '', album = '', artUrl = ''] = metadata.split('|||');
      if (!title.trim() && !artist.trim()) {
        return { ok: true, available: true, media: null, error: null, updatedAt: Date.now() };
      }
      const [statusText, positionText, lengthText] = await Promise.all([
        run(playerctl, ['-p', player, 'status']).catch(() => 'Paused'),
        run(playerctl, ['-p', player, 'position']).catch(() => '0'),
        run(playerctl, ['-p', player, 'metadata', 'mpris:length']).catch(() => '0'),
      ]);
      const position = finiteNumber(positionText, 0) || 0;
      const lengthMicros = finiteNumber(lengthText, 0) || 0;
      const duration = lengthMicros / 1_000_000;
      const thumbnail = await coverFromArtUrl(artUrl.trim());
      return {
        ok: true,
        available: true,
        media: {
          appId: player,
          title: title.trim() || '未命名媒体',
          artist: artist.trim(),
          album: album.trim(),
          albumArtist: '',
          playbackStatus: /playing/i.test(statusText) ? 'Playing' : 'Paused',
          autoRepeatMode: '',
          shuffleActive: false,
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
          thumbnailType: thumbnail ? 'image/*' : null,
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
    volumeCache = await readSystemVolume();
    volumeAt = Date.now();
    return volumeCache;
  }

  async function getState() {
    const [media, volume] = await Promise.all([getMedia(), getVolume()]);
    return { ok: media.ok || volume.ok, media, volume, sampledAt: Date.now() };
  }

  async function control(action, value = null) {
    const normalized = String(action || '').toLowerCase();
    if (normalized === 'volume') return { ok: true, action, volume: await setSystemVolume(finiteNumber(value, 0.5) ?? 0.5) };
    if (normalized === 'mute') return { ok: true, action, volume: await setSystemVolume(0.5, true) };
    if (!playerctl) throw new Error('playerctl is required for MPRIS media control');
    const player = await choosePlayer();
    if (!player) throw new Error('No MPRIS player is running');
    if (normalized === 'playpause') await run(playerctl, ['-p', player, 'play-pause']);
    else if (normalized === 'next') await run(playerctl, ['-p', player, 'next']);
    else if (normalized === 'previous') await run(playerctl, ['-p', player, 'previous']);
    else if (normalized === 'seek') await run(playerctl, ['-p', player, 'position', String(Math.max(0, finiteNumber(value, 0) ?? 0))]);
    else throw new Error('Unsupported media action');
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
