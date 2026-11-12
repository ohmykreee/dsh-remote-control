import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DSH_RC_PROBE = path.join(os.tmpdir(), 'dsh-rc-missing-probe-binary');
delete process.env.DSH_RC_DISABLE_RUST_PROBE;

const { normalizeNotificationPayload, createNotificationService } = await import('../lib/notifications.js');

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

// A missing probe must surface a clean error, not a fallback list.
const service = createNotificationService({ limit: 4 });
const state = await service.getNotifications();
assert.equal(state.available, false);
assert.match(String(state.reason), /native probe not built/);
assert.deepEqual(state.notifications, []);
assert.deepEqual(state.apps, []);
assert.equal(service.status().available, false);
service.dispose();

console.log('notifications ok');
