import { describe, expect, it } from 'vitest';
import {
  beijingDateKey,
  beijingParts,
  beijingYear,
  tariffPeriodFor,
} from '../../src/svelte/lib/billing.ts';

/** Beijing is UTC+8 all year, so these instants are stable. */
function beijing(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
}

describe('beijingParts', () => {
  it('reads the wall clock in Asia/Shanghai', () => {
    expect(beijingParts(beijing(2026, 3, 2, 9, 30))).toEqual({
      year: 2026,
      month: 3,
      day: 2,
      hour: 9,
      minute: 30,
      weekday: 1,
    });
  });
});

describe('beijingDateKey and beijingYear', () => {
  it('follow the Beijing calendar, not UTC', () => {
    // 00:30 on the 3rd in Beijing is still the 2nd in UTC.
    expect(beijingDateKey(beijing(2026, 3, 3, 0, 30))).toBe('2026-03-03');
    expect(beijingDateKey(new Date('2026-03-02T16:30:00Z'))).toBe('2026-03-03');

    // New Year's Eve in UTC is already the next year in Beijing.
    expect(beijingYear(new Date('2025-12-31T16:30:00Z'))).toBe(2026);
    expect(beijingYear(beijing(2026, 1, 1, 0, 0))).toBe(2026);
  });
});

describe('tariffPeriodFor', () => {
  const monday = (hour: number, minute = 0): Date => beijing(2026, 3, 2, hour, minute);

  it('is peak inside the two Beijing weekday windows', () => {
    expect(tariffPeriodFor(monday(8, 59), false)).toBe('offpeak');
    expect(tariffPeriodFor(monday(9, 0), false)).toBe('peak');
    expect(tariffPeriodFor(monday(11, 59), false)).toBe('peak');
    expect(tariffPeriodFor(monday(12, 0), false)).toBe('offpeak');
    expect(tariffPeriodFor(monday(13, 59), false)).toBe('offpeak');
    expect(tariffPeriodFor(monday(14, 0), false)).toBe('peak');
    expect(tariffPeriodFor(monday(17, 59), false)).toBe('peak');
    expect(tariffPeriodFor(monday(18, 0), false)).toBe('offpeak');
    expect(tariffPeriodFor(monday(23, 59), false)).toBe('offpeak');
  });

  it('is off-peak on weekends all day', () => {
    expect(tariffPeriodFor(beijing(2026, 3, 7, 10, 0), false)).toBe('offpeak');
    expect(tariffPeriodFor(beijing(2026, 3, 8, 15, 0), false)).toBe('offpeak');
  });

  it('is off-peak on a statutory holiday even inside a weekday window', () => {
    const insideWindow = beijing(2026, 3, 2, 10, 0);

    expect(tariffPeriodFor(insideWindow, false)).toBe('peak');
    expect(tariffPeriodFor(insideWindow, true)).toBe('offpeak');
  });
});
