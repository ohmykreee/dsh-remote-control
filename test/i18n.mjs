import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rc-i18n-'));
process.env.DSH_PROFILE_DIR = profile;

const { resolveLocale, normalizeDshLocale, createSettingsStore } = await import('../lib/settings.js');
const { zh, en, hostMessage } = await import('../lib/i18n.js');

// "Follow DSH" requires an exact shipped locale id, otherwise English wins.
assert.equal(resolveLocale('dsh', 'zh'), 'zh');
assert.equal(resolveLocale('dsh', 'en'), 'en');
assert.equal(resolveLocale('dsh', 'ja'), 'en');
assert.equal(resolveLocale('dsh', 'zh-CN'), 'en', 'a regional tag is not an exact match');
assert.equal(resolveLocale('dsh', ''), 'en');
assert.equal(resolveLocale('zh', 'en'), 'zh', 'an explicit plugin choice beats DSH');
assert.equal(resolveLocale('en', 'zh'), 'en');
assert.equal(resolveLocale('zh', 'ja'), 'zh');

assert.equal(normalizeDshLocale(' ZH '), 'zh');
assert.equal(normalizeDshLocale('zh-CN'), 'zh-cn');
assert.equal(normalizeDshLocale('not a tag!'), '');
assert.equal(normalizeDshLocale(42), '');

const store = createSettingsStore();
assert.equal(store.public().language, 'dsh');
assert.equal(store.public().locale, 'en');

store.setDshLocale('zh');
assert.equal(store.get().dshLocale, 'zh');
assert.equal(store.public().locale, 'zh');

store.update({ language: 'en' });
assert.equal(store.public().locale, 'en', 'an explicit language ignores the synced DSH locale');

store.update({ language: 'dsh' });
store.setDshLocale('ja');
assert.equal(store.public().locale, 'en', 'unsupported DSH locales fall back to English');

store.setDshLocale('en');
assert.equal(store.public().locale, 'en');

// The synced locale and the preference survive a reload of the same profile.
store.update({ language: 'zh' });
store.setDshLocale('en');
const reloaded = createSettingsStore();
assert.equal(reloaded.get().language, 'zh');
assert.equal(reloaded.get().dshLocale, 'en');
assert.equal(reloaded.public().locale, 'zh');

// Both Host dictionaries must cover exactly the same keys.
assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
assert.equal(hostMessage('en', 'answerWaiting'), 'Waiting for your answer');
assert.equal(hostMessage('zh', 'answerWaiting'), '正在等待你的回答');
assert.equal(
  hostMessage('en', 'answerCountMismatch', { expected: 2, received: 1 }),
  'Answer count mismatch: expected 2, received 1',
);
assert.equal(hostMessage('zh', 'approvalPrompt', { tool: 'Bash' }), '需要允许 Bash 执行');

console.log('i18n: locale resolution, persistence, and Host dictionaries OK');
