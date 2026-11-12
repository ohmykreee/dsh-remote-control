/**
 * Peak/off-peak tariff indicator for the console balance card.
 *
 * The console decides this in the browser: weekdays in 09:00–12:00 and
 * 14:00–18:00 Beijing time are peak; everything else — including weekends and
 * statutory holidays all day — is off-peak.
 *
 * Holiday dates come exclusively from the timor.tech API, fetched by this
 * browser. There is deliberately no local holiday calendar: holiday policy can
 * change, so the API is the only authority. If it is unreachable the indicator
 * still follows the time/weekend rules, using only cached API data if present.
 */

export type TariffPeriod = 'peak' | 'offpeak';

const BEIJING_TIME_ZONE = 'Asia/Shanghai';
const HOLIDAY_API = 'https://timor.tech/api/holiday/year';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;

export interface HolidayState {
  year: number;
  status: 'idle' | 'loading' | 'ready' | 'stale' | 'error';
  days: Record<string, true>;
  source: string;
  version: number;
}

export const holidayState = $state<HolidayState>({
  year: 0,
  status: 'idle',
  days: {},
  source: '',
  version: 0,
});

interface BeijingParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

let dateTimeFormatter: Intl.DateTimeFormat | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

/** Only API-provided holiday data is authoritative; unknown days are not holidays. */
export function isStatutoryHoliday(now: Date = new Date()): boolean {
  const year = beijingYear(now);
  if (holidayState.year !== year) return false;
  if (holidayState.status !== 'ready' && holidayState.status !== 'stale') return false;
  return Boolean(holidayState.days[beijingDateKey(now)]);
}

/** Peak only on a non-holiday weekday inside the two Beijing price windows. */
export function tariffPeriod(now: Date = new Date()): TariffPeriod {
  const parts = beijingParts(now);
  if (parts.weekday === 0 || parts.weekday === 6) return 'offpeak';
  if (isStatutoryHoliday(now)) return 'offpeak';
  const minutes = parts.hour * 60 + parts.minute;
  return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60) ? 'peak' : 'offpeak';
}

function storageKey(year: number): string {
  return `dsh-rc-holiday-${year}`;
}

interface CachedHolidays {
  at: number;
  days: Set<string>;
}

function readCache(year: number): CachedHolidays | null {
  try {
    const raw = localStorage.getItem(storageKey(year));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.days) || typeof parsed.at !== 'number') return null;
    const days = new Set(parsed.days.filter((day): day is string => typeof day === 'string'));
    return days.size > 0 ? { at: parsed.at, days } : null;
  } catch {
    return null;
  }
}

function writeCache(year: number, days: Set<string>): void {
  try {
    localStorage.setItem(storageKey(year), JSON.stringify({ at: Date.now(), days: [...days] }));
  } catch {
    /* storage may be unavailable in private mode */
  }
}

function markDays(year: number, days: Set<string>, status: HolidayState['status'], source: string): void {
  holidayState.year = year;
  holidayState.days = Object.fromEntries([...days].map((day) => [day, true] as const));
  holidayState.status = status;
  holidayState.source = source;
  holidayState.version += 1;
}

function markUnavailable(year: number): void {
  holidayState.year = year;
  holidayState.days = {};
  holidayState.status = 'error';
  holidayState.source = '';
  holidayState.version += 1;
}

const inflight = new Map<number, Promise<void>>();
const failedAt = new Map<number, number>();

/**
 * Load one year of holiday data from the API in this browser. A successful
 * response is cached for a day; a failed request retries later without
 * inventing holiday dates locally.
 */
export function ensureHolidayYear(year: number): Promise<void> {
  if (holidayState.year === year && holidayState.status === 'ready') return Promise.resolve();
  if (holidayState.year === year && holidayState.status === 'error') {
    const failed = failedAt.get(year) || 0;
    if (Date.now() - failed < RETRY_MS) return Promise.resolve();
  }
  const cached = readCache(year);
  if (cached && Date.now() - cached.at <= CACHE_TTL_MS) {
    markDays(year, cached.days, 'ready', 'cache');
    return Promise.resolve();
  }
  const running = inflight.get(year);
  if (running) return running;

  holidayState.year = year;
  holidayState.status = 'loading';
  holidayState.version += 1;

  const task = (async (): Promise<void> => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      let response: Response;
      try {
        response = await fetch(`${HOLIDAY_API}/${year}/?type=Y&week=N`, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
          cache: 'no-store',
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload: unknown = await response.json();
      const map = isRecord(payload) && isRecord(payload.holiday) ? payload.holiday : null;
      if (!map) throw new Error('invalid holiday payload');
      const days = new Set<string>();
      for (const [key, value] of Object.entries(map)) {
        if (isRecord(value) && value.holiday === true) days.add(`${year}-${key}`);
      }
      if (days.size === 0) throw new Error('empty holiday payload');
      writeCache(year, days);
      markDays(year, days, 'ready', 'timor.tech');
    } catch {
      failedAt.set(year, Date.now());
      // An expired cache still contains API-provided dates; keep using it
      // rather than guessing a holiday calendar locally.
      const stale = readCache(year);
      if (stale) markDays(year, stale.days, 'stale', 'cache');
      else markUnavailable(year);
    } finally {
      inflight.delete(year);
    }
  })();
  inflight.set(year, task);
  return task;
}

if (typeof window !== 'undefined') {
  (window as unknown as { __DSH_BILLING__?: unknown }).__DSH_BILLING__ = {
    beijingDateKey,
    beijingParts,
    ensureHolidayYear,
    holidayState,
    isStatutoryHoliday,
    tariffPeriod,
  };
}
