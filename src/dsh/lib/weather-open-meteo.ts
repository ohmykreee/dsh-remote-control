/** Open-Meteo provider: global forecast and city search, no credentials. */

import { fetchJson, normalizeAirQuality, numberOrNullValue } from './weather-shared.js';
import type {
  AirQuality,
  GeocodePlace,
  ProviderLocation,
  WeatherPayload,
} from './weather-types.js';
import { isRecord } from './types.js';
import type { JsonRecord } from './types.js';
import { finiteNumber, safeString } from './util.js';

const HAN_CITY_NAME = /^[\u4e00-\u9fff]{2,}$/u;

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** One Open-Meteo geocoding request, normalised to lowercase-safe places. */
async function geocodePlaces(name: string, count: number): Promise<GeocodePlace[]> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', name);
  url.searchParams.set('count', String(count));
  url.searchParams.set('language', 'zh');
  url.searchParams.set('format', 'json');
  const raw = await fetchJson(url.toString(), { timeoutMs: 8000 });
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

export async function searchOpenMeteoCities(query: string, limit: number): Promise<GeocodePlace[]> {
  const name = safeString(query, 80).trim();
  if (!name) return [];
  let places = await geocodePlaces(name, limit);
  // The Chinese index is incomplete for bare prefecture names: "厦门" returns
  // nothing while "厦门市" resolves. Retry once with the suffix.
  if (places.length === 0 && HAN_CITY_NAME.test(name)) {
    places = await geocodePlaces(`${name}市`, limit);
  }
  return places;
}

function europeanAqiLevel(value: number): number {
  if (value <= 20) return 1;
  if (value <= 40) return 2;
  if (value <= 60) return 3;
  if (value <= 80) return 4;
  if (value <= 100) return 5;
  return 6;
}

async function fetchOpenMeteoAirQuality(location: ProviderLocation): Promise<AirQuality | null> {
  try {
    const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
    url.searchParams.set('latitude', String(location.latitude));
    url.searchParams.set('longitude', String(location.longitude));
    url.searchParams.set('current', 'us_aqi,european_aqi,pm2_5,pm10');
    url.searchParams.set('timezone', 'auto');
    const raw = await fetchJson(url.toString(), { timeoutMs: 6500 });
    const payload = isRecord(raw) ? raw : null;
    const current: JsonRecord = payload && isRecord(payload.current) ? payload.current : {};
    const us = numberOrNullValue(current.us_aqi);
    const european = numberOrNullValue(current.european_aqi);
    const aqi = us ?? european;
    if (aqi === null) return null;
    const level = us !== null
      ? undefined
      : european !== null
        ? europeanAqiLevel(european)
        : undefined;
    return normalizeAirQuality(aqi, String(Math.round(aqi)), level ?? null);
  } catch {
    return null;
  }
}

export async function fetchOpenMeteoWeather(location: ProviderLocation): Promise<WeatherPayload> {
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

  const [raw, airQuality] = await Promise.all([
    fetchJson(url.toString(), { timeoutMs: 10000 }),
    fetchOpenMeteoAirQuality(location),
  ]);
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
  const upcoming = hourlyTimes.slice(startIndex, startIndex + 8).map((time, index) => ({
    time: stringOrNull(time),
    temperature: finiteNumber(hourlyTemperatures[startIndex + index]),
    code: finiteNumber(hourlyCodes[startIndex + index]),
    precipitationProbability: finiteNumber(hourlyPrecipitation[startIndex + index]),
  }));

  const now = Date.now();
  return {
    ok: true,
    location: {
      name: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      source: location.source,
      ...(location.province ? { province: location.province } : {}),
      ...(location.country ? { country: location.country } : {}),
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
    airQuality,
    timezone: stringOrNull(payload?.timezone),
    updatedAt: now,
  };
}
