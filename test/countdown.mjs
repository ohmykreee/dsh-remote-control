import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rc-countdown-'));
process.env.DSH_PROFILE_DIR = profile;

const { COUNTDOWN_PRESET_LIMIT, createSettingsStore } = await import('../lib/settings.js');

const store = createSettingsStore();

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
const reloaded = createSettingsStore();
assert.equal(reloaded.get().pomodoro.enabled, true);
assert.equal(reloaded.get().countdown.enabled, false);
assert.deepEqual(reloaded.get().countdown.presets, [300, 900]);

// The public payload carries a copy, not the store's array.
const snapshot = reloaded.public();
snapshot.countdown.presets.push(42);
assert.deepEqual(reloaded.get().countdown.presets, [300, 900]);

console.log('countdown: presets, limits, and timer exclusivity OK');
