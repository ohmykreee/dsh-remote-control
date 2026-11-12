import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rc-app-map-'));
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

const store = createAppMapping(directory);
store.record([{ key: 'QQ', count: 2 }, { key: 'C:\\Tools\\player.exe' }], 'notification');
store.record([{ key: 'org.mpris.MediaPlayer2.spotify' }], 'music');

assert.equal(store.displayName('QQ'), 'QQ');
assert.equal(store.displayName('C:\\Tools\\player.exe'), 'player');
assert.equal(store.displayName('org.mpris.MediaPlayer2.spotify'), 'Spotify');
assert.equal(store.displayName('unknown-id'), 'unknown id');

const apps = store.list();
assert.equal(apps.length, 3);
assert.deepEqual(apps.find((app) => app.key === 'QQ')?.sources, ['notification']);
assert.deepEqual(apps.find((app) => app.key === 'org.mpris.MediaPlayer2.spotify')?.sources, ['music']);
assert.equal(apps.find((app) => app.key === 'QQ')?.count, 2);

// Renames apply everywhere and an empty name resets the default.
assert.equal(store.rename('QQ', '腾讯 QQ')?.name, '腾讯 QQ');
assert.equal(store.rename('QQ', '')?.name, 'QQ');
assert.equal(store.rename('QQ', '腾讯 QQ')?.customName, '腾讯 QQ');
assert.equal(store.rename('not-recorded', 'x'), null);
store.dispose();

const reloaded = createAppMapping(directory);
assert.equal(reloaded.displayName('QQ'), '腾讯 QQ');
assert.equal(reloaded.list().length, 3);
reloaded.dispose();

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

fs.rmSync(directory, { recursive: true, force: true });
fs.rmSync(legacyDirectory, { recursive: true, force: true });
console.log('app mapping ok');
