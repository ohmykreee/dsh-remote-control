/** Local cache of notification applications seen by the plugin. */

import fs from 'node:fs';
import path from 'node:path';

export function createNotificationCache(directory) {
  const dir = directory;
  const file = path.join(dir, 'notification-cache.json');
  fs.mkdirSync(dir, { recursive: true });

  let apps = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.apps && typeof parsed.apps === 'object') {
      apps = parsed.apps;
    }
  } catch {
    apps = {};
  }

  let timer = null;

  function flush() {
    timer = null;
    const temporary = `${file}.tmp-${process.pid}`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, updatedAt: Date.now(), apps }, null, 2), 'utf8');
      fs.renameSync(temporary, file);
    } catch {
      /* caching must not break notifications */
    }
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(flush, 1200);
    timer.unref?.();
  }

  function merge(seen) {
    if (!Array.isArray(seen)) return;
    let changed = false;
    for (const app of seen) {
      if (!app || typeof app.key !== 'string' || app.key.length === 0) continue;
      const key = app.key.slice(0, 240);
      const previous = apps[key];
      const next = {
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

  function list() {
    return Object.values(apps)
      .filter((app) => app && typeof app.key === 'string')
      .sort((a, b) => (Number(b.lastSeen) || 0) - (Number(a.lastSeen) || 0));
  }

  function dispose() {
    if (timer) {
      clearTimeout(timer);
      flush();
    }
  }

  return { merge, list, dispose, flush };
}
