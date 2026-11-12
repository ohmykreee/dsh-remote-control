/**
 * Rust-backed notification service.
 *
 * Windows/macOS read the OS notification database through `dsh-probe
 * notifications`. Linux runs `dsh-probe notifications watch`, which keeps a
 * zbus monitor of `org.freedesktop.Notifications` alive and streams a snapshot
 * per notification. There is no PowerShell/dbus-monitor fallback.
 */

import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { probeInfo, runProbe } from './probe.js';
import { finiteNumber, safeString, serializeError } from './util.js';

const POLL_TTL_MS = 2500;
const ERROR_TTL_MS = 6000;
const WATCH_RESTART_MS = 5000;

function normalizeAvatar(value) {
  const avatar = typeof value === 'string' ? value.trim() : '';
  return avatar.startsWith('data:image/') ? avatar : null;
}

/**
 * Normalize a probe notification payload into the shape the console expects.
 * Exported for tests; the probe normally returns this shape already.
 */
export function normalizeNotificationPayload(raw, options = {}) {
  const limit = Math.max(1, Math.min(20, Number(options.limit) || 8));
  const available = raw?.available !== false && raw?.ok !== false;
  const reason = safeString(raw?.reason || raw?.error || '', 800) || null;
  const source = safeString(raw?.source, 120) || 'dsh-probe';
  const list = Array.isArray(raw?.notifications) ? raw.notifications : [];
  const notifications = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const appKey = safeString(item.appKey || item.appName, 240).trim() || 'unknown';
    const appName = safeString(item.appName || item.appKey, 120).trim() || appKey;
    const title = safeString(item.title || appName, 160).trim();
    const body = safeString(item.body, 260).trim();
    if (!title && !body) continue;
    const receivedAt = finiteNumber(item.receivedAt, null);
    notifications.push({
      id: safeString(item.id, 120) || `${receivedAt ?? Date.now()}-${notifications.length}`,
      appKey,
      appName,
      title,
      body,
      avatar: normalizeAvatar(item.avatar),
      hasImage: Boolean(item.hasImage),
      receivedAt: receivedAt && receivedAt > 0 ? Math.round(receivedAt) : Date.now(),
      isGroup: Boolean(item.isGroup),
    });
    if (notifications.length >= limit) break;
  }

  const apps = [];
  const seen = new Map();
  for (const app of Array.isArray(raw?.apps) ? raw.apps : []) {
    const key = safeString(app?.key, 240);
    if (!key || seen.has(key)) continue;
    const entry = {
      key,
      name: safeString(app?.name, 120) || key,
      count: Math.max(0, Math.round(finiteNumber(app?.count, 0) || 0)),
    };
    seen.set(key, entry);
    apps.push(entry);
  }
  if (apps.length === 0) {
    for (const item of notifications) {
      const existing = seen.get(item.appKey);
      if (existing) existing.count += 1;
      else {
        const entry = { key: item.appKey, name: item.appName, count: 1 };
        seen.set(item.appKey, entry);
        apps.push(entry);
      }
    }
  }
  apps.sort((left, right) => right.count - left.count);

  return {
    ok: available,
    available,
    reason,
    source,
    liveOnly: Boolean(raw?.liveOnly),
    notifications,
    apps,
    updatedAt: finiteNumber(raw?.updatedAt, null) || Date.now(),
  };
}

function errorPayload(reason, extra = {}) {
  return normalizeNotificationPayload(
    {
      ok: false,
      available: false,
      reason: serializeError(reason),
      source: 'dsh-probe',
      notifications: [],
      apps: [],
      ...extra,
    },
    extra,
  );
}

export function createNotificationService(options = {}) {
  const limit = Math.max(1, Math.min(20, Number(options.limit) || 8));
  const watchMode = process.platform === 'linux';
  let cache = null;
  let cacheAt = 0;
  let child = null;
  let lines = null;
  let watchState = null;
  let watchError = null;
  let watchStartedAt = 0;
  let restartAt = 0;
  let disposed = false;

  function unavailableReason() {
    const info = probeInfo();
    return info.available ? null : info.error || 'native probe unavailable';
  }

  function startWatch() {
    if (child || disposed) return;
    const info = probeInfo();
    if (!info.available) {
      watchError = info.error || 'native probe unavailable';
      return;
    }
    try {
      child = spawn(info.binary, ['notifications', 'watch', '--limit', String(limit)], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      watchError = serializeError(error);
      restartAt = Date.now() + WATCH_RESTART_MS;
      return;
    }
    watchStartedAt = Date.now();
    watchError = null;
    lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      const text = String(line).trim();
      if (!text.startsWith('{')) return;
      try {
        const parsed = JSON.parse(text);
        const state = normalizeNotificationPayload(parsed, { limit });
        if (state.available) {
          watchState = state;
          watchError = null;
        } else {
          watchState = null;
          watchError = state.reason || 'notification watcher unavailable';
        }
      } catch {
        /* ignore malformed lines */
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) watchError = text.slice(0, 500);
    });
    child.on('error', (error) => {
      watchError = serializeError(error);
      watchState = null;
    });
    child.on('exit', (code, signal) => {
      const wasStarted = Date.now() - watchStartedAt > 1000;
      child = null;
      watchState = null;
      lines?.close();
      lines = null;
      if (disposed) return;
      if (!watchError) {
        watchError = `notification watcher exited (${signal || code || 'unknown'})`;
      } else if (!wasStarted) {
        watchError = `${watchError} (exited immediately)`;
      }
      restartAt = Date.now() + WATCH_RESTART_MS;
    });
  }

  async function readOneShot() {
    const reason = unavailableReason();
    if (reason) return errorPayload(reason, { limit });
    try {
      const raw = await runProbe(['notifications', '--limit', String(limit)], { timeout: 9000 });
      return normalizeNotificationPayload(raw, { limit });
    } catch (error) {
      return errorPayload(error, { limit });
    }
  }

  async function getNotifications() {
    if (!watchMode) {
      const now = Date.now();
      const ttl = cache?.available ? POLL_TTL_MS : ERROR_TTL_MS;
      if (cache && now - cacheAt < ttl) return { ...cache, cached: true };
      cache = await readOneShot();
      cacheAt = now;
      return cache;
    }

    if (!child && !disposed && Date.now() >= restartAt) startWatch();
    if (watchState) {
      return { ...watchState, cached: false };
    }
    const reason = watchError
      || unavailableReason()
      || (child ? 'notification watcher starting' : 'notification watcher unavailable');
    return errorPayload(reason, { limit, liveOnly: true });
  }

  function status() {
    if (!watchMode) {
      return cache
        ? {
            available: cache.available,
            reason: cache.reason || null,
            count: cache.notifications?.length ?? 0,
            updatedAt: cache.updatedAt ?? null,
          }
        : { available: null, reason: null, count: null, updatedAt: null };
    }
    return {
      available: watchState ? true : watchError ? false : null,
      reason: watchError || null,
      count: watchState?.notifications?.length ?? 0,
      updatedAt: watchState?.updatedAt ?? null,
      liveOnly: true,
    };
  }

  function dispose() {
    disposed = true;
    try {
      lines?.close();
    } catch {
      /* ignore */
    }
    lines = null;
    try {
      child?.kill();
    } catch {
      /* ignore */
    }
    child = null;
  }

  return { getNotifications, status, dispose };
}
