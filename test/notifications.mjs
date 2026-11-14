import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Notification pipeline: app-name mapping, payload normalization, the missing
 * probe state, and the Linux streaming watcher.
 */

/* ------------------------------------------------------------ app mapping */

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rc-notifications-'));
const { createAppMapping, defaultAppName } = await import('../lib/app-mapping.js');

// Built-in names for well-known Windows apps.
assert.equal(defaultAppName('QQ'), 'QQ');
assert.equal(defaultAppName('Microsoft.WindowsTerminal_8wekyb3d8bbwe!App'), '终端');
assert.equal(defaultAppName('Microsoft.WindowsNotepad_8wekyb3d8bbwe!App'), '记事本');
assert.equal(defaultAppName('com.bilibili.bilibiliPC'), '哔哩哔哩');
// Generic derivation: executable paths, AUMIDs, package ids and MPRIS names.
assert.equal(defaultAppName('C:\\Tools\\player.exe'), 'player');
assert.equal(defaultAppName('com.example.SomeApp'), 'Some App');
assert.equal(defaultAppName('NotifyIconGeneratedAumid_123'), '桌面应用');
assert.equal(defaultAppName('org.mpris.MediaPlayer2.spotify'), 'Spotify');
assert.equal(defaultAppName('Microsoft.MicrosoftEdge.Stable_8wekyb3d8bbwe!App'), 'Microsoft Edge');
// Private media adapters report executable ids; MPRIS names use the same map.
assert.equal(defaultAppName('cloudmusic.exe'), '网易云音乐');
assert.equal(defaultAppName('QQMusic.exe'), 'QQ音乐');
assert.equal(defaultAppName('KuGou.exe'), '酷狗音乐');
assert.equal(defaultAppName('KwMusic.exe'), '酷我音乐');
assert.equal(defaultAppName('SodaMusic.exe'), '汽水音乐');
assert.equal(defaultAppName('WeSing.exe'), '全民K歌');
assert.equal(defaultAppName('Spotify.exe'), 'Spotify');
assert.equal(defaultAppName('AppleMusic.exe'), 'Apple Music');
assert.equal(defaultAppName('YouTube Music.exe'), 'YouTube Music');
assert.equal(defaultAppName('com.apple.Music'), 'Apple Music');
assert.equal(defaultAppName('org.mpris.MediaPlayer2.netease-cloud-music'), '网易云音乐');
assert.equal(defaultAppName(''), null);

const mapping = createAppMapping(directory);
mapping.record([{ key: 'QQ', count: 2 }, { key: 'C:\\Tools\\player.exe' }], 'notification');
mapping.record([{ key: 'org.mpris.MediaPlayer2.spotify' }], 'music');

assert.equal(mapping.displayName('QQ'), 'QQ');
assert.equal(mapping.displayName('C:\\Tools\\player.exe'), 'player');
assert.equal(mapping.displayName('org.mpris.MediaPlayer2.spotify'), 'Spotify');
assert.equal(mapping.displayName('unknown-id'), 'unknown id');

const apps = mapping.list();
assert.equal(apps.length, 3);
assert.deepEqual(apps.find((app) => app.key === 'QQ')?.sources, ['notification']);
assert.deepEqual(apps.find((app) => app.key === 'org.mpris.MediaPlayer2.spotify')?.sources, ['music']);
assert.equal(apps.find((app) => app.key === 'QQ')?.count, 2);

// Renames apply everywhere and an empty name resets the default.
assert.equal(mapping.rename('QQ', '腾讯 QQ')?.name, '腾讯 QQ');
assert.equal(mapping.rename('QQ', '')?.name, 'QQ');
assert.equal(mapping.rename('QQ', '腾讯 QQ')?.customName, '腾讯 QQ');
assert.equal(mapping.rename('not-recorded', 'x'), null);
mapping.dispose();

const reloadedMapping = createAppMapping(directory);
assert.equal(reloadedMapping.displayName('QQ'), '腾讯 QQ');
assert.equal(reloadedMapping.list().length, 3);
reloadedMapping.dispose();

// The legacy notification cache seeds the history on first start.
const legacyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rc-app-map-legacy-'));
fs.writeFileSync(
  path.join(legacyDirectory, 'notification-cache.json'),
  JSON.stringify({ version: 1, apps: { WeChat: { key: 'WeChat', name: '微信', count: 4, lastSeen: 1234 } } }),
  'utf8',
);
const migrated = createAppMapping(legacyDirectory);
const migratedApps = migrated.list();
assert.equal(migratedApps.length, 1);
assert.equal(migratedApps[0].key, 'WeChat');
assert.equal(migratedApps[0].count, 4);
assert.deepEqual(migratedApps[0].sources, ['notification']);
migrated.dispose();

/* -------------------------------------------------------- payload shapes */

// Resolve the probe to a path that cannot exist so the service reports a clean
// missing-probe error instead of a fallback list.
process.env.DSH_RC_PROBE = path.join(os.tmpdir(), 'dsh-rc-missing-probe-binary');
delete process.env.DSH_RC_DISABLE_RUST_PROBE;

const { normalizeNotificationPayload, createNotificationService } = await import('../lib/notifications.js');
const { resetProbeCache } = await import('../lib/probe.js');

const raw = {
  ok: true,
  available: true,
  source: 'test-source',
  liveOnly: true,
  notifications: [
    {
      id: '1',
      appKey: 'qq',
      appName: 'QQ',
      title: '  Hello  ',
      body: 'World',
      avatar: 'data:image/png;base64,AAAA',
      hasImage: true,
      receivedAt: 1234,
      isGroup: true,
    },
    { appKey: 'qq', appName: 'QQ', title: 'Second', body: '', receivedAt: 'bad' },
    { appKey: 'wechat', appName: '微信', title: '', body: 'Body only' },
    null,
    { title: '' },
  ],
  apps: [],
};

const normalized = normalizeNotificationPayload(raw, { limit: 2 });
assert.equal(normalized.available, true);
assert.equal(normalized.source, 'test-source');
assert.equal(normalized.liveOnly, true);
assert.equal(normalized.notifications.length, 2);
assert.equal(normalized.notifications[0].title, 'Hello');
assert.equal(normalized.notifications[0].isGroup, true);
assert.equal(normalized.notifications[1].avatar, null);
assert.ok(normalized.notifications[1].receivedAt > 0);
assert.deepEqual(normalized.apps, [{ key: 'qq', name: 'QQ', count: 2 }]);

const limited = normalizeNotificationPayload(raw, { limit: 1 });
assert.equal(limited.notifications.length, 1);
assert.deepEqual(limited.apps, [{ key: 'qq', name: 'QQ', count: 1 }]);

const failure = normalizeNotificationPayload({ ok: false, available: false, error: 'no db', notifications: [] });
assert.equal(failure.available, false);
assert.equal(failure.reason, 'no db');
assert.deepEqual(failure.notifications, []);

const defaulted = normalizeNotificationPayload({ notifications: [{ title: 'x' }] });
assert.equal(defaulted.available, true);
assert.equal(defaulted.notifications[0].appKey, 'unknown');
assert.equal(defaulted.notifications[0].appName, 'unknown');

const missingService = createNotificationService({ limit: 4 });
const missingState = await missingService.getNotifications();
assert.equal(missingState.available, false);
assert.match(String(missingState.reason), /native probe not built/);
assert.deepEqual(missingState.notifications, []);
assert.deepEqual(missingState.apps, []);
assert.equal(missingService.status().available, false);
missingService.dispose();

/* ------------------------------------------------------ Linux watch stream */

// Exercise the Linux streaming wrapper without a Linux host: point the probe at
// the current Node executable and pretend we are on Linux, then run a fake
// `notifications watch` script that emits NDJSON snapshots.
const watchDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rc-watch-'));
const script = path.join(watchDirectory, 'notifications');
fs.writeFileSync(
  script,
  `const send = (value) => console.log(JSON.stringify(value));
send({ ok: true, available: true, source: 'fake-watch', liveOnly: true, notifications: [], apps: [], updatedAt: Date.now() });
setTimeout(() => send({
  ok: true,
  available: true,
  source: 'fake-watch',
  liveOnly: true,
  notifications: [{
    id: '1', appKey: 'fake', appName: 'Fake', title: 'Streamed', body: 'Body',
    avatar: null, hasImage: false, receivedAt: Date.now(), isGroup: false
  }],
  apps: [{ key: 'fake', name: 'Fake', count: 1 }],
  updatedAt: Date.now()
}), 150);
setInterval(() => {}, 1000);
`,
  'utf8',
);

const originalPlatform = process.platform;
const originalCwd = process.cwd();
process.env.DSH_RC_PROBE = process.execPath;
resetProbeCache();
if (process.platform === 'win32') {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
}
process.chdir(watchDirectory);

const watchService = createNotificationService({ limit: 4 });

try {
  let state = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    state = await watchService.getNotifications();
    if (state.available && state.notifications.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(state.available, true);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].title, 'Streamed');
  assert.equal(state.liveOnly, true);
  assert.deepEqual(state.apps, [{ key: 'fake', name: 'Fake', count: 1 }]);
  assert.equal(watchService.status().available, true);
  assert.equal(watchService.status().count, 1);
} finally {
  watchService.dispose();
  process.chdir(originalCwd);
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  await new Promise((resolve) => setTimeout(resolve, 200));
  resetProbeCache();
  try {
    fs.rmSync(watchDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // A killed child can hold the directory briefly; the temp dir is harmless.
  }
}

fs.rmSync(directory, { recursive: true, force: true });
fs.rmSync(legacyDirectory, { recursive: true, force: true });
console.log('notifications: app names, payloads, missing probe, and Linux watch OK');
