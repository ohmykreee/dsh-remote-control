/**
 * Whitelist/clamp rules for the settings the console pushes to the phone.
 *
 * Pure and rune-free so the bounds can be unit tested; `state.svelte.ts` applies
 * the results to the live snapshot.
 */

import type { CountdownSettings, NavPosition, PomodoroSettings } from './types';

const NAV_POSITIONS: readonly NavPosition[] = ['left', 'right', 'top', 'bottom'];

export const COUNTDOWN_PRESET_LIMIT = 5;
export const COUNTDOWN_MAX_SECONDS = 86_400;
/** Presets a fresh profile starts with; the user may keep one to five. */
export const DEFAULT_COUNTDOWN_PRESETS = [60, 300, 600];

export function normalizeNavPosition(value: unknown): NavPosition {
  return NAV_POSITIONS.includes(value as NavPosition) ? (value as NavPosition) : 'left';
}

/**
 * Accept only the opaque hex accent the Host validates. Anything else clears,
 * which returns the console to its shipped palette instead of guessing a hue.
 */
export function normalizePageThemeColor(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return '';
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/u.exec(raw);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[0-9a-f]{6}$/u.test(raw) ? raw : '';
}

export function normalizePomodoro(input: Partial<PomodoroSettings> | undefined, base: PomodoroSettings): PomodoroSettings {
  const minutes = (value: unknown, fallback: number, max: number): number => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0.1, Math.min(max, Math.round(number * 100) / 100)) : fallback;
  };
  return {
    enabled: input?.enabled === true,
    focusMinutes: minutes(input?.focusMinutes, base.focusMinutes, 180),
    breakMinutes: minutes(input?.breakMinutes, base.breakMinutes, 120),
    soundPath: typeof input?.soundPath === 'string' ? input.soundPath : base.soundPath,
    loopAlarm: input?.loopAlarm === true,
  };
}

export function normalizeCountdown(
  input: Partial<CountdownSettings> | undefined,
  base: CountdownSettings,
): CountdownSettings {
  const source = Array.isArray(input?.presets) ? input.presets : [];
  const fallbackPresets = base.presets.length > 0 ? base.presets : DEFAULT_COUNTDOWN_PRESETS;
  const presets: number[] = [];
  for (const entry of source.slice(0, COUNTDOWN_PRESET_LIMIT)) {
    const seconds = Math.round(Number(entry));
    if (!Number.isFinite(seconds)) continue;
    presets.push(Math.max(1, Math.min(COUNTDOWN_MAX_SECONDS, seconds)));
  }
  return {
    enabled: input?.enabled === true,
    presets: presets.length > 0
      ? presets
      : fallbackPresets.slice(0, COUNTDOWN_PRESET_LIMIT),
  };
}
