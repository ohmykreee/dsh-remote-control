/** Shared weather payload types for the Host providers and the console. */

import type { ForecastMode, QWeatherSettings, WeatherProvider } from './settings.js';

/** A coordinate plus its label, as echoed in the weather payload. */
export interface WeatherLocation {
  name: string;
  latitude: number;
  longitude: number;
  source: string;
  province?: string;
  country?: string;
}

/** Location chosen by `resolveLocation`, which also settles the timezone. */
export interface ResolvedLocation extends WeatherLocation {
  timezone: string;
  accuracy?: number | null;
  error?: string;
}

/** One city returned by a geocoding API. */
export interface GeocodePlace {
  id?: string | number;
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1: string;
  admin2?: string;
  timezone: string;
}

/** The `current` block after normalisation to the console shape. */
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

/** Current-day air quality, when the provider supplies it. */
export interface AirQuality {
  aqi: number;
  /** Provider display value (may be non-integer for QAQI). */
  display: string;
  /** One of 1..6 when the provider reports a level. */
  level: number | null;
  category: string | null;
  primaryPollutant: string | null;
}

/**
 * Browser-facing weather snapshot. `current`/`daily` are null when the upstream
 * request failed, in which case `error` is set and the strips are empty.
 */
export interface WeatherPayload {
  ok: boolean;
  /** Actual provider that produced this payload. */
  provider?: WeatherProvider;
  /** Provider selected in the settings, even if it was switched by quota. */
  requestedProvider?: WeatherProvider;
  /** True when the QWeather calendar-month quota forced a switch. */
  providerSwitched?: boolean;
  switchReason?: 'qweather-quota' | null;
  location: WeatherLocation;
  current: WeatherCurrent | null;
  daily: WeatherDaily | null;
  hourly: WeatherHourly[];
  dailyForecast: WeatherDailyForecast[];
  airQuality?: AirQuality | null;
  timezone?: string | null;
  error?: string;
  cached?: boolean;
  /** Added by the service layer after `getWeather` returns. */
  forecastMode?: 'daily' | 'hourly';
  updatedAt: number;
}

/** Quota counters shown in the settings page and diagnostics. */
export interface WeatherQuotaStatus {
  month: string;
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
}

/** 24-hour request statistics returned by the QWeather Console API. */
export interface QWeatherConsoleStats {
  asOf: string | null;
  success: number;
  errors: number;
  total: number;
}

/** Last successful or failed console sync. Only call counts are kept. */
export interface QWeatherConsoleSnapshot {
  fetchedAt: number;
  asOf: string | null;
  stats: QWeatherConsoleStats | null;
  /** Monthly used count derived from an active resource plan, when present. */
  monthlyUsed: number | null;
  errors: string[];
}

/** Thrown before a QWeather request when the calendar-month limit is reached. */
export class WeatherQuotaError extends Error {
  readonly limit: number;
  readonly used: number;
  readonly month: string;

  constructor(limit: number, used: number, month: string) {
    super('QWeather monthly call limit reached');
    this.name = 'WeatherQuotaError';
    this.limit = limit;
    this.used = used;
    this.month = month;
  }
}

export interface WeatherStatus {
  requestedProvider: WeatherProvider;
  provider: WeatherProvider | null;
  switchedByQuota: boolean;
  quota: WeatherQuotaStatus;
  configured: boolean;
  location: WeatherLocation | null;
  console: QWeatherConsoleSnapshot | null;
  error: string | null;
}

/** A provider-specific location, including the id the provider needs. */
export interface ProviderLocation extends WeatherLocation {
  locationId: string;
  timezone: string;
  country: string;
}

/** Draft credentials used by the sidebar's geocode/JWT test routes. */
export interface WeatherOverride {
  provider?: WeatherProvider;
  qweather?: Partial<QWeatherSettings>;
  forecastMode?: ForecastMode;
}

export interface WeatherService {
  getWeather(): Promise<WeatherPayload>;
  /** Forward geocoding for the settings page's city search. */
  searchCities(query: string, limit?: number, override?: WeatherOverride): Promise<GeocodePlace[]>;
  /** Read QWeather finance/stats and reconcile the local monthly counter. */
  syncConsole(): Promise<QWeatherConsoleSnapshot | null>;
  /** Drop cached coordinates so a permission change is picked up immediately. */
  resetLocation(): void;
  /** Explicit refresh: re-read system location and bypass the name cache. */
  refreshLocation(): void;
  status(): WeatherStatus;
}
