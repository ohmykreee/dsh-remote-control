import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Exercise the Linux streaming wrapper without a Linux host: point the probe at
// the current Node executable and pretend we are on Linux, then run a fake
// `notifications watch` script that emits NDJSON snapshots.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rc-watch-'));
const script = path.join(directory, 'notifications');
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
if (process.platform === 'win32') {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
}
process.chdir(directory);

const { createNotificationService } = await import('../lib/notifications.js');
const service = createNotificationService({ limit: 4 });

try {
  let state = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    state = await service.getNotifications();
    if (state.available && state.notifications.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(state.available, true);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].title, 'Streamed');
  assert.equal(state.liveOnly, true);
  assert.deepEqual(state.apps, [{ key: 'fake', name: 'Fake', count: 1 }]);
  assert.equal(service.status().available, true);
  assert.equal(service.status().count, 1);
} finally {
  service.dispose();
  process.chdir(originalCwd);
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  await new Promise((resolve) => setTimeout(resolve, 200));
  try {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // A killed child can hold the directory briefly; the temp dir is harmless.
  }
}

console.log('notification watch ok');
