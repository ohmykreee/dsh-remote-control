/**
 * Central Meteorological Observatory (nmc.cn) provider.
 *
 * NMC has no public key: it exposes a province → city directory and a
 * `rest/weather` endpoint keyed by its own station code. The directory is large
 * and stable, so a copy is kept in the plugin cache; auto locations use the
 * reverse-geocoded province to fetch only that province before falling back to
 * the full directory.
 */

import { NMC_CITY_TTL_MS, type NmcCity, type PluginCacheStore } from '../cache/index.js';
import { isRecord } from '../shared/types.js';
import type { JsonRecord } from '../shared/types.js';
import { safeString } from '../shared/util.js';
import {
  arrayOf,
  errorDetail,
  fetchJson,
  isChinaCountry,
  mapNmcCode,
  normalizeAirQuality,
  numberOrNullValue,
  stripRegionSuffix,
} from './shared.js';
import type {
  GeocodePlace,
  ProviderLocation,
  WeatherPayload,
} from '../shared/types.js';

const NMC_BASE = 'https://www.nmc.cn/rest';
const NMC_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  referer: 'https://www.nmc.cn/',
};

export interface NmcRequestOptions {
  log?: (message: string) => void;
  locale?: 'zh' | 'en';
}

interface NmcProvince {
  code: string;
  name: string;
}

async function fetchNmc(pathname: string): Promise<unknown> {
  return fetchJson(`${NMC_BASE}${pathname}`, { timeoutMs: 8000, headers: NMC_HEADERS });
}

function readProvinces(raw: unknown): NmcProvince[] {
  const provinces: NmcProvince[] = [];
  for (const item of arrayOf(raw)) {
    if (!isRecord(item)) continue;
    const code = safeString(item.code, 40);
    const name = safeString(item.name, 80);
    if (code && name) provinces.push({ code, name });
  }
  return provinces;
}

function readCities(raw: unknown, provinceName: string): NmcCity[] {
  const cities: NmcCity[] = [];
  for (const item of arrayOf(raw)) {
    if (!isRecord(item)) continue;
    const code = safeString(item.code, 40);
    const city = safeString(item.city, 80);
    if (!code || !city) continue;
    cities.push({
      code,
      city,
      province: safeString(item.province, 80) || provinceName,
      url: safeString(item.url, 200),
    });
  }
  return cities;
}

async function fetchProvinceList(options: NmcRequestOptions): Promise<NmcProvince[]> {
  void options;
  const raw = await fetchNmc('/province/all');
  const provinces = readProvinces(raw);
  if (provinces.length === 0) throw new Error('NMC province list was empty');
  return provinces;
}

async function fetchProvinceCities(
  province: NmcProvince,
  options: NmcRequestOptions,
): Promise<NmcCity[]> {
  void options;
  const raw = await fetchNmc(`/province/${encodeURIComponent(province.code)}`);
  return readCities(raw, province.name);
}

/**
 * Fetch every province in parallel. A partial directory is cached for one day
 * so a temporary NMC outage does not force a full rebuild on every request.
 */
async function loadFullCityCache(
  cache: PluginCacheStore,
  options: NmcRequestOptions,
): Promise<NmcCity[]> {
  const cached = cache.nmcCities();
  if (cached && Date.now() - cached.fetchedAt < NMC_CITY_TTL_MS) return cached.cities;

  const provinces = await fetchProvinceList(options);
  const cities: NmcCity[] = [];
  const queue = [...provinces];
  let failures = 0;
  const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
    for (;;) {
      const province = queue.shift();
      if (!province) return;
      try {
        cities.push(...await fetchProvinceCities(province, options));
      } catch {
        failures += 1;
      }
    }
  });
  await Promise.all(workers);
  if (cities.length === 0) {
    if (cached?.cities.length) return cached.cities;
    throw new Error('NMC city directory is unavailable');
  }
  const deduped = [...new Map(cities.map((city) => [city.code, city])).values()];
  const fetchedAt = failures === 0 ? Date.now() : Date.now() - NMC_CITY_TTL_MS + 24 * 60 * 60 * 1000;
  cache.setNmcCities(deduped, fetchedAt);
  if (failures > 0) options.log?.(`nmc city directory: ${failures} province request(s) failed`);
  return deduped;
}

function pickCity(cities: NmcCity[], name: string, province?: string): NmcCity | null {
  const cityName = stripRegionSuffix(name);
  const provinceName = stripRegionSuffix(province ?? '');
  if (!cityName) return null;
  const candidates = cities.filter((city) => stripRegionSuffix(city.city) === cityName);
  if (candidates.length === 0) return null;
  if (provinceName) {
    const inProvince = candidates.find((city) => {
      const value = stripRegionSuffix(city.province);
      return value === provinceName || value.includes(provinceName) || provinceName.includes(value);
    });
    if (inProvince) return inProvince;
  }
  return candidates[0];
}

/** Resolve an automatic location to an NMC station without always loading all cities. */
export async function resolveNmcCity(
  name: string,
  province: string | undefined,
  cache: PluginCacheStore,
  options: NmcRequestOptions,
): Promise<NmcCity | null> {
  const cached = cache.nmcCities();
  if (cached && cached.cities.length > 0) {
    const match = pickCity(cached.cities, name, province);
    if (match) return match;
  }

  const provinceName = stripRegionSuffix(province ?? '');
  if (provinceName) {
    try {
      const provinces = await fetchProvinceList(options);
      const entry = provinces.find((item) => {
        const value = stripRegionSuffix(item.name);
        return value === provinceName || value.includes(provinceName) || provinceName.includes(value);
      });
      if (entry) {
        const cities = await fetchProvinceCities(entry, options);
        const match = pickCity(cities, name, province);
        if (match) return match;
      }
    } catch (error) {
      options.log?.(`nmc province lookup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const cities = await loadFullCityCache(cache, options);
  return pickCity(cities, name, province);
}

/** City search for the settings page. */
export async function searchNmcCities(
  query: string,
  limit: number,
  cache: PluginCacheStore,
  options: NmcRequestOptions,
): Promise<GeocodePlace[]> {
  const cities = await loadFullCityCache(cache, options);
  const needle = stripRegionSuffix(query);
  if (!needle) return [];
  const scored: Array<{ city: NmcCity; score: number }> = [];
  for (const city of cities) {
    const name = stripRegionSuffix(city.city);
    const province = stripRegionSuffix(city.province);
    const combined = `${province}${name}`;
    let score = -1;
    if (name === needle) score = 0;
    else if (combined === needle) score = 1;
    else if (name.startsWith(needle)) score = 2;
    else if (name.includes(needle) || combined.includes(needle)) score = 3;
    if (score >= 0) scored.push({ city, score });
  }
  scored.sort((left, right) => (
    left.score - right.score ||
    left.city.city.length - right.city.city.length ||
    left.city.province.localeCompare(right.city.province, 'zh-CN') ||
    left.city.city.localeCompare(right.city.city, 'zh-CN')
  ));
  const seen = new Set<string>();
  const places: GeocodePlace[] = [];
  for (const { city } of scored) {
    if (seen.has(city.code)) continue;
    seen.add(city.code);
    places.push({
      id: city.code,
      name: city.city,
      latitude: 0,
      longitude: 0,
      country: '中国',
      admin1: city.province,
      timezone: 'Asia/Shanghai',
    });
    if (places.length >= Math.max(1, Math.min(20, limit))) break;
  }
  return places;
}

function localIso(value: unknown): string | null {
  const text = safeString(value, 40).trim();
  if (!text) return null;
  return text.includes(' ') ? text.replace(' ', 'T') : text;
}

/** NMC uses 9999 for every missing numeric field. */
function nmcNumber(value: unknown): number | null {
  const number = numberOrNullValue(value);
  return number === null || number >= 9999 ? null : number;
}

function temperatureChart(data: JsonRecord): Map<string, { high: number | null; low: number | null }> {
  const chart = new Map<string, { high: number | null; low: number | null }>();
  for (const item of arrayOf(data.tempchart)) {
    if (!isRecord(item)) continue;
    const time = safeString(item.time, 20).replaceAll('/', '-');
    if (!time) continue;
    chart.set(time, { high: nmcNumber(item.max_temp), low: nmcNumber(item.min_temp) });
  }
  return chart;
}

function dayTemperatures(
  day: JsonRecord,
  chart: Map<string, { high: number | null; low: number | null }>,
): { high: number | null; low: number | null } {
  const date = safeString(day.date, 20);
  const fallback = chart.get(date) ?? { high: null, low: null };
  const dayWeather = recordPath(day, 'day', 'weather');
  const nightWeather = recordPath(day, 'night', 'weather');
  return {
    high: nmcNumber(dayWeather.temperature) ?? fallback.high,
    low: nmcNumber(nightWeather.temperature) ?? fallback.low,
  };
}

function isDayClock(value: unknown): boolean {
  const text = safeString(value, 40);
  const match = /(\d{1,2}):(\d{2})/u.exec(text);
  if (!match) return true;
  const hour = Number(match[1]);
  return hour >= 6 && hour < 18;
}

function recordPath(record: unknown, ...keys: string[]): JsonRecord {
  let current: unknown = record;
  for (const key of keys) {
    if (!isRecord(current)) return {};
    current = current[key];
  }
  return isRecord(current) ? current : {};
}

/** NMC uses `9999`/`-` for a missing half of the day; prefer the other half. */
function nmcCondition(dayWeather: JsonRecord, nightWeather: JsonRecord): number {
  const dayInfo = safeString(dayWeather.info, 40).trim();
  const nightInfo = safeString(nightWeather.info, 40).trim();
  const dayHasData = Boolean(dayInfo && dayInfo !== '9999' && dayInfo !== '-' && dayInfo !== '--');
  if (dayHasData) return mapNmcCode(dayWeather.img, dayInfo);
  return mapNmcCode(nightWeather.img, nightInfo);
}

export async function fetchNmcWeather(
  location: ProviderLocation,
  options: NmcRequestOptions,
): Promise<WeatherPayload> {
  if (!location.locationId) throw new Error('NMC station is not selected');
  const raw = await fetchNmc(`/weather?stationid=${encodeURIComponent(location.locationId)}`);
  const payload: JsonRecord = isRecord(raw) ? raw : {};
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) {
    throw new Error(`NMC weather failed: ${errorDetail(raw) || safeString(payload.msg, 80) || 'empty data'}`);
  }
  const real = isRecord(data.real) ? data.real : null;
  if (!real) throw new Error('NMC weather response is incomplete');
  const weather = recordPath(real, 'weather');
  const wind = recordPath(real, 'wind');
  const sun = recordPath(real, 'sunriseSunset');
  const predict = isRecord(data.predict) ? data.predict : {};
  const detail = arrayOf(predict.detail).filter(isRecord);
  const chart = temperatureChart(data);
  const day0 = detail[0] ?? {};
  const day1 = detail[1];
  const dayWeather0 = recordPath(day0, 'day', 'weather');
  const nightWeather0 = recordPath(day0, 'night', 'weather');
  const day0Temps = dayTemperatures(day0, chart);
  const day1Temps = day1 ? dayTemperatures(day1, chart) : { high: null, low: null };
  const publishTime = safeString(real.publish_time, 40);
  const sunrise = localIso(sun.sunrise);
  const sunset = localIso(sun.sunset);
  const windSpeed = nmcNumber(wind.speed);

  const dailyForecast = detail.slice(0, 7).map((day) => {
    const dayWeather = recordPath(day, 'day', 'weather');
    const nightWeather = recordPath(day, 'night', 'weather');
    const temps = dayTemperatures(day, chart);
    return {
      date: safeString(day.date, 20) || null,
      code: nmcCondition(dayWeather, nightWeather),
      high: temps.high,
      low: temps.low,
      sunrise: null,
      sunset: null,
    };
  });

  const air = isRecord(data.air) ? data.air : {};
  const airAqi = nmcNumber(air.aqi);
  const airQuality = normalizeAirQuality(
    airAqi,
    airAqi === null ? null : String(airAqi),
    air.aq,
    air.text,
    null,
  );

  return {
    ok: true,
    location: {
      name: location.name || safeString(recordPath(real, 'station').city, 80),
      latitude: location.latitude,
      longitude: location.longitude,
      source: location.source,
      ...(location.province ? { province: location.province } : {}),
      ...(location.country ? { country: location.country } : {}),
    },
    current: {
      time: publishTime || null,
      temperature: nmcNumber(weather.temperature),
      feelsLike: nmcNumber(weather.feelst),
      humidity: nmcNumber(weather.humidity),
      precipitation: nmcNumber(weather.rain) ?? 0,
      code: mapNmcCode(weather.img, weather.info),
      isDay: isDayClock(publishTime),
      windSpeed: windSpeed === null ? null : Math.round(windSpeed * 3.6 * 10) / 10,
    },
    daily: {
      code: nmcCondition(dayWeather0, nightWeather0),
      high: day0Temps.high,
      low: day0Temps.low,
      sunrise,
      sunset,
      tomorrowHigh: day1Temps.high,
      tomorrowLow: day1Temps.low,
    },
    hourly: [],
    dailyForecast,
    airQuality,
    timezone: location.timezone || 'Asia/Shanghai',
    updatedAt: Date.now(),
  };
}

/** NMC only covers Chinese locations; use it for auto-switch only in China. */
export function nmcApplicableCountry(country: string | undefined): boolean {
  return !country || isChinaCountry(country);
}
