/**
 * Beijing-time tariff helpers.
 *
 * Pure and browser-free (no runes, no storage, no network) so the price-window
 * rules can be unit tested; the holiday calendar lives in `billing.svelte.ts`.
 */

export type TariffPeriod = 'peak' | 'offpeak';

const BEIJING_TIME_ZONE = 'Asia/Shanghai';

export interface BeijingParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

let dateTimeFormatter: Intl.DateTimeFormat | null = null;

function getFormatter(): Intl.DateTimeFormat {
  dateTimeFormatter ??= new Intl.DateTimeFormat('en-US', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  return dateTimeFormatter;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function beijingParts(now: Date = new Date()): BeijingParts {
  const parts = getFormatter().formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value || '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

export function beijingDateKey(now: Date = new Date()): string {
  const parts = beijingParts(now);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function beijingYear(now: Date = new Date()): number {
  return beijingParts(now).year;
}

/** Peak only on a non-holiday weekday inside the two Beijing price windows. */
export function tariffPeriodFor(now: Date, isHoliday: boolean): TariffPeriod {
  const parts = beijingParts(now);
  if (parts.weekday === 0 || parts.weekday === 6) return 'offpeak';
  if (isHoliday) return 'offpeak';
  const minutes = parts.hour * 60 + parts.minute;
  return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60) ? 'peak' : 'offpeak';
}
