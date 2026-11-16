/**
 * Weather orchestration: automatic location, provider selection, caching and
 * QWeather's quota-triggered fallback.
 *
 * Fallback rules:
 *  - a normal request failure never switches provider;
 *  - only QWeather's calendar-month quota switches the active provider;
 *  - after that switch NMC is used for Chinese locations, Open-Meteo elsewhere
 *    (or when NMC has no matching station).
 */

import type { PluginLocale } from './settings.js';
import {
  minimumQWeatherRefreshMinutes,
  type RemoteControlSettings,
  type WeatherProvider,
  type WeatherSettings,
} from './settings.js';
import type { PluginCacheStore } from './cache.js';
import { probeInfo, runProbe } from './probe.js';
import { WeatherQuotaError, isRecord } from './types.js';
import type { JsonRecord } from './types.js';
import { finiteNumber, safeString, serializeError } from './util.js';
import { fetchOpenMeteoWeather, searchOpenMeteoCities } from './weather/open-meteo.js';
import {
  fetchQWeatherWeather,
  fetchQWeatherConsole,
  qweatherConfigured,
  searchQWeatherCities,
} from './weather/qweather.js';
import {
  fetchNmcWeather,
  resolveNmcCity,
  searchNmcCities,
} from './weather/nmc.js';
import { fetchJson, isChinaCountry } from './weather/shared.js';
import type {
  GeocodePlace,
  ProviderLocation,
  QWeatherConsoleSnapshot,
  ResolvedLocation,
  WeatherLocation,
  WeatherOverride,
  WeatherPayload,
  WeatherQuotaStatus,
  WeatherService,
  WeatherStatus,
} from './types.js';

const WEATHER_TTL_MS = 10 * 60 * 1000;
const WEATHER_ERROR_TTL_MS = 45 * 1000;
const LOCATION_TTL_MS = 6 * 60 * 60 * 1000;
const LOCATION_ERROR_TTL_MS = 5 * 60 * 1000;
const GEOCODE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const GEOCODE_CACHE_DISTANCE = 0.01;
const GEOCODE_TTL_MS = 10 * 60 * 1000;
const GEOCODE_CACHE_LIMIT = 64;
const WEATHER_CACHE_LIMIT = 32;

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

interface ProbeLocationSuccess {
  ok: true;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  source: string;
  name?: string;
}

interface ProbeLocationFailure {
  ok: false;
  error: string;
}

type ProbeLocationCache = ProbeLocationSuccess | ProbeLocationFailure;

interface WeatherCacheEntry {
  at: number;
  value: WeatherPayload;
  error?: boolean;
}

interface ProviderChoice {
  provider: WeatherProvider;
  switched: boolean;
  location?: ProviderLocation;
}

export interface WeatherServiceOptions {
  getSettings: () => RemoteControlSettings;
  cache: PluginCacheStore;
  getLocale?: () => PluginLocale;
  log?: (message: string) => void;
}

let probeLocationCache: ProbeLocationCache | null = null;
let probeLocationAt = 0;

/** Forget the cached OS-location result (called after a permission request). */
export function resetProbeLocationCache(): void {
  probeLocationCache = null;
  probeLocationAt = 0;
}

function timezoneFallback(timezone: string): TimezoneFallback | undefined {
  return TIMEZONE_FALLBACK[timezone];
}

interface ReverseGeocodeResult {
  name: string;
  province?: string;
  country?: string;
}

/**
 * Free reverse-geocode fallback. Open-Meteo's Geocoding API only resolves
 * names to coordinates, so it cannot be used here; this was the endpoint used
 * before and needs no account.
 */
async function reverseGeocodeFallback(
  latitude: number,
  longitude: number,
  language: 'zh' | 'en',
): Promise<ReverseGeocodeResult | null> {
  try {
    const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('localityLanguage', language);
    const payload = await fetchJson(url.toString(), { timeoutMs: 6000 });
    if (!isRecord(payload)) return null;
    const name = safeString(payload.city || payload.locality || payload.principalSubdivision, 80).trim();
    if (!name) return null;
    const province = safeString(payload.principalSubdivision, 80).trim();
    const country = safeString(payload.countryName || payload.countryCode, 80).trim();
    return {
      name,
      ...(province ? { province } : {}),
      ...(country ? { country } : {}),
    };
  } catch {
    return null;
  }
}

/** Ask the OS location API (via the Rust probe). */
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
      const systemName = safeString(result.name || result.city || result.locality, 80).trim();
      probeLocationCache = {
        ok: true,
        latitude,
        longitude,
        accuracy: finiteNumber(result.accuracy, null),
        source: safeString(result.source, 80) || 'system',
        ...(systemName ? { name: systemName } : {}),
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

function weatherLocation(value: ProviderLocation): WeatherLocation {
  return {
    name: value.name,
    latitude: value.latitude,
    longitude: value.longitude,
    source: value.source,
    ...(value.province ? { province: value.province } : {}),
    ...(value.country ? { country: value.country } : {}),
  };
}

export function createWeatherService(options: WeatherServiceOptions): WeatherService {
  const { getSettings, cache } = options;
  const log = options.log ?? (() => {});
  const locale = (): PluginLocale => options.getLocale?.() ?? 'zh';

  let locationCache: ResolvedLocation | null = null;
  let locationCacheAt = 0;
  let lastWeather: WeatherPayload | null = null;
  let lastError: string | null = null;
  let consoleSyncAt = cache.qweatherConsole()?.fetchedAt ?? 0;
  let consoleSyncBusy = false;
  const weatherCache = new Map<string, WeatherCacheEntry>();
  const geocodeCache = new Map<string, { at: number; value: GeocodePlace[] }>();

  function settings(): WeatherSettings {
    return getSettings().weather;
  }

  function resetLocation(): void {
    resetProbeLocationCache();
    locationCache = null;
    locationCacheAt = 0;
    weatherCache.clear();
  }

  /** Refresh button: re-read the system position and bypass the name cache. */
  function refreshLocation(): void {
    resetLocation();
    cache.clearGeocode();
  }

  /**
   * Resolve a display name for the system coordinates. The active QWeather
   * account is asked first because its GeoAPI accepts "longitude,latitude";
   * NMC and Open-Meteo cannot reverse coordinates, and an exhausted QWeather
   * quota also falls through to the free reverse-geocode fallback.
   */
  async function resolvePlaceName(latitude: number, longitude: number): Promise<ReverseGeocodeResult | null> {
    const weather = settings();
    if (weather.provider === 'qweather' && qweatherConfigured(weather.qweather)) {
      try {
        const places = await searchQWeatherCities(
          `${longitude.toFixed(2)},${latitude.toFixed(2)}`,
          weather.qweather,
          {
            reserve: (count) => reserveQWeatherCalls(count, weather),
            locale: locale(),
            forecastMode: weather.forecastMode,
          },
          1,
        );
        const place = places[0];
        if (place) {
          return {
            name: place.admin2 || place.name,
            ...(place.admin1 ? { province: place.admin1 } : {}),
            ...(place.country ? { country: place.country } : {}),
          };
        }
      } catch {
        // GeoAPI disabled, unsupported for this credential, or quota exhausted.
      }
    }
    return reverseGeocodeFallback(latitude, longitude, locale());
  }

  async function resolveLocation(): Promise<ResolvedLocation> {
    const now = Date.now();
    if (locationCache && now - locationCacheAt < LOCATION_TTL_MS) return locationCache;
    if (locationCache?.error && now - locationCacheAt < LOCATION_ERROR_TTL_MS) return locationCache;

    // Automatic mode uses only the OS location API (Windows Geolocation, Linux
    // GeoClue2). No reverse-geocode or IP lookup is performed; the console shows
    // the raw system coordinates instead of inventing a city name.
    const nativeLocation = await readProbeLocation();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (nativeLocation) {
      const cacheEntry = cache.geocode();
      const systemName = nativeLocation.name?.trim() && nativeLocation.name.trim() !== '当前位置'
        ? nativeLocation.name.trim()
        : '';
      let place: ReverseGeocodeResult | null = null;
      if (
        cacheEntry
        && now - cacheEntry.fetchedAt < GEOCODE_CACHE_TTL_MS
        && Math.abs(cacheEntry.latitude - nativeLocation.latitude) <= GEOCODE_CACHE_DISTANCE
        && Math.abs(cacheEntry.longitude - nativeLocation.longitude) <= GEOCODE_CACHE_DISTANCE
      ) {
        place = {
          name: cacheEntry.name,
          ...(cacheEntry.province ? { province: cacheEntry.province } : {}),
          ...(cacheEntry.country ? { country: cacheEntry.country } : {}),
        };
      } else if (systemName) {
        place = { name: systemName };
        cache.setGeocode({
          latitude: nativeLocation.latitude,
          longitude: nativeLocation.longitude,
          name: systemName,
          province: '',
          country: '',
          source: nativeLocation.source || 'system',
          fetchedAt: now,
        });
      } else {
        place = await resolvePlaceName(nativeLocation.latitude, nativeLocation.longitude);
        if (place) {
          cache.setGeocode({
            latitude: nativeLocation.latitude,
            longitude: nativeLocation.longitude,
            name: place.name,
            province: place.province ?? '',
            country: place.country ?? '',
            source: 'reverse',
            fetchedAt: now,
          });
        }
      }
      locationCache = {
        name: place?.name || '当前位置',
        latitude: nativeLocation.latitude,
        longitude: nativeLocation.longitude,
        timezone,
        source: nativeLocation.source,
        accuracy: nativeLocation.accuracy,
        ...(place?.province ? { province: place.province } : {}),
        ...(place?.country ? { country: place.country } : {}),
      };
      locationCacheAt = now;
      return locationCache;
    }

    const fallback = timezoneFallback(timezone);
    locationCache = fallback
      ? { ...fallback, name: '当前位置', timezone, source: 'timezone' }
      : {
          name: '当前位置',
          latitude: 31.2304,
          longitude: 121.4737,
          timezone,
          source: 'fallback',
        };
    locationCacheAt = now;
    return locationCache;
  }

  function quotaStatus(weather: WeatherSettings): WeatherQuotaStatus {
    const usage = cache.weatherUsage();
    const limit = weather.qweather.monthlyLimit;
    const used = usage.qweather;
    return {
      month: usage.month,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      exhausted: used >= limit,
    };
  }

  function reserveQWeatherCalls(count: number, weather: WeatherSettings): void {
    const usage = cache.weatherUsage();
    const limit = weather.qweather.monthlyLimit;
    if (usage.qweather + count > limit) {
      throw new WeatherQuotaError(limit, usage.qweather, usage.month);
    }
    cache.addQWeatherCalls(count);
  }

  async function resolveNmcLocation(weather: WeatherSettings): Promise<ProviderLocation | null> {
    try {
      if (weather.mode === 'manual') {
        const slot = weather.locations.nmc;
        const knownCountry = slot.country || weather.locations.qweather.country || weather.locations['open-meteo'].country;
        // NMC only covers China. Do not spend a directory lookup on a foreign
        // manual location that another provider already geocoded.
        if (knownCountry && !isChinaCountry(knownCountry)) return null;
        if (slot.locationId) {
          return {
            name: weather.name || slot.locationId,
            latitude: slot.latitude ?? 0,
            longitude: slot.longitude ?? 0,
            source: 'manual',
            locationId: slot.locationId,
            timezone: slot.timezone || 'Asia/Shanghai',
            country: slot.country || '中国',
            province: '',
          };
        }
        if (!weather.name) return null;
        const city = await resolveNmcCity(weather.name, '', cache, { log, locale: locale() });
        if (!city) return null;
        return {
          name: weather.name,
          latitude: slot.latitude ?? 0,
          longitude: slot.longitude ?? 0,
          source: 'manual',
          locationId: city.code,
          timezone: 'Asia/Shanghai',
          country: '中国',
          province: city.province,
        };
      }
      const resolved = await resolveLocation();
      // Automatic mode deliberately does not reverse-geocode the system
      // coordinates, so NMC cannot map them to a station by name.
      if (resolved.name === '当前位置') return null;
      if (resolved.country && !isChinaCountry(resolved.country)) return null;
      const city = await resolveNmcCity(resolved.name, resolved.province, cache, { log, locale: locale() });
      if (!city) return null;
      return {
        name: resolved.name,
        latitude: resolved.latitude,
        longitude: resolved.longitude,
        source: resolved.source,
        locationId: city.code,
        timezone: resolved.timezone || 'Asia/Shanghai',
        country: resolved.country || '中国',
        province: resolved.province || city.province,
      };
    } catch (error) {
      log(`nmc location resolution failed: ${serializeError(error)}`);
      return null;
    }
  }

  async function buildProviderLocation(
    provider: WeatherProvider,
    weather: WeatherSettings,
  ): Promise<ProviderLocation> {
    if (weather.mode === 'manual') {
      const name = weather.name || '';
      if (!name) throw new Error('No weather location has been selected');
      const slot = weather.locations[provider];
      if (provider === 'nmc') {
        const nmc = await resolveNmcLocation(weather);
        if (!nmc) throw new Error('NMC does not provide weather for this location');
        return nmc;
      }
      const ownLatitude = slot.latitude;
      const ownLongitude = slot.longitude;
      // A location picked while another coordinate-based provider was active is
      // still the same physical place; reuse its coordinates instead of forcing
      // the user to search twice.
      const fallback = weather.locations.qweather;
      const latitude = ownLatitude ?? fallback.latitude;
      const longitude = ownLongitude ?? fallback.longitude;
      if (latitude === null || longitude === null) throw new Error('No weather location has been selected');
      return {
        name,
        latitude,
        longitude,
        source: 'manual',
        locationId: slot.locationId,
        timezone: slot.timezone || fallback.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        country: slot.country || fallback.country || '',
        province: '',
      };
    }

    const resolved = await resolveLocation();
    if (provider === 'nmc') {
      const nmc = await resolveNmcLocation(weather);
      if (!nmc) throw new Error('NMC does not provide weather for this location');
      return nmc;
    }
    return {
      name: resolved.name,
      latitude: resolved.latitude,
      longitude: resolved.longitude,
      source: resolved.source,
      locationId: '',
      timezone: resolved.timezone,
      country: resolved.country || '',
      province: resolved.province || '',
    };
  }

  /** Provider choice when QWeather's quota has been exhausted. */
  async function chooseQuotaFallback(weather: WeatherSettings): Promise<ProviderChoice> {
    const nmc = await resolveNmcLocation(weather);
    if (nmc) return { provider: 'nmc', switched: true, location: nmc };
    return { provider: 'open-meteo', switched: true };
  }

  function cacheTtl(provider: WeatherProvider, weather: WeatherSettings): number {
    if (provider === 'qweather') {
      return Math.max(
        weather.qweather.refreshMinutes,
        minimumQWeatherRefreshMinutes(weather.qweather.monthlyLimit),
      ) * 60_000;
    }
    return WEATHER_TTL_MS;
  }

  /** Read the optional Console API; console calls do not count against quota. */
  async function syncConsole(): Promise<QWeatherConsoleSnapshot | null> {
    const weather = settings();
    if (!weather.qweather.syncConsole) return cache.qweatherConsole();
    if (!qweatherConfigured(weather.qweather)) {
      throw new Error('QWeather credentials are incomplete');
    }
    if (consoleSyncBusy) return cache.qweatherConsole();
    consoleSyncBusy = true;
    try {
      const snapshot = await fetchQWeatherConsole(weather.qweather, {
        reserve: () => {},
        locale: locale(),
        forecastMode: weather.forecastMode,
        log,
      });
      cache.setQWeatherConsole(snapshot);
      if (snapshot.monthlyUsed !== null) cache.reconcileQWeatherUsage(snapshot.monthlyUsed);
      consoleSyncAt = Date.now();
      return snapshot;
    } catch (error) {
      const snapshot: QWeatherConsoleSnapshot = {
        fetchedAt: Date.now(),
        asOf: null,
        stats: null,
        monthlyUsed: null,
        errors: [serializeError(error)],
      };
      cache.setQWeatherConsole(snapshot);
      consoleSyncAt = Date.now();
      return snapshot;
    } finally {
      consoleSyncBusy = false;
    }
  }

  function syncConsoleIfDue(): void {
    const weather = settings();
    if (!weather.qweather.syncConsole || !qweatherConfigured(weather.qweather)) return;
    if (consoleSyncBusy || Date.now() - consoleSyncAt < 60 * 60 * 1000) return;
    void syncConsole();
  }

  function locationKey(provider: WeatherProvider, location: ProviderLocation): string {
    return provider === 'nmc'
      ? `id:${location.locationId || location.name}`
      : `${location.latitude.toFixed(2)},${location.longitude.toFixed(2)}`;
  }

  function failedPayload(
    provider: WeatherProvider,
    requestedProvider: WeatherProvider,
    switched: boolean,
    location: WeatherLocation,
    error: string,
  ): WeatherPayload {
    return {
      ok: false,
      provider,
      requestedProvider,
      providerSwitched: switched,
      switchReason: switched ? 'qweather-quota' : null,
      location,
      current: null,
      daily: null,
      hourly: [],
      dailyForecast: [],
      airQuality: null,
      error,
      updatedAt: Date.now(),
    };
  }

  async function getWeather(): Promise<WeatherPayload> {
    const weather = settings();
    if (weather.provider === 'qweather') syncConsoleIfDue();
    const requested = weather.provider;
    let provider: WeatherProvider = requested;
    let switched = false;
    let location: ProviderLocation | null = null;
    let key = '';

    try {
      const quota = quotaStatus(weather);
      if (requested === 'qweather' && quota.exhausted) {
        const choice = await chooseQuotaFallback(weather);
        provider = choice.provider;
        switched = true;
        location = choice.location ?? null;
      }
      location = location ?? await buildProviderLocation(provider, weather);
      key = `${provider}|${locationKey(provider, location)}|${weather.forecastMode}`;

      const cached = weatherCache.get(key);
      const ttl = cacheTtl(provider, weather);
      if (cached && Date.now() - cached.at < (cached.error ? WEATHER_ERROR_TTL_MS : ttl)) {
        return {
          ...cached.value,
          provider,
          requestedProvider: requested,
          providerSwitched: switched,
          switchReason: switched ? 'qweather-quota' : null,
          cached: true,
        };
      }

      let payload: WeatherPayload | null = null;
      let attempts = 0;
      for (;;) {
        try {
          if (provider === 'qweather') {
            if (!qweatherConfigured(weather.qweather)) {
              throw new Error('QWeather credentials are incomplete');
            }
            payload = await fetchQWeatherWeather(location, weather.qweather, {
              reserve: (count) => reserveQWeatherCalls(count, weather),
              locale: locale(),
              forecastMode: weather.forecastMode,
              log,
            });
          } else if (provider === 'nmc') {
            payload = await fetchNmcWeather(location, { log, locale: locale() });
          } else {
            payload = await fetchOpenMeteoWeather(location);
          }
          break;
        } catch (error) {
          // A concurrent city search can consume the last calls between the
          // status check and the reservation. Switch once in that case.
          if (
            error instanceof WeatherQuotaError &&
            !switched &&
            requested === 'qweather' &&
            attempts === 0
          ) {
            attempts += 1;
            const choice = await chooseQuotaFallback(weather);
            provider = choice.provider;
            switched = true;
            location = choice.location ?? await buildProviderLocation(provider, weather);
            key = `${provider}|${locationKey(provider, location)}|${weather.forecastMode}`;
            continue;
          }
          throw error;
        }
      }

      payload.provider = provider;
      payload.requestedProvider = requested;
      payload.providerSwitched = switched;
      payload.switchReason = switched ? 'qweather-quota' : null;
      payload.updatedAt = Date.now();
      weatherCache.set(key, { at: Date.now(), value: payload });
      if (weatherCache.size > WEATHER_CACHE_LIMIT) {
        const oldest = weatherCache.keys().next().value;
        if (oldest !== undefined) weatherCache.delete(oldest);
      }
      lastWeather = payload;
      lastError = null;
      return payload;
    } catch (error) {
      const message = serializeError(error);
      const fallbackLocation: WeatherLocation = location
        ? weatherLocation(location)
        : {
            name: weather.name || '当前位置',
            latitude: 0,
            longitude: 0,
            source: weather.mode === 'manual' ? 'manual' : 'auto',
          };
      const payload = failedPayload(provider, requested, switched, fallbackLocation, message);
      if (key) weatherCache.set(key, { at: Date.now(), value: payload, error: true });
      lastWeather = payload;
      lastError = message;
      log(`weather ${provider} failed: ${message}`);
      return payload;
    }
  }

  async function searchCities(
    query: string,
    limit: number = 8,
    override?: WeatherOverride,
  ): Promise<GeocodePlace[]> {
    const weather = settings();
    const provider = override?.provider ?? weather.provider;
    const count = Math.max(1, Math.min(20, Math.trunc(limit) || 8));
    const name = safeString(query, 80).trim();
    if (!name) return [];
    const key = `${provider}|${name.toLowerCase()}|${count}|${locale()}`;
    const now = Date.now();
    const cached = geocodeCache.get(key);
    if (cached && now - cached.at < GEOCODE_TTL_MS) return cached.value;

    let places: GeocodePlace[];
    if (provider === 'qweather') {
      const qweather = { ...weather.qweather, ...(override?.qweather ?? {}) };
      if (!qweatherConfigured(qweather)) throw new Error('QWeather credentials are incomplete');
      const quota = quotaStatus({ ...weather, qweather });
      if (quota.exhausted) throw new WeatherQuotaError(quota.limit, quota.used, quota.month);
      places = await searchQWeatherCities(name, qweather, {
        reserve: (value) => reserveQWeatherCalls(value, { ...weather, qweather }),
        locale: locale(),
        forecastMode: weather.forecastMode,
        log,
      }, count);
    } else if (provider === 'nmc') {
      places = await searchNmcCities(name, count, cache, { log, locale: locale() });
    } else {
      places = await searchOpenMeteoCities(name, count);
    }

    geocodeCache.set(key, { at: now, value: places });
    if (geocodeCache.size > GEOCODE_CACHE_LIMIT) {
      const oldest = geocodeCache.keys().next().value;
      if (oldest !== undefined) geocodeCache.delete(oldest);
    }
    return places;
  }

  /** Best-effort quota target before the first request settles. */
  function quotaFallbackPreview(weather: WeatherSettings): WeatherProvider {
    if (weather.mode === 'manual') {
      const countries = [
        weather.locations.nmc.country,
        weather.locations.qweather.country,
        weather.locations['open-meteo'].country,
      ].filter(Boolean);
      if (countries.some((country) => !isChinaCountry(country))) return 'open-meteo';
      if (weather.locations.nmc.locationId) return 'nmc';
      if (/[\u4e00-\u9fff]/u.test(weather.name)) return 'nmc';
      return 'open-meteo';
    }
    return 'nmc';
  }

  function status(): WeatherStatus {
    const weather = settings();
    const quota = quotaStatus(weather);
    const forcedSwitch = weather.provider === 'qweather' && quota.exhausted;
    const actual = lastWeather?.provider ?? (forcedSwitch ? quotaFallbackPreview(weather) : null);
    return {
      requestedProvider: weather.provider,
      provider: actual,
      switchedByQuota: lastWeather?.providerSwitched === true || (forcedSwitch && actual !== null),
      quota,
      configured: qweatherConfigured(weather.qweather),
      location: lastWeather?.location ?? null,
      console: cache.qweatherConsole(),
      error: lastError,
    };
  }

  return { getWeather, searchCities, syncConsole, resetLocation, refreshLocation, status };
}
