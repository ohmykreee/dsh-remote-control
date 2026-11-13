/** Weather and coarse current-location resolution, with no API key. */

import { finiteNumber, safeString, serializeError } from './util.js';
import { probeInfo, runProbe } from './probe.js';
import { isRecord, type JsonRecord } from './types.js';

const WEATHER_TTL_MS = 10 * 60 * 1000;
const WEATHER_ERROR_TTL_MS = 45 * 1000;
const LOCATION_TTL_MS = 6 * 60 * 60 * 1000;
const LOCATION_ERROR_TTL_MS = 5 * 60 * 1000;
const GEOCODE_TTL_MS = 10 * 60 * 1000;
const GEOCODE_CACHE_LIMIT = 64;

/** Open-Meteo needs the administrative suffix for some bare Chinese names. */
const HAN_CITY_NAME = /^[\u4e00-\u9fff]{2,}$/;

interface TimezoneFallback {
  name: string;
  latitude: number;
  longitude: number;
}

const TIMEZONE_FALLBACK: Record<string, TimezoneFallback> = {
  'Asia/Shanghai': { name: '上海', latitude: 31.2304, longitude: 121.4737 },
  'Asia/Chongqing': { name: '重庆', latitude: 29.563, longitude: 106.5516 },
  'Asia/Harbin': { name: '哈尔滨', latitude: 45.8038, longitude: 126.535 },
  'Asia/Hong_Kong': { name: '香港', latitude: 22.3193, longitude: 114.1694 },
  'Asia/Macau': { name: '澳门', latitude: 22.1987, longitude: 113.5439 },
  'Asia/Taipei': { name: '台北', latitude: 25.033, longitude: 121.5654 },
  'Asia/Tokyo': { name: '东京', latitude: 35.6762, longitude: 139.6503 },
  'Asia/Seoul': { name: '首尔', latitude: 37.5665, longitude: 126.978 },
  'Asia/Singapore': { name: '新加坡', latitude: 1.3521, longitude: 103.8198 },
  'America/Los_Angeles': { name: '洛杉矶', latitude: 34.0522, longitude: -118.2437 },
  'America/New_York': { name: '纽约', latitude: 40.7128, longitude: -74.006 },
  'Europe/London': { name: '伦敦', latitude: 51.5072, longitude: -0.1276 },
  'Europe/Paris': { name: '巴黎', latitude: 48.8566, longitude: 2.3522 },
};

/** A coordinate plus its label, as echoed in the weather payload. */
export interface WeatherLocation {
  name: string;
  latitude: number;
  longitude: number;
  source: string;
}

/** Location chosen by `resolveLocation`, which also settles the timezone. */
export interface ResolvedLocation extends WeatherLocation {
  timezone: string;
  accuracy?: number | null;
  error?: string;
}

/** Explicit coordinates requested by the settings page. */
export interface WeatherQuery {
  latitude?: number | null;
  longitude?: number | null;
  name?: string;
}

/** One city returned by Open-Meteo's geocoding API. */
export interface GeocodePlace {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1: string;
  timezone: string;
}

/** The `current` block of the open-meteo response after normalisation. */
export interface WeatherCurrent {
  time: string | null;
  temperature: number | null;
  feelsLike: number | null;
  humidity: number | null;
  precipitation: number;
  code: number;
  isDay: boolean;
  windSpeed: number | null;
}

/** Today's summary, taken from the first element of each daily series. */
export interface WeatherDaily {
  code: number;
  high: number | null;
  low: number | null;
  sunrise: string | null;
  sunset: string | null;
  tomorrowHigh: number | null;
  tomorrowLow: number | null;
}

/** One entry of the short-range hourly strip. */
export interface WeatherHourly {
  time: string | null;
  temperature: number | null;
  code: number | null;
  precipitationProbability: number | null;
}

/** One entry of the seven-day forecast. */
export interface WeatherDailyForecast {
  date: string | null;
  code: number;
  high: number | null;
  low: number | null;
  sunrise: string | null;
  sunset: string | null;
}

/**
 * Browser-facing weather snapshot. `current`/`daily` are null when the upstream
 * request failed, in which case `error` is set and the strips are empty.
 */
export interface WeatherPayload {
  ok: boolean;
  location: WeatherLocation;
  current: WeatherCurrent | null;
  daily: WeatherDaily | null;
  hourly: WeatherHourly[];
  dailyForecast: WeatherDailyForecast[];
  timezone?: string | null;
  error?: string;
  cached?: boolean;
  /** Added by the service layer after `getWeather` returns. */
  forecastMode?: 'daily' | 'hourly';
  updatedAt: number;
}

export interface WeatherService {
  getWeather(input?: WeatherQuery): Promise<WeatherPayload>;
  resolveLocation(): Promise<ResolvedLocation>;
  /** Forward geocoding for the settings page's city search. */
  searchCities(query: string, limit?: number): Promise<GeocodePlace[]>;
  /** Drop cached coordinates so a permission change is picked up immediately. */
  resetLocation(): void;
}

interface WeatherCacheEntry {
  at: number;
  value: WeatherPayload;
  error?: boolean;
}

interface ProbeLocationSuccess {
  ok: true;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  source: string;
}

interface ProbeLocationFailure {
  ok: false;
  error: string;
}

type ProbeLocationCache = ProbeLocationSuccess | ProbeLocationFailure;

/** Index-safe timezone lookup: an unknown zone has no fallback. */
function timezoneFallback(timezone: string): TimezoneFallback | undefined {
  return TIMEZONE_FALLBACK[timezone];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

async function fetchJson(url: string, timeoutMs = 9000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'dsh-remote-control/1.0 (+local smart display)',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** One Open-Meteo geocoding request, normalised to lowercase-safe places. */
async function geocodePlaces(name: string, count: number): Promise<GeocodePlace[]> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', name);
  url.searchParams.set('count', String(count));
  url.searchParams.set('language', 'zh');
  url.searchParams.set('format', 'json');
  const raw = await fetchJson(url.toString(), 8000);
  const payload = isRecord(raw) ? raw : null;
  const results: unknown[] = payload && Array.isArray(payload.results) ? payload.results : [];
  const places: GeocodePlace[] = [];
  const seen = new Set<string>();
  for (const item of results) {
    if (!isRecord(item)) continue;
    const label = safeString(item.name, 120).trim();
    const latitude = finiteNumber(item.latitude);
    const longitude = finiteNumber(item.longitude);
    if (!label || latitude === null || longitude === null) continue;
    const id = finiteNumber(item.id, 0);
    const dedupe = `${id || label}|${latitude.toFixed(4)}|${longitude.toFixed(4)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    places.push({
      id,
      name: label,
      latitude,
      longitude,
      country: safeString(item.country, 80).trim(),
      admin1: safeString(item.admin1, 80).trim(),
      timezone: safeString(item.timezone, 80).trim(),
    });
  }
  return places;
}

let probeLocationCache: ProbeLocationCache | null = null;
let probeLocationAt = 0;

/** Forget the cached OS-location result (called after a permission request). */
export function resetProbeLocationCache(): void {
  probeLocationCache = null;
  probeLocationAt = 0;
}

/** Ask the OS location API (via the Rust probe) before falling back to IP. */
async function readProbeLocation(): Promise<ProbeLocationSuccess | null> {
  const now = Date.now();
  if (probeLocationCache !== null && now - probeLocationAt < 30 * 60 * 1000) {
    return probeLocationCache.ok ? probeLocationCache : null;
  }
  if (!probeInfo().available) {
    // Do not cache a missing binary for 30 minutes: a later build should be
    // picked up on the next weather refresh.
    return null;
  }
  try {
    const raw = await runProbe(['location'], { timeout: 12_000 });
    const result = isRecord(raw) ? raw : null;
    const latitude = finiteNumber(result?.latitude, null);
    const longitude = finiteNumber(result?.longitude, null);
    if (result?.ok && latitude !== null && longitude !== null) {
      probeLocationCache = {
        ok: true,
        latitude,
        longitude,
        accuracy: finiteNumber(result.accuracy, null),
        source: safeString(result.source, 80) || 'system',
      };
      probeLocationAt = now;
      return probeLocationCache;
    }
    const reason = result && typeof result.error === 'string' && result.error
      ? result.error
      : 'system location unavailable';
    probeLocationCache = { ok: false, error: reason };
    probeLocationAt = now;
    return null;
  } catch (error) {
    probeLocationCache = { ok: false, error: serializeError(error) };
    probeLocationAt = now;
    return null;
  }
}

async function reverseGeocode(latitude: number, longitude: number): Promise<string> {
  try {
    const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('localityLanguage', 'zh');
    const payload = await fetchJson(url.toString(), 6000);
    if (!isRecord(payload)) return '';
    return safeString(payload.city || payload.locality || payload.principalSubdivision, 80);
  } catch {
    return '';
  }
}

export function createWeatherService(): WeatherService {
  let locationCache: ResolvedLocation | null = null;
  let locationCacheAt = 0;
  const weatherCache = new Map<string, WeatherCacheEntry>();
  const geocodeCache = new Map<string, { at: number; value: GeocodePlace[] }>();

  function resetLocation(): void {
    resetProbeLocationCache();
    locationCache = null;
    locationCacheAt = 0;
  }

  /**
   * Look up cities through Open-Meteo's geocoding API (the same provider as the
   * forecast). Results are cached briefly because the settings page searches on
   * every debounced keystroke. An empty query never reaches the network.
   */
  async function searchCities(query: string, limit: number = 8): Promise<GeocodePlace[]> {
    const name = safeString(query, 80).trim();
    if (!name) return [];
    const count = Math.max(1, Math.min(20, Math.trunc(limit) || 8));
    const key = `${name.toLowerCase()}|${count}`;
    const now = Date.now();
    const cached = geocodeCache.get(key);
    if (cached && now - cached.at < GEOCODE_TTL_MS) return cached.value;

    let places = await geocodePlaces(name, count);
    // The Chinese index is incomplete for bare prefecture names: "厦门" returns
    // nothing while "厦门市" resolves. Retry once with the suffix before
    // reporting no match.
    if (places.length === 0 && HAN_CITY_NAME.test(name)) {
      places = await geocodePlaces(`${name}市`, count);
    }

    geocodeCache.set(key, { at: now, value: places });
    if (geocodeCache.size > GEOCODE_CACHE_LIMIT) {
      const oldest = geocodeCache.keys().next().value;
      if (oldest !== undefined) geocodeCache.delete(oldest);
    }
    return places;
  }

  async function resolveLocation(): Promise<ResolvedLocation> {
    const now = Date.now();
    if (locationCache && now - locationCacheAt < LOCATION_TTL_MS) return locationCache;
    if (locationCache?.error && now - locationCacheAt < LOCATION_ERROR_TTL_MS) return locationCache;

    // Automatic mode asks the OS location API first (Windows Geolocation,
    // Linux GeoClue2), then IP geolocation, then the local timezone.
    const nativeLocation = await readProbeLocation();
    if (nativeLocation) {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const name = (await reverseGeocode(nativeLocation.latitude, nativeLocation.longitude))
        || timezoneFallback(timezone)?.name
        || '当前位置';
      locationCache = {
        name,
        latitude: nativeLocation.latitude,
        longitude: nativeLocation.longitude,
        timezone,
        source: nativeLocation.source,
        accuracy: nativeLocation.accuracy,
      };
      locationCacheAt = now;
      return locationCache;
    }

    try {
      const payload = await fetchJson('https://ipwho.is/', 6500);
      const record = isRecord(payload) ? payload : null;
      const latitude = finiteNumber(record?.latitude);
      const longitude = finiteNumber(record?.longitude);
      if (record && record.success !== false && latitude !== null && longitude !== null) {
        const timezoneRecord = isRecord(record.timezone) ? record.timezone : null;
        const timezone = safeString(timezoneRecord?.id, 80);
        const fallback = timezoneFallback(timezone);
        const name = safeString(record.city || record.region || fallback?.name || timezone, 80);
        locationCache = {
          name: name || '当前位置',
          latitude,
          longitude,
          timezone,
          source: 'ip',
        };
        locationCacheAt = now;
        return locationCache;
      }
      throw new Error('IP location response was incomplete');
    } catch (error) {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const fallback = timezoneFallback(timezone);
      locationCache = fallback
        ? { ...fallback, timezone, source: 'timezone', error: serializeError(error) }
        : {
            name: timezone || '当前位置',
            latitude: 31.2304,
            longitude: 121.4737,
            timezone,
            source: 'fallback',
            error: serializeError(error),
          };
      locationCacheAt = now;
      return locationCache;
    }
  }

  async function getWeather(input: WeatherQuery = {}): Promise<WeatherPayload> {
    const requestedLat = finiteNumber(input.latitude);
    const requestedLon = finiteNumber(input.longitude);
    const hasCustom = requestedLat !== null && requestedLon !== null;
    const location: WeatherLocation = hasCustom
      ? {
          name: safeString(input.name, 80) || '自定义位置',
          latitude: Math.max(-90, Math.min(90, requestedLat)),
          longitude: Math.max(-180, Math.min(180, requestedLon)),
          source: 'manual',
        }
      : await resolveLocation();

    const key = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
    const now = Date.now();
    const cached = weatherCache.get(key);
    if (cached && now - cached.at < (cached.error ? WEATHER_ERROR_TTL_MS : WEATHER_TTL_MS)) {
      return { ...cached.value, cached: true };
    }

    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(location.latitude));
    url.searchParams.set('longitude', String(location.longitude));
    url.searchParams.set('current', [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'is_day',
      'precipitation',
      'weather_code',
      'wind_speed_10m',
    ].join(','));
    url.searchParams.set('daily', [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'sunrise',
      'sunset',
    ].join(','));
    url.searchParams.set('hourly', ['temperature_2m', 'weather_code', 'precipitation_probability'].join(','));
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('forecast_days', '7');

    try {
      const raw = await fetchJson(url.toString(), 10000);
      const payload = isRecord(raw) ? raw : null;
      const current: JsonRecord = payload && isRecord(payload.current) ? payload.current : {};
      const daily: JsonRecord = payload && isRecord(payload.daily) ? payload.daily : {};
      const hourly: JsonRecord = payload && isRecord(payload.hourly) ? payload.hourly : {};
      const dailyTimes: unknown[] = Array.isArray(daily.time) ? daily.time : [];
      const dailyCodes: unknown[] = Array.isArray(daily.weather_code) ? daily.weather_code : [];
      const dailyHighs: unknown[] = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max : [];
      const dailyLows: unknown[] = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min : [];
      const dailySunrises: unknown[] = Array.isArray(daily.sunrise) ? daily.sunrise : [];
      const dailySunsets: unknown[] = Array.isArray(daily.sunset) ? daily.sunset : [];
      const hourlyTimes: unknown[] = Array.isArray(hourly.time) ? hourly.time : [];
      const hourlyTemperatures: unknown[] = Array.isArray(hourly.temperature_2m) ? hourly.temperature_2m : [];
      const hourlyCodes: unknown[] = Array.isArray(hourly.weather_code) ? hourly.weather_code : [];
      const hourlyPrecipitation: unknown[] = Array.isArray(hourly.precipitation_probability)
        ? hourly.precipitation_probability
        : [];
      const currentTime = typeof current.time === 'string' ? current.time : '';
      let startIndex = 0;
      if (currentTime) {
        const index = hourlyTimes.findIndex(
          (time) => typeof time === 'string' && time >= currentTime.slice(0, 13) + ':00',
        );
        if (index >= 0) startIndex = index;
      }
      const upcoming: WeatherHourly[] = hourlyTimes.slice(startIndex, startIndex + 8).map((time, index) => ({
        time: stringOrNull(time),
        temperature: finiteNumber(hourlyTemperatures[startIndex + index]),
        code: finiteNumber(hourlyCodes[startIndex + index]),
        precipitationProbability: finiteNumber(hourlyPrecipitation[startIndex + index]),
      }));

      const value: WeatherPayload = {
        ok: true,
        location: {
          name: location.name,
          latitude: location.latitude,
          longitude: location.longitude,
          source: location.source,
        },
        current: {
          time: stringOrNull(current.time),
          temperature: finiteNumber(current.temperature_2m),
          feelsLike: finiteNumber(current.apparent_temperature),
          humidity: finiteNumber(current.relative_humidity_2m),
          precipitation: finiteNumber(current.precipitation, 0) ?? 0,
          code: finiteNumber(current.weather_code, 0) ?? 0,
          isDay: current.is_day === 1 || current.is_day === true,
          windSpeed: finiteNumber(current.wind_speed_10m),
        },
        daily: {
          code: finiteNumber(dailyCodes[0], 0) ?? 0,
          high: finiteNumber(dailyHighs[0]),
          low: finiteNumber(dailyLows[0]),
          sunrise: stringOrNull(dailySunrises[0]),
          sunset: stringOrNull(dailySunsets[0]),
          tomorrowHigh: finiteNumber(dailyHighs[1]),
          tomorrowLow: finiteNumber(dailyLows[1]),
        },
        dailyForecast: dailyTimes.slice(0, 7).map((date, index) => ({
          date: stringOrNull(date),
          code: finiteNumber(dailyCodes[index], 0) ?? 0,
          high: finiteNumber(dailyHighs[index]),
          low: finiteNumber(dailyLows[index]),
          sunrise: stringOrNull(dailySunrises[index]),
          sunset: stringOrNull(dailySunsets[index]),
        })),
        hourly: upcoming,
        timezone: stringOrNull(payload?.timezone),
        updatedAt: now,
      };
      weatherCache.set(key, { at: now, value });
      return value;
    } catch (error) {
      const fallback: WeatherPayload = {
        ok: false,
        location: {
          name: location.name,
          latitude: location.latitude,
          longitude: location.longitude,
          source: location.source,
        },
        current: null,
        daily: null,
        hourly: [],
        dailyForecast: [],
        error: serializeError(error),
        updatedAt: now,
      };
      weatherCache.set(key, { at: now, value: fallback, error: true });
      return fallback;
    }
  }

  return { getWeather, resolveLocation, searchCities, resetLocation };
}
