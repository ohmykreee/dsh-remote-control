import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Settings, localization, and timer configuration.
 *
 * One profile covers locale resolution, the two Host dictionaries, countdown
 * presets, pomodoro durations, and their persistence rules.
 */

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rc-settings-'));
process.env.DSH_PROFILE_DIR = profile;

const {
  COUNTDOWN_PRESET_LIMIT,
  createSettingsStore,
  normalizeDshLocale,
  resolveLocale,
} = await import('../../lib/settings/index.js');
const { zh, en, hostMessage } = await import('../../lib/i18n/index.js');

/* ---------------------------------------------------------------- locale */

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

// The wake-lock switch is independent of the HTTPS switch and defaults off.
assert.equal(store.get().tls.advanced.wakeLock, false);
store.update({ tls: { advanced: { wakeLock: true } } });
assert.equal(store.get().tls.advanced.wakeLock, true);
assert.equal(store.public().tls.advanced.wakeLock, true);
store.update({ tls: { advanced: { wakeLock: 'yes' } } });
assert.equal(store.get().tls.advanced.wakeLock, false);

// The public settings snapshot copies the nested TLS block.
store.update({ tls: { advanced: { wakeLock: true } } });
const publicTls = store.public();
publicTls.tls.advanced.wakeLock = false;
assert.equal(store.get().tls.advanced.wakeLock, true);

// Trusted reverse proxies are stored as canonical addresses/ranges. Invalid
// entries are dropped when loading a profile; the settings API rejects them
// instead of silently saving a shorter list.
assert.deepEqual(store.get().tls.trustedProxies, []);
store.update({ tls: { trustedProxies: '127.0.0.1, 10.0.0.0/8' } });
assert.deepEqual(store.get().tls.trustedProxies, ['127.0.0.1', '10.0.0.0/8']);
store.update({ tls: { trustedProxies: ['192.168.1.7/24', 'not-an-ip'] } });
assert.deepEqual(store.get().tls.trustedProxies, ['192.168.1.0/24']);
store.update({ tls: { trustedProxies: '1.1.1.1，2.2.2.2' } });
assert.deepEqual(store.get().tls.trustedProxies, [], 'a full-width comma is not a separator');
const publicProxies = store.public();
publicProxies.tls.trustedProxies.push('1.1.1.1');
assert.deepEqual(store.get().tls.trustedProxies, [], 'the public snapshot owns its copy');
store.update({ tls: { trustedProxies: [] } });

/* ----------------------------------------------------------- custom page */

// The custom page is part of the page order but starts hidden, and an empty
// address means the phone uses its built-in page.
assert.deepEqual(store.get().pageOrder, ['home', 'sessions', 'quickqa', 'music', 'performance', 'custom']);
assert.equal(store.get().pageEnabled.custom, false);
assert.equal(store.get().customPageUrl, '');
assert.equal(store.public().pageEnabled.custom, false);
assert.equal(store.public().customPageUrl, '');

// Bare hosts gain https, http(s) survives, and everything else is dropped.
store.update({ customPageUrl: 'www.example.com/show' });
assert.equal(store.get().customPageUrl, 'https://www.example.com/show');
store.update({ customPageUrl: 'http://example.com/a?b=1' });
assert.equal(store.get().customPageUrl, 'http://example.com/a?b=1');
store.update({ customPageUrl: 'javascript://alert(1)' });
assert.equal(store.get().customPageUrl, '');
store.update({ customPageUrl: 'ftp://example.com' });
assert.equal(store.get().customPageUrl, '');
store.update({ customPageUrl: 'not a url' });
assert.equal(store.get().customPageUrl, '');

// Only an explicit true enables the page, and the public snapshot is a copy.
store.update({
  customPageUrl: 'https://example.com/',
  pageEnabled: { home: true, sessions: true, quickqa: true, music: true, performance: true, custom: true },
});
assert.equal(store.get().pageEnabled.custom, true);
const publicPage = store.public();
assert.equal(publicPage.customPageUrl, 'https://example.com/');
publicPage.pageEnabled.custom = false;
assert.equal(store.get().pageEnabled.custom, true);

// The synced locale and the preference survive a reload of the same profile.
store.update({ language: 'zh' });
store.setDshLocale('en');
const reloaded = createSettingsStore();
assert.equal(reloaded.get().language, 'zh');
assert.equal(reloaded.get().dshLocale, 'en');
assert.equal(reloaded.public().locale, 'zh');

// Image attachments are opt-in and only a strict boolean turns them on.
assert.equal(store.get().quickqa.allowImages, false);
store.update({ quickqa: { allowImages: true } });
assert.equal(store.get().quickqa.allowImages, true);
assert.equal(store.public().quickqa.allowImages, true);
store.update({ quickqa: { allowImages: 'yes' } });
assert.equal(store.get().quickqa.allowImages, false);

// Both Host dictionaries must cover exactly the same keys.
assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
assert.equal(hostMessage('en', 'answerWaiting'), 'Waiting for your answer');
assert.equal(hostMessage('zh', 'answerWaiting'), '正在等待你的回答');
assert.equal(
  hostMessage('en', 'answerCountMismatch', { expected: 2, received: 1 }),
  'Answer count mismatch: expected 2, received 1',
);
assert.equal(hostMessage('zh', 'approvalPrompt', { tool: 'Bash' }), '需要允许 Bash 执行');

/* ---------------------------------------------------------------- timers */

// Fresh profiles start with three presets and both timers off.
assert.equal(store.get().pomodoro.enabled, false);
assert.equal(store.get().countdown.enabled, false);
assert.deepEqual(store.get().countdown.presets, [60, 300, 600]);
assert.deepEqual(store.public().countdown.presets, [60, 300, 600]);

// A saved list of two or three presets keeps exactly that length; blank and
// invalid slots are dropped instead of being padded to five.
store.update({ countdown: { enabled: true, presets: [90, 600] } });
assert.equal(store.get().countdown.enabled, true);
assert.deepEqual(store.get().countdown.presets, [90, 600]);
store.update({ countdown: { presets: [30, '', 120, null] } });
assert.deepEqual(store.get().countdown.presets, [30, 120]);

// Values are whole seconds clamped to 1..86400.
store.update({ countdown: { presets: [0, 1.6, 90_000, '45'] } });
assert.deepEqual(store.get().countdown.presets, [1, 2, 86_400, 45]);

// At most five presets are kept.
store.update({ countdown: { presets: [1, 2, 3, 4, 5, 6, 7] } });
assert.deepEqual(store.get().countdown.presets, [1, 2, 3, 4, 5]);
assert.equal(store.get().countdown.presets.length, COUNTDOWN_PRESET_LIMIT);

// A fully empty list falls back to the defaults instead of leaving the
// countdown with nothing to select.
store.update({ countdown: { presets: [] } });
assert.deepEqual(store.get().countdown.presets, [60, 300, 600]);

// Pomodoro minutes accept up to two decimals and clamp to 0.1..180 / 0.1..120.
store.update({ pomodoro: { focusMinutes: 1.25, breakMinutes: 2.5 } });
assert.equal(store.get().pomodoro.focusMinutes, 1.25);
assert.equal(store.get().pomodoro.breakMinutes, 2.5);
store.update({ pomodoro: { focusMinutes: 1.234, breakMinutes: 0.05 } });
assert.equal(store.get().pomodoro.focusMinutes, 1.23);
assert.equal(store.get().pomodoro.breakMinutes, 0.1);
store.update({ pomodoro: { focusMinutes: 999, breakMinutes: 999 } });
assert.equal(store.get().pomodoro.focusMinutes, 180);
assert.equal(store.get().pomodoro.breakMinutes, 120);

// Enabling one timer disables the other, no matter which side sends the patch.
store.update({ pomodoro: { enabled: true } });
assert.equal(store.get().pomodoro.enabled, true);
assert.equal(store.get().countdown.enabled, false);
store.update({ countdown: { enabled: true } });
assert.equal(store.get().countdown.enabled, true);
assert.equal(store.get().pomodoro.enabled, false);

// The panel always posts both sections; a hand-built body that enables both
// resolves to one timer (the pomodoro wins).
store.update({ pomodoro: { enabled: true }, countdown: { enabled: true } });
assert.equal(store.get().pomodoro.enabled, true);
assert.equal(store.get().countdown.enabled, false);

// A hand-edited settings file with both timers on also resolves to one.
const raw = JSON.parse(fs.readFileSync(store.file, 'utf8'));
raw.pomodoro.enabled = true;
raw.countdown.enabled = true;
raw.countdown.presets = [300, 900];
fs.writeFileSync(store.file, JSON.stringify(raw), 'utf8');
const recreated = createSettingsStore();
assert.equal(recreated.get().pomodoro.enabled, true);
assert.equal(recreated.get().countdown.enabled, false);
assert.deepEqual(recreated.get().countdown.presets, [300, 900]);

// The public payload carries a copy, not the store's array.
const snapshot = recreated.public();
snapshot.countdown.presets.push(42);
assert.deepEqual(recreated.get().countdown.presets, [300, 900]);

fs.rmSync(profile, { recursive: true, force: true });
console.log('settings: locale, dictionaries, presets, and pomodoro durations OK');
