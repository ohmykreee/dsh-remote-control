/**
 * QWeather provider.
 *
 * Authentication is JWT-only: the settings hold the API Host, credential id
 * (`kid`), project id (`sub`), developer id (`iss`) and an Ed25519 private key.
 * Every QWeather request is counted against the calendar-month quota *before*
 * it leaves the process, so the configured limit is never exceeded.
 */

import crypto from 'node:crypto';
import type { ForecastMode, QWeatherSettings } from '../settings.js';
import { WeatherQuotaError, isRecord } from '../types.js';
import type { JsonRecord } from '../types.js';
import { safeString } from '../util.js';
import {
  arrayOf,
  coordinatePath,
  errorDetail,
  fetchJson,
  isDaytime,
  mapQWeatherCode,
  nestedNumber,
  normalizeAirQuality,
} from './shared.js';
import type {
  AirQuality,
  GeocodePlace,
  ProviderLocation,
  QWeatherConsoleSnapshot,
  QWeatherConsoleStats,
  WeatherPayload,
} from '../types.js';

const JWT_TTL_SECONDS = 60 * 60;
const JWT_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const QWEATHER_TIMEOUT_MS = 10_000;

export interface QWeatherRequestOptions {
  /** Reserve calls against the quota; throws {@link WeatherQuotaError}. */
  reserve: (count: number) => void;
  locale: 'zh' | 'en';
  forecastMode: ForecastMode;
  log?: (message: string) => void;
}

interface GeneratedJwt {
  token: string;
  iat: number;
  exp: number;
}

let jwtCache: { key: string; token: string; exp: number } | null = null;

function nonEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function apiBase(apiHost: string): string {
  const host = nonEmpty(apiHost).replace(/^https?:\/\//i, '').replace(/\/.*$/u, '');
  if (!host || !/^[a-z0-9.-]+(?::\d{1,5})?$/iu.test(host)) {
    throw new Error('QWeather API Host is not configured');
  }
  return `https://${host}`;
}

function credentialsKey(settings: QWeatherSettings): string {
  return crypto
    .createHash('sha256')
    .update([
      settings.apiHost,
      settings.credentialId,
      settings.projectId,
      settings.developerId,
      settings.privateKey,
    ].join('\0'))
    .digest('hex');
}

/** Create a fresh Ed25519 key pair for first-time QWeather setup. */
export function generateQWeatherKeyPair(): { privateKey: string; publicKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/** Create a 1-hour Ed25519 JWT for the QWeather API. */
export function generateQWeatherJwt(
  settings: Pick<QWeatherSettings, 'credentialId' | 'projectId' | 'developerId' | 'privateKey'>,
  now: number = Date.now(),
): GeneratedJwt {
  const credentialId = nonEmpty(settings.credentialId);
  const projectId = nonEmpty(settings.projectId);
  const developerId = nonEmpty(settings.developerId);
  const privateKey = nonEmpty(settings.privateKey);
  if (!credentialId) throw new Error('QWeather credential id is required');
  if (!projectId) throw new Error('QWeather project id is required');
  if (!developerId) throw new Error('QWeather developer id is required');
  if (!privateKey) throw new Error('QWeather private key is required');

  let key: crypto.KeyObject;
  try {
    key = crypto.createPrivateKey({ key: privateKey, format: 'pem' });
  } catch {
    throw new Error('QWeather private key is not a valid PEM key');
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('QWeather private key must be an Ed25519 key');
  }

  const iat = Math.floor(now / 1000) - 30;
  const exp = iat + JWT_TTL_SECONDS;
  const header = { alg: 'EdDSA', kid: credentialId };
  const payload = { iss: developerId, sub: projectId, iat, exp };
  const encodedHeader = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign(null, Buffer.from(signingInput, 'utf8'), key);
  return {
    token: `${signingInput}.${signature.toString('base64url')}`,
    iat,
    exp,
  };
}

function cachedJwt(settings: QWeatherSettings, now: number = Date.now()): string {
  const key = credentialsKey(settings);
  if (jwtCache && jwtCache.key === key && jwtCache.exp * 1000 - now > JWT_REFRESH_MARGIN_MS) {
    return jwtCache.token;
  }
  const generated = generateQWeatherJwt(settings, now);
  jwtCache = { key, token: generated.token, exp: generated.exp };
  return generated.token;
}

export function qweatherConfigured(settings: QWeatherSettings): boolean {
  return Boolean(
    nonEmpty(settings.apiHost) &&
    nonEmpty(settings.credentialId) &&
    nonEmpty(settings.projectId) &&
    nonEmpty(settings.developerId) &&
    nonEmpty(settings.privateKey),
  );
}

/** Number of QWeather calls used by one refresh. */
export function qweatherCallsFor(forecastMode: ForecastMode): number {
  return forecastMode === 'hourly' ? 4 : 3;
}

async function requestQWeather(
  url: string,
  settings: QWeatherSettings,
  options: QWeatherRequestOptions,
  reserved: boolean,
): Promise<unknown> {
  const token = cachedJwt(settings);
  if (!reserved) options.reserve(1);
  const raw = await fetchJson(url, {
    timeoutMs: QWEATHER_TIMEOUT_MS,
    headers: { authorization: `Bearer ${token}` },
  });
  if (isRecord(raw) && raw.error) {
    throw new Error(`QWeather: ${errorDetail(raw) || 'request failed'}`);
  }
  return raw;
}

function queryString(params: Record<string, string>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) search.set(key, value);
  return search.toString();
}

/** Forward geocoding through QWeather GeoAPI (counts as one call). */
export async function searchQWeatherCities(
  query: string,
  settings: QWeatherSettings,
  options: QWeatherRequestOptions,
  limit: number,
): Promise<GeocodePlace[]> {
  const base = apiBase(settings.apiHost);
  const url = `${base}/geo/v2/city/lookup?${queryString({
    location: query,
    number: String(Math.max(1, Math.min(20, limit))),
    lang: options.locale === 'zh' ? 'zh' : 'en',
  })}`;
  const raw = await requestQWeather(url, settings, options, false);
  const payload: JsonRecord = isRecord(raw) ? raw : {};
  const code = safeString(payload.code, 20);
  if (code !== '200') {
    throw new Error(`QWeather GeoAPI failed: ${errorDetail(raw) || `code ${code || 'unknown'}`}`);
  }
  const places: GeocodePlace[] = [];
  const seen = new Set<string>();
  for (const item of arrayOf(payload.location)) {
    if (!isRecord(item)) continue;
    const name = safeString(item.name, 120).trim();
    const latitude = Number(item.lat);
    const longitude = Number(item.lon);
    if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const id = safeString(item.id, 40);
    const dedupe = `${id || name}|${latitude.toFixed(4)}|${longitude.toFixed(4)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    places.push({
      id,
      name,
      latitude,
      longitude,
      country: safeString(item.country, 80).trim(),
      admin1: safeString(item.adm1, 80).trim(),
      admin2: safeString(item.adm2, 80).trim(),
      timezone: safeString(item.tz, 80).trim(),
    });
  }
  return places;
}

function parseAirQuality(raw: unknown): AirQuality | null {
  if (!isRecord(raw)) return null;
  const indexes = arrayOf(raw.indexes).filter(isRecord);
  if (indexes.length === 0) return null;
  const preferred = indexes.find((index) => safeString(index.code, 20) === 'cn-mee')
    ?? indexes.find((index) => safeString(index.code, 20) === 'us-epa')
    ?? indexes.find((index) => safeString(index.code, 20) === 'qaqi')
    ?? indexes[0];
  const primary = isRecord(preferred.primaryPollutant)
    ? safeString(preferred.primaryPollutant.name, 80)
    : '';
  return normalizeAirQuality(
    preferred.aqi,
    preferred.aqiDisplay,
    preferred.level,
    preferred.category,
    primary,
  );
}

function sumHours(entries: unknown): number {
  let total = 0;
  for (const entry of arrayOf(entries)) {
    if (!isRecord(entry)) continue;
    for (const value of arrayOf(entry.hours)) {
      const hours = Number(value);
      if (Number.isFinite(hours) && hours > 0) total += hours;
    }
  }
  return Math.round(total);
}

/**
 * Normalize the Console API `finance/v1/summary` and `metrics/v1/stats`
 * responses. The finance response is best-effort: an active resource plan's
 * `utilized` is the only monthly number it can expose, and free accounts return
 * no resource plan at all. Money, balance and bill fields are ignored.
 */
export function parseQWeatherConsole(
  financeRaw: unknown,
  statsRaw: unknown,
  fetchedAt: number = Date.now(),
  errors: string[] = [],
): QWeatherConsoleSnapshot {
  const financeInput: JsonRecord = isRecord(financeRaw) ? financeRaw : {};
  const statsInput: JsonRecord = isRecord(statsRaw) ? statsRaw : {};
  const plans = arrayOf(financeInput.availableResourcePlans).filter(isRecord);
  let monthlyUsed: number | null = null;
  for (const plan of plans) {
    if (safeString(plan.status, 20) !== 'active') continue;
    const utilized = Number(plan.utilized);
    if (!Number.isFinite(utilized) || utilized < 0) continue;
    monthlyUsed = (monthlyUsed ?? 0) + utilized;
  }
  const success = sumHours(statsInput.success);
  const errorsCount = sumHours(statsInput.errors);
  const stats: QWeatherConsoleStats | null = isRecord(statsRaw)
    ? {
        asOf: safeString(statsInput.asOf, 40) || null,
        success,
        errors: errorsCount,
        total: success + errorsCount,
      }
    : null;
  return {
    fetchedAt,
    asOf: safeString(financeInput.asOf, 40) || stats?.asOf || null,
    stats,
    monthlyUsed,
    errors: errors.slice(0, 10),
  };
}

/** Read the optional QWeather Console API (two requests, both quota-counted). */
export async function fetchQWeatherConsole(
  settings: QWeatherSettings,
  options: QWeatherRequestOptions,
): Promise<QWeatherConsoleSnapshot> {
  if (!qweatherConfigured(settings)) throw new Error('QWeather credentials are incomplete');
  const base = apiBase(settings.apiHost);
  const results = await Promise.allSettled([
    requestQWeather(`${base}/finance/v1/summary`, settings, options, true),
    requestQWeather(`${base}/metrics/v1/stats`, settings, options, true),
  ]);
  const errors: string[] = [];
  const financeRaw = results[0]?.status === 'fulfilled' ? results[0].value : null;
  const statsRaw = results[1]?.status === 'fulfilled' ? results[1].value : null;
  if (results[0]?.status === 'rejected') {
    errors.push(`finance: ${results[0].reason instanceof Error ? results[0].reason.message : String(results[0].reason)}`);
  }
  if (results[1]?.status === 'rejected') {
    errors.push(`stats: ${results[1].reason instanceof Error ? results[1].reason.message : String(results[1].reason)}`);
  }
  return parseQWeatherConsole(financeRaw, statsRaw, Date.now(), errors);
}

/** Fetch current + daily (+ hourly and air quality) in one refresh. */
export async function fetchQWeatherWeather(
  location: ProviderLocation,
  settings: QWeatherSettings,
  options: QWeatherRequestOptions,
): Promise<WeatherPayload> {
  if (!qweatherConfigured(settings)) throw new Error('QWeather credentials are incomplete');
  const base = apiBase(settings.apiHost);
  const coords = coordinatePath(location.latitude, location.longitude);
  const lang = options.locale === 'zh' ? 'zh' : 'en';
  const calls = qweatherCallsFor(options.forecastMode);
  options.reserve(calls);

  const currentUrl = `${base}/weather/v1/current/${coords}?${queryString({ localTime: 'true', lang })}`;
  const dailyUrl = `${base}/weather/v1/daily/${coords}?${queryString({ days: '7', localTime: 'true', lang })}`;
  const airUrl = `${base}/airquality/v1/current/${coords}?${queryString({ lang })}`;
  const hourlyUrl = `${base}/weather/v1/hourly/${coords}?${queryString({ hours: '24', localTime: 'true', lang })}`;

  const tasks: Array<Promise<unknown>> = [
    requestQWeather(currentUrl, settings, options, true),
    requestQWeather(dailyUrl, settings, options, true),
    requestQWeather(airUrl, settings, options, true),
  ];
  if (options.forecastMode === 'hourly') {
    tasks.push(requestQWeather(hourlyUrl, settings, options, true));
  }
  const results = await Promise.allSettled(tasks);
  const currentRaw = results[0]?.status === 'fulfilled' ? results[0].value : null;
  const dailyRaw = results[1]?.status === 'fulfilled' ? results[1].value : null;
  if (results[0]?.status === 'rejected') throw results[0].reason;
  if (results[1]?.status === 'rejected') throw results[1].reason;
  const airRaw = results[2]?.status === 'fulfilled' ? results[2].value : null;
  const hourlyRaw = results[3]?.status === 'fulfilled' ? results[3].value : null;
  if (results[2]?.status === 'rejected') options.log?.('qweather air quality unavailable');
  if (results[3]?.status === 'rejected') options.log?.('qweather hourly forecast unavailable');

  const current: JsonRecord = isRecord(currentRaw) ? currentRaw : {};
  const daily: JsonRecord = isRecord(dailyRaw) ? dailyRaw : {};
  const days = arrayOf(daily.days).filter(isRecord);
  if (!isRecord(current.condition) || days.length === 0) {
    throw new Error('QWeather response was incomplete');
  }
  const day0 = days[0];
  const day1 = days[1];
  const daytime0 = isRecord(day0.daytime) ? day0.daytime : {};
  const nighttime0 = isRecord(day0.nighttime) ? day0.nighttime : {};
  const astro0 = isRecord(day0.astro) ? day0.astro : {};
  const sunrise = safeString(astro0.sunrise, 40) || null;
  const sunset = safeString(astro0.sunset, 40) || null;
  const currentTime = safeString(current.validTime, 40);
  const isDay = isDaytime(currentTime, sunrise, sunset);
  const humidity = nestedNumber(current, 'humidity');
  const windSpeed = nestedNumber(current, 'wind.speed.value');

  const hourly: WeatherPayload['hourly'] = [];
  if (isRecord(hourlyRaw)) {
    for (const hour of arrayOf(hourlyRaw.hours).filter(isRecord).slice(0, 8)) {
      const condition = isRecord(hour.condition) ? hour.condition : {};
      hourly.push({
        time: safeString(hour.forecastTime, 40) || null,
        temperature: nestedNumber(hour, 'temperature.value'),
        code: mapQWeatherCode(condition.code),
        precipitationProbability: nestedNumber(hour, 'precipitation.probability') !== null
          ? Math.round((nestedNumber(hour, 'precipitation.probability') as number) * 100)
          : null,
      });
    }
  }

  const dailyForecast = days.slice(0, 7).map((day) => {
    const daytime = isRecord(day.daytime) ? day.daytime : {};
    const nighttime = isRecord(day.nighttime) ? day.nighttime : {};
    const condition = isRecord(daytime.condition) ? daytime.condition : (isRecord(nighttime.condition) ? nighttime.condition : {});
    const start = safeString(daytime.forecastStartTime, 40) || safeString(day.forecastStartTime, 40);
    return {
      date: start ? start.slice(0, 10) : null,
      code: mapQWeatherCode(condition.code),
      high: nestedNumber(day, 'temperatureMax.value'),
      low: nestedNumber(day, 'temperatureMin.value'),
      sunrise: null,
      sunset: null,
    };
  });

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
      time: currentTime || null,
      temperature: nestedNumber(current, 'temperature.value'),
      feelsLike: nestedNumber(current, 'feelsLike.value'),
      humidity: humidity === null ? null : Math.round(Math.max(0, Math.min(100, humidity * 100))),
      precipitation: nestedNumber(current, 'precipitation.amount.value') ?? 0,
      code: mapQWeatherCode(isRecord(current.condition) ? current.condition.code : null),
      isDay,
      windSpeed: windSpeed === null ? null : Math.round(windSpeed * 3.6 * 10) / 10,
    },
    daily: {
      code: mapQWeatherCode(isRecord(daytime0.condition) ? daytime0.condition.code : (isRecord(nighttime0.condition) ? nighttime0.condition.code : null)),
      high: nestedNumber(day0, 'temperatureMax.value'),
      low: nestedNumber(day0, 'temperatureMin.value'),
      sunrise,
      sunset,
      tomorrowHigh: day1 ? nestedNumber(day1, 'temperatureMax.value') : null,
      tomorrowLow: day1 ? nestedNumber(day1, 'temperatureMin.value') : null,
    },
    hourly,
    dailyForecast,
    airQuality: parseAirQuality(airRaw),
    timezone: location.timezone || null,
    updatedAt: now,
  };
}
