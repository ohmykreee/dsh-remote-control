/**
 * General runtime cache for the remote console.
 *
 * Stored as `cache.json` in the plugin data directory. A profile that still has
 * the old `notification-cache.json` is migrated on first use (its legacy `apps`
 * section is preserved for the app-name migration).
 */

import fs from 'node:fs';
import path from 'node:path';
import { isRecord } from './types.js';
import type { JsonRecord } from './types.js';
import type { QWeatherConsoleSnapshot } from './types.js';

const CACHE_FILE = 'cache.json';
const LEGACY_CACHE_FILE = 'notification-cache.json';
const CACHE_VERSION = 1;
export const NMC_CITY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface WeatherUsage {
  /** Calendar month in Asia/Shanghai, formatted `YYYY-MM`. */
  month: string;
  qweather: number;
  updatedAt: number;
}

export interface NmcCity {
  code: string;
  city: string;
  province: string;
  url: string;
}

export interface NmcCityCache {
  fetchedAt: number;
  cities: NmcCity[];
}

/** Last successful reverse-geocode result, reused while the device stays nearby. */
export interface GeocodeCacheEntry {
  latitude: number;
  longitude: number;
  name: string;
  province: string;
  country: string;
  source: string;
  fetchedAt: number;
}

export interface PluginCacheStore {
  readonly file: string;
  weatherUsage(): WeatherUsage;
  addQWeatherCalls(count: number): WeatherUsage;
  resetQWeatherUsage(): WeatherUsage;
  /** Raise the local counter to the account-wide value from the console. */
  reconcileQWeatherUsage(used: number): WeatherUsage;
  nmcCities(): NmcCityCache | null;
  setNmcCities(cities: NmcCity[], fetchedAt?: number): NmcCityCache;
  qweatherConsole(): QWeatherConsoleSnapshot | null;
  setQWeatherConsole(snapshot: QWeatherConsoleSnapshot): QWeatherConsoleSnapshot;
  geocode(): GeocodeCacheEntry | null;
  setGeocode(entry: GeocodeCacheEntry): GeocodeCacheEntry;
  clearGeocode(): void;
  flush(): void;
}

/** QWeather resets its free quota at the start of a Beijing-time month. */
export function qweatherMonth(now: number = Date.now()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date(now));
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    if (year && month) return `${year}-${month}`;
  } catch {
    /* fall through to the host timezone */
  }
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function normalizeUsage(value: unknown): WeatherUsage {
  const input: JsonRecord = isRecord(value) ? value : {};
  const month = typeof input.month === 'string' && /^\d{4}-\d{2}$/u.test(input.month)
    ? input.month
    : qweatherMonth();
  const qweather = Math.max(0, Math.floor(Number(input.qweather) || 0));
  return {
    month,
    qweather,
    updatedAt: Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : 0,
  };
}

function normalizeCities(value: unknown): NmcCity[] {
  if (!Array.isArray(value)) return [];
  const cities: NmcCity[] = [];
  for (const item of value.slice(0, 10_000)) {
    if (!isRecord(item)) continue;
    const code = typeof item.code === 'string' ? item.code.trim().slice(0, 40) : '';
    const city = typeof item.city === 'string' ? item.city.trim().slice(0, 80) : '';
    if (!code || !city) continue;
    cities.push({
      code,
      city,
      province: typeof item.province === 'string' ? item.province.trim().slice(0, 80) : '',
      url: typeof item.url === 'string' ? item.url.slice(0, 200) : '',
    });
  }
  return cities;
}

function normalizeNmcCache(value: unknown): NmcCityCache | null {
  if (!isRecord(value)) return null;
  const cities = normalizeCities(value.cities);
  if (cities.length === 0) return null;
  return {
    fetchedAt: Number.isFinite(Number(value.fetchedAt)) ? Number(value.fetchedAt) : 0,
    cities,
  };
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : null;
}

function normalizeConsole(value: unknown): QWeatherConsoleSnapshot | null {
  if (!isRecord(value)) return null;
  const statsInput = isRecord(value.stats) ? value.stats : null;
  const stats = statsInput
    ? {
        asOf: nullableString(statsInput.asOf),
        success: Math.max(0, Math.round(Number(statsInput.success) || 0)),
        errors: Math.max(0, Math.round(Number(statsInput.errors) || 0)),
        total: Math.max(0, Math.round(Number(statsInput.total) || 0)),
      }
    : null;
  const errors = Array.isArray(value.errors)
    ? value.errors.filter((item): item is string => typeof item === 'string').slice(0, 10)
    : [];
  return {
    fetchedAt: Number.isFinite(Number(value.fetchedAt)) ? Number(value.fetchedAt) : 0,
    asOf: nullableString(value.asOf),
    stats,
    monthlyUsed: nullableNumber(value.monthlyUsed),
    errors,
  };
}

function normalizeGeocode(value: unknown): GeocodeCacheEntry | null {
  if (!isRecord(value)) return null;
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 120) : '';
  if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    name,
    province: typeof value.province === 'string' ? value.province.trim().slice(0, 80) : '',
    country: typeof value.country === 'string' ? value.country.trim().slice(0, 80) : '',
    source: typeof value.source === 'string' ? value.source.trim().slice(0, 40) : 'unknown',
    fetchedAt: Number.isFinite(Number(value.fetchedAt)) ? Number(value.fetchedAt) : 0,
  };
}

export function createCacheStore(directory: string): PluginCacheStore {
  const file = path.join(directory, CACHE_FILE);
  const legacyFile = path.join(directory, LEGACY_CACHE_FILE);
  fs.mkdirSync(directory, { recursive: true });
  if (!fs.existsSync(file) && fs.existsSync(legacyFile)) {
    try {
      fs.renameSync(legacyFile, file);
    } catch {
      try {
        fs.copyFileSync(legacyFile, file);
        fs.rmSync(legacyFile, { force: true });
      } catch {
        /* keep the legacy file; it will be retried next start */
      }
    }
  }

  // Keep unknown/legacy keys (notably `apps`) so the file remains a superset of
  // the old notification cache.
  let root: JsonRecord = {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (isRecord(parsed)) root = parsed;
  } catch {
    root = {};
  }
  const weatherSection: JsonRecord = isRecord(root.weather) ? root.weather : {};
  let usage = normalizeUsage(weatherSection.usage);
  let nmcCityCache = normalizeNmcCache(weatherSection.nmcCities);
  let consoleSnapshot = normalizeConsole(weatherSection.console);
  let geocodeCache = normalizeGeocode(weatherSection.geocode);

  function persist(): void {
    const weatherOutput: JsonRecord = {
      ...weatherSection,
      usage,
      ...(nmcCityCache ? { nmcCities: nmcCityCache } : {}),
      ...(consoleSnapshot ? { console: consoleSnapshot } : {}),
    };
    if (geocodeCache) weatherOutput.geocode = geocodeCache;
    else delete weatherOutput.geocode;
    const output: JsonRecord = {
      ...root,
      version: CACHE_VERSION,
      updatedAt: Date.now(),
      weather: weatherOutput,
    };
    const temporary = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, JSON.stringify(output, null, 2), 'utf8');
    fs.renameSync(temporary, file);
    root = output;
  }

  function currentUsage(): WeatherUsage {
    const month = qweatherMonth();
    if (usage.month !== month) return { month, qweather: 0, updatedAt: usage.updatedAt };
    return { ...usage };
  }

  function addQWeatherCalls(count: number): WeatherUsage {
    const amount = Math.max(0, Math.floor(Number(count) || 0));
    if (amount === 0) return currentUsage();
    const month = qweatherMonth();
    const base = usage.month === month ? usage.qweather : 0;
    usage = { month, qweather: base + amount, updatedAt: Date.now() };
    persist();
    return { ...usage };
  }

  function resetQWeatherUsage(): WeatherUsage {
    usage = { month: qweatherMonth(), qweather: 0, updatedAt: Date.now() };
    persist();
    return { ...usage };
  }

  function nmcCities(): NmcCityCache | null {
    if (!nmcCityCache) return null;
    return { fetchedAt: nmcCityCache.fetchedAt, cities: nmcCityCache.cities.map((city) => ({ ...city })) };
  }

  function setNmcCities(cities: NmcCity[], fetchedAt: number = Date.now()): NmcCityCache {
    nmcCityCache = {
      fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : Date.now(),
      cities: cities.map((city) => ({ ...city })),
    };
    persist();
    return nmcCities() as NmcCityCache;
  }

  function reconcileQWeatherUsage(used: number): WeatherUsage {
    const amount = Math.max(0, Math.floor(Number(used) || 0));
    const month = qweatherMonth();
    const current = usage.month === month ? usage.qweather : 0;
    if (amount <= current) return currentUsage();
    usage = { month, qweather: amount, updatedAt: Date.now() };
    persist();
    return { ...usage };
  }

  function qweatherConsole(): QWeatherConsoleSnapshot | null {
    if (!consoleSnapshot) return null;
    return JSON.parse(JSON.stringify(consoleSnapshot)) as QWeatherConsoleSnapshot;
  }

  function setQWeatherConsole(snapshot: QWeatherConsoleSnapshot): QWeatherConsoleSnapshot {
    consoleSnapshot = normalizeConsole(snapshot);
    persist();
    return qweatherConsole() as QWeatherConsoleSnapshot;
  }

  function geocode(): GeocodeCacheEntry | null {
    return geocodeCache ? { ...geocodeCache } : null;
  }

  function setGeocode(entry: GeocodeCacheEntry): GeocodeCacheEntry {
    const normalized = normalizeGeocode(entry);
    if (!normalized) throw new Error('invalid geocode cache entry');
    geocodeCache = normalized;
    persist();
    return { ...geocodeCache };
  }

  function clearGeocode(): void {
    if (!geocodeCache) return;
    geocodeCache = null;
    persist();
  }

  return {
    file,
    weatherUsage: currentUsage,
    addQWeatherCalls,
    resetQWeatherUsage,
    reconcileQWeatherUsage,
    nmcCities,
    setNmcCities,
    qweatherConsole,
    setQWeatherConsole,
    geocode,
    setGeocode,
    clearGeocode,
    flush: persist,
  };
}
