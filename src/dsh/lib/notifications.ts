/**
 * Rust-backed notification service.
 *
 * Windows/macOS read the OS notification database through `dsh-probe
 * notifications`. Linux runs `dsh-probe notifications watch`, which keeps a
 * zbus monitor of `org.freedesktop.Notifications` alive and streams a snapshot
 * per notification. There is no PowerShell/dbus-monitor fallback.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import { probeInfo, runProbe } from './probe.js';
import { isRecord } from './types.js';
import type { JsonRecord, NotificationApp, NotificationItem, NotificationPayload } from './types.js';
import { finiteNumber, safeString, serializeError } from './util.js';

const POLL_TTL_MS = 2500;
const ERROR_TTL_MS = 6000;
const WATCH_RESTART_MS = 5000;

/** Options of {@link normalizeNotificationPayload}; `limit` is clamped to 1..20. */
export interface NotificationNormalizeOptions {
  limit?: number;
  /** `errorPayload` also forwards this so the Linux watcher view stays live-only. */
  liveOnly?: boolean;
}

/** Options of {@link createNotificationService}. */
export interface NotificationServiceOptions {
  limit?: number;
}

/**
 * A normalised item with every field this module populates. The shared
 * `NotificationItem` keeps them optional because it also describes raw probe
 * input, which is untrusted.
 */
interface NormalizedNotification extends NotificationItem {
  id: string;
  appKey: string;
  appName: string;
  title: string;
  body: string;
  avatar: string | null;
  hasImage: boolean;
  receivedAt: number;
  isGroup: boolean;
}

/** Diagnostics snapshot returned by {@link NotificationService.status}. */
export interface NotificationServiceStatus {
  /** `undefined` only when the cached payload carries no `available` flag. */
  available: boolean | null | undefined;
  reason: string | null;
  count: number | null;
  updatedAt: number | null;
  liveOnly?: boolean;
}

/** Host-side notification source consumed by the console service. */
export interface NotificationService {
  getNotifications(): Promise<NotificationPayload>;
  status(): NotificationServiceStatus;
  dispose(): void;
}

function normalizeAvatar(value: unknown): string | null {
  const avatar = typeof value === 'string' ? value.trim() : '';
  return avatar.startsWith('data:image/') ? avatar : null;
}

/**
 * Normalize a probe notification payload into the shape the console expects.
 * Exported for tests; the probe normally returns this shape already.
 */
export function normalizeNotificationPayload(
  raw: unknown,
  options: NotificationNormalizeOptions = {},
): NotificationPayload {
  const limit = Math.max(1, Math.min(20, Number(options.limit) || 8));
  const payload: JsonRecord = isRecord(raw) ? raw : {};
  const available = payload.available !== false && payload.ok !== false;
  const reason = safeString(payload.reason || payload.error || '', 800) || null;
  const source = safeString(payload.source, 120) || 'dsh-probe';
  const list: unknown[] = Array.isArray(payload.notifications) ? payload.notifications : [];
  const notifications: NormalizedNotification[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const appKey = safeString(item.appKey || item.appName, 240).trim() || 'unknown';
    const appName = safeString(item.appName || item.appKey, 120).trim() || appKey;
    const title = safeString(item.title || appName, 160).trim();
    const body = safeString(item.body, 260).trim();
    if (!title && !body) continue;
    const receivedAt: number | null = finiteNumber(item.receivedAt, null);
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

  const apps: NotificationApp[] = [];
  const seen = new Map<string, NotificationApp>();
  const appList: unknown[] = Array.isArray(payload.apps) ? payload.apps : [];
  for (const app of appList) {
    if (!isRecord(app)) continue;
    const key = safeString(app.key, 240);
    if (!key || seen.has(key)) continue;
    const entry: NotificationApp = {
      key,
      name: safeString(app.name, 120) || key,
      count: Math.max(0, Math.round(finiteNumber(app.count, 0) || 0)),
    };
    seen.set(key, entry);
    apps.push(entry);
  }
  if (apps.length === 0) {
    for (const item of notifications) {
      const existing = seen.get(item.appKey);
      if (existing) existing.count += 1;
      else {
        const entry: NotificationApp = { key: item.appKey, name: item.appName, count: 1 };
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
    liveOnly: Boolean(payload.liveOnly),
    notifications,
    apps,
    updatedAt: finiteNumber(payload.updatedAt, null) || Date.now(),
  };
}

function errorPayload(reason: unknown, extra: NotificationNormalizeOptions = {}): NotificationPayload {
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

export function createNotificationService(options: NotificationServiceOptions = {}): NotificationService {
  const limit = Math.max(1, Math.min(20, Number(options.limit) || 8));
  const watchMode = process.platform === 'linux';
  let cache: NotificationPayload | null = null;
  let cacheAt = 0;
  let child: ChildProcess | null = null;
  let lines: readline.Interface | null = null;
  let watchState: NotificationPayload | null = null;
  let watchError: string | null = null;
  let watchStartedAt = 0;
  let restartAt = 0;
  let disposed = false;

  function unavailableReason(): string | null {
    const info = probeInfo();
    return info.available ? null : info.error || 'native probe unavailable';
  }

  function startWatch(): void {
    if (child || disposed) return;
    const info = probeInfo();
    if (!info.available) {
      watchError = info.error || 'native probe unavailable';
      return;
    }
    let spawned: ChildProcess;
    try {
      spawned = spawn(info.binary, ['notifications', 'watch', '--limit', String(limit)], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      watchError = serializeError(error);
      restartAt = Date.now() + WATCH_RESTART_MS;
      return;
    }
    child = spawned;
    watchStartedAt = Date.now();
    watchError = null;
    const stdout = spawned.stdout;
    if (stdout) {
      const stream = readline.createInterface({ input: stdout });
      lines = stream;
      stream.on('line', (line: string) => {
        const text = String(line).trim();
        if (!text.startsWith('{')) return;
        try {
          const parsed: unknown = JSON.parse(text);
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
    }
    const stderr = spawned.stderr;
    if (stderr) {
      stderr.setEncoding('utf8');
      stderr.on('data', (chunk: unknown) => {
        const text = String(chunk).trim();
        if (text) watchError = text.slice(0, 500);
      });
    }
    spawned.on('error', (error: Error) => {
      watchError = serializeError(error);
      watchState = null;
    });
    spawned.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
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

  async function readOneShot(): Promise<NotificationPayload> {
    const reason = unavailableReason();
    if (reason) return errorPayload(reason, { limit });
    try {
      const raw: unknown = await runProbe(['notifications', '--limit', String(limit)], { timeout: 9000 });
      return normalizeNotificationPayload(raw, { limit });
    } catch (error) {
      return errorPayload(error, { limit });
    }
  }

  async function getNotifications(): Promise<NotificationPayload> {
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

  function status(): NotificationServiceStatus {
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

  function dispose(): void {
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
