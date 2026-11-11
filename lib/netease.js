/**
 * NetEase Cloud Music desktop integration.
 *
 * Cover art and like state come from the client's own local database/cache.
 * Setting the like state uses the client's local DevTools interface when it is
 * available (launch with --remote-debugging-port=9229); no web API or cookie
 * extraction is used.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { finiteNumber, sniffImageMediaType } from './util.js';

const CACHE_TTL_MS = 2200;
const COVER_TTL_MS = 5000;
const DEBUG_PORT = Number(process.env.DSH_NETEASE_DEBUG_PORT || 9229);
let dbCache = null;
let dbAt = 0;
let dbCacheKey = '';
let coverCache = null;
let coverAt = 0;
let cdpCache = null;
let cdpAt = 0;

function neteaseRoot() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  for (const name of ['Netease', 'NetEase']) {
    const root = path.join(local, name, 'CloudMusic');
    if (fs.existsSync(root)) return root;
  }
  return null;
}

function databasePath() {
  const root = neteaseRoot();
  return root ? path.join(root, 'Library', 'webdb.dat') : null;
}

function copyDatabaseForRead(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rc-netease-'));
  const target = path.join(dir, 'webdb.dat');
  fs.copyFileSync(source, target);
  return {
    target,
    cleanup() {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

async function openDatabase() {
  const source = databasePath();
  if (!source || !fs.existsSync(source)) return null;
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    return null;
  }
  try {
    return new DatabaseSync(source, { readOnly: true });
  } catch {
    const copy = copyDatabaseForRead(source);
    const db = new DatabaseSync(copy.target, { readOnly: true });
    return { db, cleanup: copy.cleanup };
  }
}

function parseRow(row) {
  try {
    return JSON.parse(row.jsonStr);
  } catch {
    return null;
  }
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()（）[\]【】'"'`]/g, '');
}

function findTrack(db, title, artist) {
  const wantedTitle = normalize(title);
  const wantedArtist = normalize(artist);
  const tables = ['historyTracks', 'dbTrack'];
  const candidates = [];
  for (const table of tables) {
    try {
      const order = table === 'historyTracks' ? 'order by playtime desc' : '';
      const rows = db.prepare(`select rowid as rowid, * from "${table}" ${order} limit 120`).all();
      for (const row of rows) {
        const data = parseRow(row);
        if (!data?.name) continue;
        const name = normalize(data.name);
        const artists = (data.artists || []).map((item) => normalize(item.name));
        let score = 0;
        if (name === wantedTitle) score += 10;
        else if (name.includes(wantedTitle) || wantedTitle.includes(name)) score += 5;
        if (wantedArtist && artists.some((item) => item === wantedArtist || item.includes(wantedArtist) || wantedArtist.includes(item))) score += 6;
        if (table === 'historyTracks') score += 1;
        if (score >= 5) candidates.push({ score, data, table });
      }
    } catch {
      /* table may not exist in an older client */
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.data || null;
}

function likedPlaylistId(db) {
  try {
    for (const row of db.prepare('select * from historyPlaylists limit 200').all()) {
      const data = parseRow(row);
      const name = String(data?.name || '');
      if (/喜欢的音乐|喜歡的音樂|liked songs/i.test(name) || data?.specialType === 5) {
        return String(row.id);
      }
    }
  } catch {
    /* optional */
  }
  return null;
}

function isLiked(db, trackId) {
  if (!trackId) return null;
  try {
    const playlistId = likedPlaylistId(db);
    if (!playlistId) return null;
    const row = db.prepare('select * from playlistTrackIds where id = ?').get(String(playlistId));
    if (!row) return null;
    const data = parseRow(row);
    if (!Array.isArray(data?.trackIds)) return null;
    return data.trackIds.some((item) => String(item.id) === String(trackId));
  } catch {
    return null;
  }
}

function latestCover() {
  const root = neteaseRoot();
  if (!root) return null;
  const dir = path.join(root, 'Statics');
  const now = Date.now();
  if (coverCache && now - coverAt < COVER_TTL_MS) return coverCache;
  try {
    const files = fs.readdirSync(dir)
      .filter((name) => /\.dat$/i.test(name))
      .map((name) => {
        const file = path.join(dir, name);
        try {
          const stat = fs.statSync(file);
          return { file, mtime: stat.mtimeMs, size: stat.size };
        } catch {
          return null;
        }
      })
      .filter((item) => item && item.size > 500 && item.size < 4 * 1024 * 1024)
      .sort((a, b) => b.mtime - a.mtime);
    for (const item of files.slice(0, 8)) {
      const bytes = fs.readFileSync(item.file);
      const type = sniffImageMediaType(bytes);
      if (!type) continue;
      const cover = `data:${type};base64,${bytes.toString('base64')}`;
      coverCache = cover;
      coverAt = now;
      return cover;
    }
  } catch {
    /* ignore */
  }
  coverCache = null;
  coverAt = now;
  return null;
}

async function readLocal(title, artist) {
  const opened = await openDatabase();
  if (!opened) return null;
  const db = opened.db || opened;
  try {
    const track = findTrack(db, title, artist);
    const cover = latestCover();
    return {
      trackId: track?.id ? String(track.id) : null,
      duration: finiteNumber(track?.duration, null) ? Number(track.duration) / 1000 : null,
      cover,
      liked: track?.id ? isLiked(db, track.id) : null,
      source: 'local-client',
    };
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    opened.cleanup?.();
  }
}

async function cdpTarget(force = false) {
  if (process.platform !== 'win32') return null;
  const now = Date.now();
  if (!force && now - cdpAt < 10_000) return cdpCache;
  cdpAt = now;
  try {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`, { signal: AbortSignal.timeout(1200) });
    if (!response.ok) {
      cdpCache = null;
      return null;
    }
    const targets = await response.json();
    cdpCache = (Array.isArray(targets) ? targets : []).find((target) => target.type === 'page' && target.webSocketDebuggerUrl) || null;
    return cdpCache;
  } catch {
    cdpCache = null;
    return null;
  }
}

async function withCdp(expression) {
  const target = await cdpTarget();
  if (!target) return { ok: false, error: '网易云未开启本地控制接口' };
  return new Promise((resolve) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      try { socket.close(); } catch { /* ignore */ }
      resolve({ ok: false, error: '网易云控制接口超时' });
    }, 3000);
    let id = 0;
    socket.addEventListener('open', () => {
      id += 1;
      socket.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true, userGesture: true },
      }));
    });
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.id !== id) return;
        clearTimeout(timer);
        socket.close();
        resolve({ ok: true, value: message.result?.result?.value ?? null });
      } catch {
        /* ignore */
      }
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      resolve({ ok: false, error: '网易云控制接口不可用' });
    });
  });
}

async function readCdpLiked() {
  const result = await withCdp(`(() => {
    const play = document.querySelector('#btn_pc_minibar_play');
    if (!play) return null;
    const bar = play.closest('.default-bar-wrapper, .vinyl-page-bar-wrapper');
    if (!bar) return null;
    const like = [...bar.querySelectorAll('button[data-log]')].find((button) => {
      try { return JSON.parse(button.getAttribute('data-log') || '{}').oid === 'btn_pc_like'; } catch { return false; }
    });
    if (!like) return null;
    const pressed = like.getAttribute('aria-pressed');
    if (pressed === 'true') return true;
    if (pressed === 'false') return false;
    try {
      const data = JSON.parse(like.getAttribute('data-log') || '{}');
      if (data.params?.type === '1') return false;
      if (data.params?.type === '0') return true;
    } catch {}
    const label = like.getAttribute('title') || like.getAttribute('aria-label');
    if (['取消喜欢', '取消红心', 'Unlike'].includes(label)) return true;
    if (['添加到我喜欢的音乐', 'Add to liked songs'].includes(label)) return false;
    return null;
  })()`);
  return result.ok ? result.value : null;
}

async function writeCdpLiked(liked) {
  const result = await withCdp(`(() => {
    const play = document.querySelector('#btn_pc_minibar_play');
    if (!play) return { ok: false, error: '播放器未就绪' };
    const bar = play.closest('.default-bar-wrapper, .vinyl-page-bar-wrapper');
    if (!bar) return { ok: false, error: '控件未就绪' };
    const like = [...bar.querySelectorAll('button[data-log]')].find((button) => {
      try { return JSON.parse(button.getAttribute('data-log') || '{}').oid === 'btn_pc_like'; } catch { return false; }
    });
    if (!like) return { ok: false, error: '未找到红心按钮' };
    const pressed = like.getAttribute('aria-pressed');
    let current = pressed === 'true' ? true : pressed === 'false' ? false : null;
    if (current === null) {
      try {
        const data = JSON.parse(like.getAttribute('data-log') || '{}');
        if (data.params?.type === '1') current = false;
        if (data.params?.type === '0') current = true;
      } catch {}
    }
    if (current === null) return { ok: false, error: '无法确认红心状态' };
    if (current !== ${liked ? 'true' : 'false'}) like.click();
    return { ok: true, liked: ${liked ? 'true' : 'false'} };
  })()`);
  if (!result.ok) return { ok: false, error: result.error };
  return result.value || { ok: false, error: '网易云未返回状态' };
}

export async function getNeteaseTrack(title, artist) {
  const now = Date.now();
  const cacheKey = `${normalize(title)}|${normalize(artist)}`;
  if (dbCache && dbCacheKey === cacheKey && now - dbAt < CACHE_TTL_MS) {
    return { ...dbCache, cover: latestCover() || dbCache.cover };
  }
  const local = await readLocal(title, artist);
  const cdpLiked = await readCdpLiked();
  const value = {
    ...(local || {}),
    liked: cdpLiked !== null ? cdpLiked : (local?.liked ?? null),
    likeWritable: Boolean(await cdpTarget()),
  };
  dbCache = value;
  dbCacheKey = cacheKey;
  dbAt = now;
  return value;
}

export async function setNeteaseLiked(liked) {
  const result = await writeCdpLiked(Boolean(liked));
  if (result?.ok) {
    if (dbCache) {
      dbCache = { ...dbCache, liked: Boolean(liked) };
      dbAt = Date.now();
    }
    cdpAt = 0;
  }
  return result;
}
