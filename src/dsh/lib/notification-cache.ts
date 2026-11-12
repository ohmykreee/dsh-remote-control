/** Local cache of notification applications seen by the plugin. */

import fs from 'node:fs';
import path from 'node:path';
import { isRecord } from './types.js';
import type { NotificationApp } from './types.js';

/** One persisted application entry, as stored in `notification-cache.json`. */
export interface CachedApp extends NotificationApp {
  lastSeen: number;
}

/** Cache API returned by {@link createNotificationCache}. */
export interface NotificationCache {
  merge(seen: NotificationApp[]): void;
  list(): CachedApp[];
  dispose(): void;
  flush(): void;
}

/**
 * Rebuild the persisted entry map, keeping only structurally usable records.
 * The file is plugin-private, so this only repairs hand-edited or partial files
 * written by older versions.
 */
function readEntries(value: unknown): Record<string, CachedApp> {
  const cached: Record<string, CachedApp> = {};
  if (!isRecord(value)) return cached;
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry) || typeof entry.key !== 'string') continue;
    cached[key] = {
      key: entry.key,
      name: typeof entry.name === 'string' ? entry.name : entry.key,
      count: Number(entry.count) || 0,
      lastSeen: Number(entry.lastSeen) || 0,
    };
  }
  return cached;
}

export function createNotificationCache(directory: string): NotificationCache {
  const dir = directory;
  const file = path.join(dir, 'notification-cache.json');
  fs.mkdirSync(dir, { recursive: true });

  let apps: Record<string, CachedApp> = {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (isRecord(parsed) && isRecord(parsed.apps)) {
      apps = readEntries(parsed.apps);
    }
  } catch {
    apps = {};
  }

  let timer: NodeJS.Timeout | null = null;

  function flush(): void {
    timer = null;
    const temporary = `${file}.tmp-${process.pid}`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, updatedAt: Date.now(), apps }, null, 2), 'utf8');
      fs.renameSync(temporary, file);
    } catch {
      /* caching must not break notifications */
    }
  }

  function schedule(): void {
    if (timer) return;
    timer = setTimeout(flush, 1200);
    timer.unref?.();
  }

  function merge(seen: NotificationApp[]): void {
    if (!Array.isArray(seen)) return;
    let changed = false;
    for (const app of seen) {
      if (!isRecord(app)) continue;
      if (typeof app.key !== 'string' || app.key.length === 0) continue;
      const key = app.key.slice(0, 240);
      const previous = apps[key];
      const next: CachedApp = {
        key,
        name: typeof app.name === 'string' && app.name.trim() ? app.name.slice(0, 80) : previous?.name || key,
        count: Math.max(Number(app.count) || 0, Number(previous?.count) || 0),
        lastSeen: Date.now(),
      };
      if (
        !previous ||
        previous.name !== next.name ||
        previous.count !== next.count ||
        Date.now() - (Number(previous.lastSeen) || 0) > 60_000
      ) {
        apps[key] = next;
        changed = true;
      }
    }
    if (changed) {
      const entries = Object.entries(apps)
        .sort((a, b) => (Number(b[1]?.lastSeen) || 0) - (Number(a[1]?.lastSeen) || 0))
        .slice(0, 200);
      apps = Object.fromEntries(entries);
      schedule();
    }
  }

  function list(): CachedApp[] {
    return Object.values(apps)
      .filter((app) => app && typeof app.key === 'string')
      .sort((a, b) => (Number(b.lastSeen) || 0) - (Number(a.lastSeen) || 0));
  }

  function dispose(): void {
    if (timer) {
      clearTimeout(timer);
      flush();
    }
  }

  return { merge, list, dispose, flush };
}
