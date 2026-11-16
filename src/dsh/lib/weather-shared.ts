/** Shared helpers for the weather providers: HTTP, condition codes, AQI. */

import { isRecord } from './types.js';
import type { JsonRecord } from './types.js';
import { safeString, serializeError } from './util.js';
import type { AirQuality } from './weather-types.js';

export const WEATHER_USER_AGENT = 'dsh-remote-control/1.0 (+local smart display)';

export class HttpError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export interface FetchJsonOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export async function fetchJson(url: string, options: FetchJsonOptions = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 9000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'accept-encoding': 'gzip',
        'user-agent': WEATHER_USER_AGENT,
        ...(options.headers ?? {}),
      },
    });
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = null;
      }
    }
    if (!response.ok) {
      const detail = errorDetail(payload);
      throw new HttpError(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`, response.status);
    }
    return payload;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(serializeError(error));
  } finally {
    clearTimeout(timer);
  }
}

/** Pull a human-readable message out of a provider error body. */
export function errorDetail(payload: unknown): string {
  if (!isRecord(payload)) return '';
  const error = isRecord(payload.error) ? payload.error : null;
  if (error) {
    const title = safeString(error.title, 120);
    const status = safeString(error.status, 20);
    return title || (status ? `status ${status}` : '');
  }
  const message = safeString(payload.message, 120);
  if (message) return message;
  const code = safeString(payload.code, 20);
  return code && code !== '200' ? `code ${code}` : '';
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** QWeather condition codes (100..999) mapped to the console's WMO ranges. */
export function mapQWeatherCode(value: unknown): number {
  const code = numberOrNull(value);
  if (code === null) return 3;
  if (code === 100 || code === 150 || code === 900 || code === 901) return 0;
  if ([101, 102, 103, 151, 152, 153].includes(code)) return 2;
  if (code === 104 || code === 154) return 3;
  if ([300, 301, 350, 351].includes(code)) return 80;
  if ([302, 303, 304, 352, 353].includes(code)) return 95;
  if ([305, 309, 314, 399].includes(code)) return 61;
  if ([306, 315, 354, 355].includes(code)) return 63;
  if ([307, 308, 310, 311, 312, 316, 317, 318, 356, 357, 358, 359].includes(code)) return 65;
  if ([313, 404, 405, 406].includes(code)) return 66;
  if ([400, 407, 408, 456, 457].includes(code)) return 71;
  if ([401, 409].includes(code)) return 73;
  if ([402, 403, 410, 499].includes(code)) return 75;
  if ([500, 501, 502, 503, 504, 507, 508, 509, 510, 511, 512, 513, 514, 515].includes(code)) return 45;
  return 3;
}

/** Derive a WMO-style code from NMC's Chinese condition text. */
export function weatherCodeFromText(value: unknown): number {
  const text = safeString(value, 80).trim();
  if (!text || text === '9999' || text === '--' || text === '-') return 3;
  if (/雷.*冰雹|冰雹.*雷/u.test(text)) return 96;
  if (/雷/u.test(text)) return 95;
  if (/冰雹/u.test(text)) return 96;
  if (/冻雨/u.test(text)) return 66;
  if (/雨夹雪|雨雪/u.test(text)) return 66;
  if (/雪/u.test(text)) {
    if (/暴雪|大雪/u.test(text)) return 75;
    if (/中雪/u.test(text)) return 73;
    return 71;
  }
  if (/雨/u.test(text)) {
    if (/暴雨|大雨/u.test(text)) return 65;
    if (/中雨/u.test(text)) return 63;
    return 61;
  }
  if (/雾|霾|沙|尘/u.test(text)) return 45;
  if (/阴/u.test(text)) return 3;
  if (/多云|少云|晴间多云|局部多云/u.test(text)) return 2;
  if (/晴/u.test(text)) return 0;
  return 3;
}

/** NMC icon numbers used by the central observatory's city forecast API. */
export function mapNmcCode(value: unknown, text: unknown): number {
  const fromText = weatherCodeFromText(text);
  if (fromText !== 3) return fromText;
  const code = numberOrNull(value);
  if (code === null || code >= 9999) return fromText;
  const mapping: Record<number, number> = {
    0: 0, 1: 2, 2: 3, 3: 80, 4: 95, 5: 61, 6: 63, 7: 65, 8: 65, 9: 65, 10: 65,
    11: 71, 12: 71, 13: 73, 14: 75, 15: 75, 16: 45, 17: 66, 18: 45, 19: 61,
    20: 63, 21: 65, 22: 65, 23: 65, 24: 71, 25: 73, 26: 75, 27: 45, 28: 45,
    29: 45, 30: 45, 31: 45, 32: 45, 33: 45, 34: 45, 35: 45, 36: 0, 37: 0,
  };
  return mapping[code] ?? 3;
}

export function aqiLevelFromNumber(aqi: number): number {
  if (aqi <= 50) return 1;
  if (aqi <= 100) return 2;
  if (aqi <= 150) return 3;
  if (aqi <= 200) return 4;
  if (aqi <= 300) return 5;
  return 6;
}

export function normalizeAirQuality(
  aqiValue: unknown,
  displayValue: unknown = null,
  levelValue: unknown = null,
  category: unknown = null,
  primaryPollutant: unknown = null,
): AirQuality | null {
  const aqi = numberOrNull(aqiValue);
  if (aqi === null || aqi < 0) return null;
  const levelNumber = numberOrNull(levelValue);
  const level = levelNumber !== null && levelNumber >= 1 && levelNumber <= 6
    ? Math.round(levelNumber)
    : aqiLevelFromNumber(aqi);
  const display = typeof displayValue === 'string' && displayValue.trim()
    ? displayValue.trim().slice(0, 20)
    : String(Math.round(aqi * 10) / 10);
  return {
    aqi,
    display,
    level,
    category: typeof category === 'string' && category.trim() ? category.trim().slice(0, 80) : null,
    primaryPollutant: typeof primaryPollutant === 'string' && primaryPollutant.trim()
      ? primaryPollutant.trim().slice(0, 80)
      : null,
  };
}

/** Decide daytime from a local ISO-ish timestamp and optional sunrise/sunset. */
export function isDaytime(value: unknown, sunrise: unknown, sunset: unknown): boolean {
  const time = safeString(value, 40);
  const match = /T(\d{2}):(\d{2})/u.exec(time);
  const hour = match ? Number(match[1]) : new Date().getHours();
  const minutes = match ? hour * 60 + Number(match[2]) : hour * 60;
  const sunriseMatch = /T(\d{2}):(\d{2})/u.exec(safeString(sunrise, 40));
  const sunsetMatch = /T(\d{2}):(\d{2})/u.exec(safeString(sunset, 40));
  if (sunriseMatch && sunsetMatch) {
    const rise = Number(sunriseMatch[1]) * 60 + Number(sunriseMatch[2]);
    const set = Number(sunsetMatch[1]) * 60 + Number(sunsetMatch[2]);
    return minutes >= rise && minutes < set;
  }
  return hour >= 6 && hour < 18;
}

/** QWeather weather/air-quality paths use two separate path segments. */
export function coordinatePath(latitude: number, longitude: number): string {
  const lat = Math.round(latitude * 100) / 100;
  const lon = Math.round(longitude * 100) / 100;
  return `${lat}/${lon}`;
}

/** Round a raw string/number to a finite number or null. */
export function numberOrNullValue(value: unknown): number | null {
  return numberOrNull(value);
}

/** Strip the administrative suffix used by NMC city names. */
export function stripRegionSuffix(value: unknown): string {
  const text = safeString(value, 80).replace(/\s+/g, '').trim();
  return text.replace(/(?:特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|省|市|县|区|旗|盟)$/u, '');
}

/** Whether a geocoder country value means mainland China. */
export function isChinaCountry(value: unknown): boolean {
  const text = safeString(value, 80).trim().toLowerCase();
  if (!text) return false;
  return text === 'cn' || text === 'china' || text === '中国' || text === '中國' || text === '中华人民共和国';
}

/** Extract the first array from a record field. */
export function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Read a nested numeric field. */
export function nestedNumber(record: unknown, path: string): number | null {
  const input: JsonRecord = isRecord(record) ? record : {};
  let current: unknown = input;
  for (const part of path.split('.')) {
    if (!isRecord(current)) return null;
    current = current[part];
  }
  return numberOrNull(current);
}
