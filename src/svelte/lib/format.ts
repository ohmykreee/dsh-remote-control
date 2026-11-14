import type { TemperatureUnit } from './types';
import { isChinese, localeTag, t, type MessageKey } from './i18n.svelte';

/** Shared formatting helpers, ported from the original web/app.js. */

export function pad(value: string | number): string {
  return String(value).padStart(2, '0');
}

export function timeAgo(timestamp: number | undefined, now = Date.now()): string {
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.max(0, Math.round((now - (timestamp as number)) / 1000));
  if (seconds < 45) return t('justNow');
  if (seconds < 3600) return t('minutesAgo', { count: Math.floor(seconds / 60) });
  if (seconds < 86400) return t('hoursAgo', { count: Math.floor(seconds / 3600) });
  return t('daysAgo', { count: Math.floor(seconds / 86400) });
}

const LUNAR_DAYS = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十', '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];

const SOLAR_TERM_KEYS: readonly MessageKey[] = [
  'termMinorCold', 'termMajorCold', 'termStartOfSpring', 'termRainWater', 'termAwakening', 'termSpringEquinox',
  'termClearAndBright', 'termGrainRain', 'termStartOfSummer', 'termGrainFull', 'termGrainInEar', 'termSummerSolstice',
  'termMinorHeat', 'termMajorHeat', 'termStartOfAutumn', 'termEndOfHeat', 'termWhiteDew', 'termAutumnEquinox',
  'termColdDew', 'termFrostDescent', 'termStartOfWinter', 'termMinorSnow', 'termMajorSnow', 'termWinterSolstice',
];

const SOLAR_TERM_MINUTES = [0, 21208, 42467, 63836, 85337, 107014, 128867, 150921, 173149, 195551, 218072, 240693, 263343, 285989, 308563, 331033, 353350, 375494, 397447, 419210, 440795, 462224, 483532, 504758];

let lunarFormatter: Intl.DateTimeFormat | null = null;
function getLunarFormatter(): Intl.DateTimeFormat | null {
  if (lunarFormatter) return lunarFormatter;
  try {
    lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' });
  } catch {
    lunarFormatter = null;
  }
  return lunarFormatter;
}

/** Lunar month/day text; the Chinese calendar labels only make sense in zh. */
export function lunarDateText(date: Date): string {
  if (!isChinese()) return '';
  const formatter = getLunarFormatter();
  if (!formatter) return '';
  try {
    const parts = formatter.formatToParts(date);
    const month = parts.find((part) => part.type === 'month')?.value || '';
    const day = Number(parts.find((part) => part.type === 'day')?.value);
    if (!month || !Number.isInteger(day) || day < 1 || day > 30) return '';
    return `${month}${LUNAR_DAYS[day - 1]}`;
  } catch {
    return '';
  }
}

/** Which of the 24 solar terms falls on the given date, if any. */
export function solarTermForDate(date: Date): MessageKey | null {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  for (let index = 0; index < SOLAR_TERM_KEYS.length; index += 1) {
    const term = new Date(31556925974.7 * (year - 1900) + SOLAR_TERM_MINUTES[index] * 60000 + Date.UTC(1900, 0, 6, 2, 5));
    if (term.getUTCFullYear() === year && term.getUTCMonth() === month && term.getUTCDate() === day) {
      return SOLAR_TERM_KEYS[index];
    }
  }
  return null;
}

export interface ClockParts {
  time: string;
  seconds: string;
  greeting: string;
  periodLabel: string;
  dateLabel: string;
}

export function clockParts(date: Date): ClockParts {
  const hour = date.getHours();
  let greeting = 'greetingEvening';
  let period = 'periodEvening';
  if (hour >= 5 && hour < 11) {
    greeting = 'greetingMorning';
    period = 'periodMorning';
  } else if (hour >= 11 && hour < 13) {
    greeting = 'greetingNoon';
    period = 'periodNoon';
  } else if (hour >= 13 && hour < 18) {
    greeting = 'greetingAfternoon';
    period = 'periodAfternoon';
  }
  const lunar = lunarDateText(date);
  const solarTerm = solarTermForDate(date);
  // Chinese keeps lunar/solar-term detail with a period fallback; English shows
  // the solar term when present and nothing otherwise, so the clock has no
  // placeholder line like "Afternoon".
  const periodLabel = isChinese()
    ? ([lunar, solarTerm ? t(solarTerm) : ''].filter(Boolean).join(' · ') || t(period as MessageKey))
    : (solarTerm ? t(solarTerm) : '');
  return {
    time: `${pad(hour)}:${pad(date.getMinutes())}`,
    seconds: pad(date.getSeconds()),
    greeting: t(greeting as MessageKey),
    periodLabel,
    dateLabel: new Intl.DateTimeFormat(localeTag(), { month: 'long', day: 'numeric', weekday: 'short' }).format(date),
  };
}

export function formatMoney(value: unknown, currency = 'CNY'): string {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
  const symbol = String(currency || '').toUpperCase() === 'USD' ? '$' : '¥';
  const abs = Math.abs(Number(value));
  const digits = abs > 0 && abs < 1 ? 4 : 2;
  return `${symbol}${Number(value).toFixed(digits).replace(/\.?0+$/, '')}`;
}

export function currencySymbol(currency?: string): string {
  return String(currency || '').toUpperCase() === 'USD' ? '$' : '¥';
}

export function formatDuration(seconds: unknown): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

/** Elapsed time since the open DSH turn started (`h:mm:ss` past an hour). */
export function runningDuration(since: number | null | undefined, now = Date.now()): string {
  if (!Number.isFinite(since)) return '';
  const total = Math.max(0, Math.floor((now - (since as number)) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function formatBytes(value: unknown): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let size = bytes;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
}

export function formatUptime(seconds: unknown): string {
  const total = Math.max(0, Number(seconds) || 0);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return t('uptimeDays', { days, hours });
  if (hours > 0) return t('uptimeHours', { hours, minutes });
  return t('uptimeMinutes', { minutes });
}

export function appInitial(name?: string, title?: string): string {
  return Array.from(String(name || title || '?').trim())[0]?.toUpperCase() || '?';
}

export function appGradient(key?: string): string {
  let hash = 0;
  for (const char of String(key || 'app')) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return `linear-gradient(145deg, hsl(${hash} 45% 30%), hsl(${(hash + 46) % 360} 48% 20%))`;
}

export function sourceLabel(appId?: string): string {
  const id = String(appId || '');
  if (/bilibili/i.test(id)) return t('sourceBilibili');
  if (/spotify/i.test(id)) return 'Spotify';
  if (/msedge/i.test(id)) return 'Edge';
  if (/brave/i.test(id)) return 'Brave';
  if (/vivaldi/i.test(id)) return 'Vivaldi';
  if (/firefox/i.test(id)) return 'Firefox';
  if (/Music/i.test(id)) return t('musicSource');
  if (/chrome/i.test(id)) return 'Chrome';
  if (id === 'macOS') return 'macOS';
  if (id.startsWith('org.mpris.MediaPlayer2.')) return id.replace('org.mpris.MediaPlayer2.', '').replace(/[._]/g, ' ');
  return id.split('.').pop()?.replace(/[._-]/g, ' ') || t('mediaFallback');
}

export function temperatureUnitLabel(unit: TemperatureUnit): string {
  return unit === 'fahrenheit' ? '°F' : '°C';
}

export function toDisplayTemperature(value: unknown, unit: TemperatureUnit): number | null {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return unit === 'fahrenheit' ? (number * 9) / 5 + 32 : number;
}

export function formatTemperature(value: unknown, unit: TemperatureUnit, digits = 0): string {
  const number = toDisplayTemperature(value, unit);
  if (number === null) return '--';
  return `${digits > 0 ? number.toFixed(digits) : Math.round(number)}${temperatureUnitLabel(unit)}`;
}
