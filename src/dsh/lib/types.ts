/**
 * Shared Host-side contracts for the remote console.
 *
 * These types describe the small part of the DSH Host runtime this plugin
 * touches, plus the payloads that cross module boundaries (probe results,
 * media snapshots, notifications, WebSocket frames). They are deliberately
 * structural: DSH services are resolved by name through `ctx.get`, so every
 * consumer validates the shape it needs at runtime.
 */

import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { ForecastMode, QWeatherSettings, WeatherProvider } from './settings.js';

/** Minimal logger sink the Host may expose through `ctx.logger`. */
export interface DshLogger {
  info(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
}

export type DshLoggerFactory = (id: string) => DshLogger;

/** A DSH lifecycle hook handler (`user-questions/request`, `approval/request`). */
export type DshEventHandler = (request: unknown, next: () => Promise<unknown>) => Promise<unknown>;

/** Registration options accepted by the Cordis event bus. */
export interface DshEventListenerOptions {
  /** Run this listener before listeners registered earlier on the same event. */
  prepend?: boolean;
}

/**
 * The subset of the Cordis plugin context this plugin uses. Everything is
 * optional so the service can also run against a minimal composition in tests.
 */
export interface DshContext {
  logger?: DshLoggerFactory | DshLogger;
  get?: (name: string) => unknown;
  on?: (
    event: string,
    handler: DshEventHandler,
    options?: DshEventListenerOptions | boolean,
  ) => (() => void) | void;
  effect?: (fn: () => (() => void) | void, label?: string) => unknown;
}

/** One connected phone/browser as tracked by the WebSocket hub. */
export interface WebSocketClient {
  readonly id: string;
  readonly ip: string;
  readonly userAgent: string;
  readonly label: string;
  readonly connectedAt: number;
  lastSeen: number;
  send(value: unknown): void;
  close(code?: number, reason?: string): void;
}

export interface WebSocketClientInfo {
  id: string;
  label: string;
  ip: string;
  connectedAt: number;
  lastSeen: number;
}

export interface WebSocketAuthorizeDecision {
  ok: boolean;
  status?: number;
}

export interface WebSocketHubOptions {
  server: HttpServer | HttpsServer;
  path?: string;
  authorize?: (req: IncomingMessage, url: URL) => WebSocketAuthorizeDecision | undefined;
  onConnection?: (client: WebSocketClient) => void;
  onMessage?: (client: WebSocketClient, message: unknown) => void;
  onClose?: (client: WebSocketClient) => void;
}

export interface WebSocketHub {
  broadcast(value: unknown, predicate?: ((client: WebSocketClient) => boolean) | null): void;
  closeAll(reason?: string): void;
  close(id: string, reason?: string): void;
  info(): WebSocketClientInfo[];
  size(): number;
  send(client: WebSocketClient, value: unknown): void;
  dispose(): void;
}

/** Loose JSON object used while normalising untrusted payloads. */
export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Raw `dsh-probe media read` payload (already enriched by Rust). */
export interface ProbeMedia extends JsonRecord {
  appId?: string;
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  playbackStatus?: string;
  autoRepeatMode?: string;
  shuffleActive?: boolean;
  position?: number | string | null;
  startTime?: number | string | null;
  endTime?: number | string | null;
  minSeekTime?: number | string | null;
  maxSeekTime?: number | string | null;
  lastUpdatedAt?: number | string | null;
  canPlayPause?: boolean;
  canNext?: boolean;
  canPrevious?: boolean;
  canSeek?: boolean;
  canLike?: boolean;
  canSetLiked?: boolean;
  thumbnail?: string | null;
  thumbnailType?: string | null;
  thumbnailUrl?: string | null;
  liked?: boolean | null;
  trackId?: string | number | null;
  estimatedDuration?: boolean;
  /** `system` (SMTC/MPRIS/MediaRemote), `private` or `accessibility`. */
  provider?: string;
  providerDetail?: string | null;
}

/** Normalised media metadata handed to the browser. */
export interface PublicMedia {
  appId: string;
  /** Display name resolved from the plugin's application mapping. */
  appName: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  playbackStatus: string;
  autoRepeatMode: string;
  shuffleActive: boolean;
  position: number;
  startTime: number;
  endTime: number;
  minSeekTime: number;
  maxSeekTime: number;
  lastUpdatedAt: number | null;
  canPlayPause: boolean;
  canNext: boolean;
  canPrevious: boolean;
  canSeek: boolean;
  /** Which layer supplied the media payload. */
  provider: 'system' | 'private' | 'accessibility';
  providerDetail: string | null;
  thumbnail: string | null;
  thumbnailUrl: string | null;
  thumbnailType: string | null;
  liked: boolean | null;
  canLike: boolean;
  canSetLiked: boolean;
  trackId: string | number | null;
  estimatedDuration: boolean;
  sampledAt: number;
  positionReported?: boolean;
  timelineSource?: 'smtc' | 'private' | 'accessibility' | 'none';
}

/** Raw probe envelope: `{ ok, media, sampledAt }` plus backend-specific extras. */
export interface ProbeMediaResult extends JsonRecord {
  media?: ProbeMedia | null;
  sampledAt?: number | string | null;
  available?: boolean;
}

export interface ProbeVolumeResult extends JsonRecord {
  volume?: number | string | null;
  muted?: boolean;
}

export interface ProbeLocationResult extends JsonRecord {
  latitude?: number | string | null;
  longitude?: number | string | null;
  accuracy?: number | string | null;
  source?: string;
}

/** One OS notification as reported by `dsh-probe notifications`. */
export interface NotificationItem {
  id?: string;
  appKey?: string;
  appName?: string;
  title?: string;
  body?: string;
  avatar?: string | null;
  hasImage?: boolean;
  receivedAt?: number;
  isGroup?: boolean;
  [key: string]: unknown;
}

/** Aggregated per-application notification counts. */
export interface NotificationApp {
  key: string;
  name: string;
  count: number;
  [key: string]: unknown;
}

/** Raw `dsh-probe notifications` snapshot. */
export interface NotificationPayload extends JsonRecord {
  ok?: boolean;
  available?: boolean;
  reason?: string | null;
  source?: string | null;
  liveOnly?: boolean;
  notifications?: NotificationItem[];
  apps?: NotificationApp[];
  updatedAt?: number;
}

/** Browser-facing notification view after app filtering. */
export interface NotificationView {
  available: boolean;
  reason: string | null;
  liveOnly: boolean;
  notifications: NotificationItem[];
  apps: NotificationApp[];
  enabledApps: string[];
  updatedAt: number;
}
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

