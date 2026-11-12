/** Weather and coarse current-location resolution, with no API key. */

import { finiteNumber, safeString, serializeError } from './util.js';
import { probeInfo, runProbe } from './probe.js';

const WEATHER_TTL_MS = 10 * 60 * 1000;
const WEATHER_ERROR_TTL_MS = 45 * 1000;
const LOCATION_TTL_MS = 6 * 60 * 60 * 1000;
const LOCATION_ERROR_TTL_MS = 5 * 60 * 1000;

const TIMEZONE_FALLBACK = {
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

async function fetchJson(url, timeoutMs = 9000) {
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

let probeLocationCache = null;
let probeLocationAt = 0;

/** Ask the OS location API (via the Rust probe) before falling back to IP. */
async function readProbeLocation() {
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
    const result = await runProbe(['location'], { timeout: 12_000 });
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
    probeLocationCache = { ok: false, error: result?.error || 'system location unavailable' };
    probeLocationAt = now;
    return null;
  } catch (error) {
    probeLocationCache = { ok: false, error: serializeError(error) };
    probeLocationAt = now;
    return null;
  }
}

async function reverseGeocode(latitude, longitude) {
  try {
    const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('localityLanguage', 'zh');
    const payload = await fetchJson(url.toString(), 6000);
    return safeString(payload?.city || payload?.locality || payload?.principalSubdivision, 80);
  } catch {
    return '';
  }
}

export function createWeatherService() {
  let locationCache = null;
  let locationCacheAt = 0;
  const weatherCache = new Map();

  async function resolveLocation() {
    const now = Date.now();
    if (locationCache && now - locationCacheAt < LOCATION_TTL_MS) return locationCache;
    if (locationCache?.error && now - locationCacheAt < LOCATION_ERROR_TTL_MS) return locationCache;

    // Automatic mode asks the OS location API first (Windows Geolocation,
    // Linux GeoClue2), then IP geolocation, then the local timezone.
    const nativeLocation = await readProbeLocation();
    if (nativeLocation) {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const name = (await reverseGeocode(nativeLocation.latitude, nativeLocation.longitude))
        || TIMEZONE_FALLBACK[timezone]?.name
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
      const latitude = finiteNumber(payload?.latitude);
      const longitude = finiteNumber(payload?.longitude);
      if (payload?.success !== false && latitude !== null && longitude !== null) {
        const timezone = safeString(payload?.timezone?.id, 80);
        const fallback = TIMEZONE_FALLBACK[timezone];
        const name = safeString(payload?.city || payload?.region || fallback?.name || timezone, 80);
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
      const fallback = TIMEZONE_FALLBACK[timezone];
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

  async function getWeather(input = {}) {
    const requestedLat = finiteNumber(input.latitude);
    const requestedLon = finiteNumber(input.longitude);
    const hasCustom = requestedLat !== null && requestedLon !== null;
    const location = hasCustom
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
      const payload = await fetchJson(url.toString(), 10000);
      const current = payload?.current ?? {};
      const daily = payload?.daily ?? {};
      const hourly = payload?.hourly ?? {};
      const dailyTimes = Array.isArray(daily.time) ? daily.time : [];
      const hourlyTimes = Array.isArray(hourly.time) ? hourly.time : [];
      const currentTime = typeof current.time === 'string' ? current.time : '';
      let startIndex = 0;
      if (currentTime) {
        const index = hourlyTimes.findIndex((time) => time >= currentTime.slice(0, 13) + ':00');
        if (index >= 0) startIndex = index;
      }
      const upcoming = hourlyTimes.slice(startIndex, startIndex + 8).map((time, index) => ({
        time,
        temperature: finiteNumber(hourly.temperature_2m?.[startIndex + index]),
        code: finiteNumber(hourly.weather_code?.[startIndex + index]),
        precipitationProbability: finiteNumber(hourly.precipitation_probability?.[startIndex + index]),
      }));

      const value = {
        ok: true,
        location: {
          name: location.name,
          latitude: location.latitude,
          longitude: location.longitude,
          source: location.source,
        },
        current: {
          time: current.time ?? null,
          temperature: finiteNumber(current.temperature_2m),
          feelsLike: finiteNumber(current.apparent_temperature),
          humidity: finiteNumber(current.relative_humidity_2m),
          precipitation: finiteNumber(current.precipitation, 0),
          code: finiteNumber(current.weather_code, 0),
          isDay: current.is_day === 1 || current.is_day === true,
          windSpeed: finiteNumber(current.wind_speed_10m),
        },
        daily: {
          code: finiteNumber(daily.weather_code?.[0], 0),
          high: finiteNumber(daily.temperature_2m_max?.[0]),
          low: finiteNumber(daily.temperature_2m_min?.[0]),
          sunrise: daily.sunrise?.[0] ?? null,
          sunset: daily.sunset?.[0] ?? null,
          tomorrowHigh: finiteNumber(daily.temperature_2m_max?.[1]),
          tomorrowLow: finiteNumber(daily.temperature_2m_min?.[1]),
        },
        dailyForecast: dailyTimes.slice(0, 7).map((date, index) => ({
          date,
          code: finiteNumber(daily.weather_code?.[index], 0),
          high: finiteNumber(daily.temperature_2m_max?.[index]),
          low: finiteNumber(daily.temperature_2m_min?.[index]),
          sunrise: daily.sunrise?.[index] ?? null,
          sunset: daily.sunset?.[index] ?? null,
        })),
        hourly: upcoming,
        timezone: payload?.timezone ?? null,
        updatedAt: now,
      };
      weatherCache.set(key, { at: now, value });
      return value;
    } catch (error) {
      const fallback = {
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

  return { getWeather, resolveLocation };
}
