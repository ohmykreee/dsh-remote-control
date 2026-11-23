import { describe, expect, it } from 'vitest';
import {
  COUNTDOWN_MAX_SECONDS,
  COUNTDOWN_PRESET_LIMIT,
  DEFAULT_COUNTDOWN_PRESETS,
  normalizeCountdown,
  normalizeNavPosition,
  normalizePageThemeColor,
  normalizePomodoro,
} from '../../src/svelte/lib/settings-normalize.ts';
import type { CountdownSettings, PomodoroSettings } from '../../src/svelte/lib/types.ts';

const pomodoroBase: PomodoroSettings = {
  enabled: false,
  focusMinutes: 25,
  breakMinutes: 5,
  soundPath: '/alarm.mp3',
  loopAlarm: false,
};

const countdownBase: CountdownSettings = { enabled: false, presets: [60, 300] };

describe('normalizeNavPosition', () => {
  it('only accepts the four known positions', () => {
    expect(normalizeNavPosition('right')).toBe('right');
    expect(normalizeNavPosition('bottom')).toBe('bottom');
    expect(normalizeNavPosition('diagonal')).toBe('left');
    expect(normalizeNavPosition(undefined)).toBe('left');
    expect(normalizeNavPosition(null)).toBe('left');
  });
});

describe('normalizePageThemeColor', () => {
  it('keeps opaque hex colors and expands the short form', () => {
    expect(normalizePageThemeColor('#AABBCC')).toBe('#aabbcc');
    expect(normalizePageThemeColor(' #abc ')).toBe('#aabbcc');
    expect(normalizePageThemeColor('#1e2f3a')).toBe('#1e2f3a');
  });

  it('clears anything the Host would reject', () => {
    expect(normalizePageThemeColor('red')).toBe('');
    expect(normalizePageThemeColor('#12345')).toBe('');
    expect(normalizePageThemeColor('#11223344')).toBe('');
    expect(normalizePageThemeColor(42)).toBe('');
    expect(normalizePageThemeColor(undefined)).toBe('');
  });
});

describe('normalizePomodoro', () => {
  it('keeps valid input and rounds minutes to two decimals', () => {
    expect(
      normalizePomodoro(
        { focusMinutes: 25.126, breakMinutes: 5.004, soundPath: '/x.mp3', loopAlarm: true },
        pomodoroBase,
      ),
    ).toEqual({
      enabled: false,
      focusMinutes: 25.13,
      breakMinutes: 5,
      soundPath: '/x.mp3',
      loopAlarm: true,
    });
  });

  it('clamps focus and break minutes to their ranges', () => {
    expect(normalizePomodoro({ focusMinutes: 500 }, pomodoroBase).focusMinutes).toBe(180);
    expect(normalizePomodoro({ focusMinutes: -3 }, pomodoroBase).focusMinutes).toBe(0.1);
    expect(normalizePomodoro({ breakMinutes: 240 }, pomodoroBase).breakMinutes).toBe(120);
    expect(normalizePomodoro({ breakMinutes: 0 }, pomodoroBase).breakMinutes).toBe(0.1);
  });

  it('falls back to the base for invalid values', () => {
    expect(
      normalizePomodoro(
        {
          enabled: 'true' as unknown as boolean,
          focusMinutes: 'abc' as unknown as number,
          soundPath: 42 as unknown as string,
          loopAlarm: 1 as unknown as boolean,
        },
        pomodoroBase,
      ),
    ).toEqual(pomodoroBase);
  });
});

describe('normalizeCountdown', () => {
  it('caps the preset count', () => {
    const result = normalizeCountdown({ presets: [1, 2, 3, 4, 5, 6, 7] }, countdownBase);

    expect(result.presets).toHaveLength(COUNTDOWN_PRESET_LIMIT);
    expect(result.presets).toEqual([1, 2, 3, 4, 5]);
  });

  it('rounds each preset and clamps it to one second..one day', () => {
    expect(normalizeCountdown({ presets: [59.6, 0, 90_000] }, countdownBase).presets).toEqual([
      60,
      1,
      COUNTDOWN_MAX_SECONDS,
    ]);
  });

  it('drops entries that are not numbers', () => {
    expect(
      normalizeCountdown({ presets: ['abc', 120] as unknown as number[] }, countdownBase).presets,
    ).toEqual([120]);
  });

  it('falls back to the base presets when nothing usable is left', () => {
    expect(normalizeCountdown({ presets: [] }, countdownBase).presets).toEqual([60, 300]);
    expect(normalizeCountdown(undefined, countdownBase).presets).toEqual([60, 300]);
    expect(
      normalizeCountdown({ presets: ['x'] as unknown as number[] }, countdownBase).presets,
    ).toEqual([60, 300]);
  });

  it('falls back to the shipped presets when the base has none', () => {
    const emptyBase: CountdownSettings = { enabled: false, presets: [] };

    expect(normalizeCountdown({ presets: [] }, emptyBase).presets).toEqual(DEFAULT_COUNTDOWN_PRESETS);
  });

  it('only enables on a strict boolean', () => {
    expect(normalizeCountdown({ enabled: true }, countdownBase).enabled).toBe(true);
    expect(
      normalizeCountdown({ enabled: 'true' as unknown as boolean }, countdownBase).enabled,
    ).toBe(false);
  });
});
