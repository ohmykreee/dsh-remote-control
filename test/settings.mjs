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
} = await import('../lib/settings.js');
const { zh, en, hostMessage } = await import('../lib/i18n.js');

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
