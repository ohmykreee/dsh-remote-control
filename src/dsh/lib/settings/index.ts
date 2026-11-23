/** Persistent plugin settings for the remote console. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeTrustedProxies } from '../shared/proxy.js';
import type { JsonRecord } from '../shared/types.js';
import { isRecord } from '../shared/types.js';

const SETTINGS_VERSION = 3;
/**
 * Phone pages in their default order. `custom` is appended last and starts
 * disabled; it embeds a user-provided web page instead of pushing Host data.
 */
const PAGE_KEYS = ['home', 'sessions', 'quickqa', 'music', 'performance', 'custom'] as const;

export type PageKey = (typeof PAGE_KEYS)[number];
export type ThemeSetting = 'dsh' | 'light' | 'dark';
export type DshTheme = 'light' | 'dark';
export type TemperatureUnit = 'celsius' | 'fahrenheit';
export type ForecastMode = 'hourly' | 'daily';
export type SpendWindow = 'calendar' | 'rolling';
export type NavPosition = 'left' | 'right' | 'top' | 'bottom';
/** Plugin language preference: follow DSH, or force one supported language. */
export type LanguageSetting = 'dsh' | 'zh' | 'en';
/** Languages the plugin ships UI translations for. */
export const SUPPORTED_LOCALES = ['zh', 'en'] as const;
export type PluginLocale = (typeof SUPPORTED_LOCALES)[number];
/** DSH locale ids are BCP 47-style tags; anything else is ignored. */
const LOCALE_ID_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;

/**
 * Resolve the console language.
 *
 * An explicit plugin choice wins. Following DSH requires an exact match against
 * the languages this plugin actually translates; a DSH locale such as `ja` or a
 * regional tag without its own bundle falls back to English rather than
 * borrowing an unrelated dictionary.
 */
export function resolveLocale(language: LanguageSetting, dshLocale: string): PluginLocale {
  if (language === 'zh' || language === 'en') return language;
  const requested = String(dshLocale || '').trim().toLowerCase();
  const exact = SUPPORTED_LOCALES.find((id) => id === requested);
  return exact ?? 'en';
}

/** Normalize a DSH locale id pushed by the browser panel. */
export function normalizeDshLocale(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length > 35 || !LOCALE_ID_PATTERN.test(trimmed)) return '';
  return trimmed.toLowerCase();
}

/** Weather data providers, listed in fallback priority order. */
export type WeatherProvider = 'nmc' | 'open-meteo' | 'qweather';
export const WEATHER_PROVIDERS: readonly WeatherProvider[] = ['nmc', 'open-meteo', 'qweather'];

/** QWeather's free plan allows 50,000 calls/month; keep 5% headroom. */
export const QWEATHER_DEFAULT_MONTHLY_LIMIT = 47_500;
/** Largest monthly limit Node.js can represent without unsafe integer math. */
export const QWEATHER_MAX_MONTHLY_LIMIT = Number.MAX_SAFE_INTEGER;
/** QWeather calls used by one weather refresh (current + daily + air + hourly). */
export const QWEATHER_CALLS_PER_REFRESH = 4;
export const QWEATHER_MIN_REFRESH_MINUTES = 5;
export const QWEATHER_MAX_REFRESH_MINUTES = 24 * 60;
export const QWEATHER_DEFAULT_REFRESH_MINUTES = 30;

/**
 * Provider-specific geodata. The display name is shared at the weather level;
 * each provider keeps its own coordinates and location id because the lookup
 * APIs return different identifiers.
 */
export interface WeatherProviderLocation {
  latitude: number | null;
  longitude: number | null;
  /** QWeather Location ID or NMC station code; empty for Open-Meteo. */
  locationId: string;
  timezone: string;
  country: string;
}

/** JWT credentials and quota controls for QWeather. */
export interface QWeatherSettings {
  apiHost: string;
  credentialId: string;
  projectId: string;
  developerId: string;
  privateKey: string;
  monthlyLimit: number;
  refreshMinutes: number;
  /** Read QWeather console finance/stats and reconcile the local call count. */
  syncConsole: boolean;
}

export interface WeatherSettings {
  mode: 'auto' | 'manual';
  name: string;
  forecastMode: ForecastMode;
  provider: WeatherProvider;
  locations: Record<WeatherProvider, WeatherProviderLocation>;
  qweather: QWeatherSettings;
}

/**
 * Smallest refresh interval that keeps a full month of QWeather refreshes under
 * the configured monthly limit. The calculation reserves the maximum number of
 * calls per refresh so it is safe regardless of the display mode.
 */
export function minimumQWeatherRefreshMinutes(monthlyLimit: number): number {
  const limit = Math.max(1, Math.floor(Number(monthlyLimit) || 0));
  const minutesInMonth = 30 * 24 * 60;
  const safe = Math.ceil((minutesInMonth * QWEATHER_CALLS_PER_REFRESH) / limit);
  return Math.min(QWEATHER_MAX_REFRESH_MINUTES, Math.max(QWEATHER_MIN_REFRESH_MINUTES, safe));
}

function emptyProviderLocation(): WeatherProviderLocation {
  return { latitude: null, longitude: null, locationId: '', timezone: '', country: '' };
}

function defaultWeatherSettings(): WeatherSettings {
  return {
    mode: 'auto',
    name: '',
    forecastMode: 'hourly',
    provider: 'open-meteo',
    locations: {
      nmc: emptyProviderLocation(),
      'open-meteo': emptyProviderLocation(),
      qweather: emptyProviderLocation(),
    },
    qweather: {
      apiHost: '',
      credentialId: '',
      projectId: '',
      developerId: '',
      privateKey: '',
      monthlyLimit: QWEATHER_DEFAULT_MONTHLY_LIMIT,
      refreshMinutes: QWEATHER_DEFAULT_REFRESH_MINUTES,
      syncConsole: false,
    },
  };
}

export interface BalanceSettings {
  spendWindow: SpendWindow;
  lowThreshold: number | null;
  /** Show the peak/valley tariff icon on the console balance card. */
  showPeakValley: boolean;
}

export interface NotificationSettings {
  enabledApps: string[];
  limit: number;
  /** Push complete pending questions so the phone can answer them. */
  pushQuestions: boolean;
}

export interface TlsAdvancedSettings {
  /**
   * Keep the phone screen awake while the console page is visible.
   *
   * Stored next to the TLS block for historical reasons only: it is an
   * independent switch and is read as-is, never derived from `tls.enabled`.
   * Whether the browser grants the lock depends on the page being a secure
   * context, which the console cannot decide for it.
   */
  wakeLock: boolean;
}

export interface TlsSettings {
  enabled: boolean;
  certPath: string;
  keyPath: string;
  /**
   * Reverse proxies allowed to report the original client in real-IP headers.
   * The connected-device list reads those headers only for these addresses.
   */
  trustedProxies: string[];
  advanced: TlsAdvancedSettings;
}

/** Browser-side tomato timer configuration; only the console runs the timer. */
export interface PomodoroSettings {
  enabled: boolean;
  /** Focus length in minutes; two decimal places are allowed. */
  focusMinutes: number;
  /** Break length in minutes; two decimal places are allowed. */
  breakMinutes: number;
  soundPath: string;
  /** Keep ringing until the console user explicitly dismisses the alarm. */
  loopAlarm: boolean;
}

/** One reply-model choice used by the Quick Q&A page. */
export interface QuickQaModelSelection {
  provider: string;
  model: string;
  reasoningEffort: string;
}

/** Agent preset and permission preset used for one Quick Q&A workspace. */
export interface QuickQaWorkspaceProfile {
  agentPreset: string;
  permissionPreset: string;
}

/**
 * Quick Q&A configuration. Only the default workspace and the pinned
 * workspaces keep a mode/permission profile; everything else is transient.
 */
export interface QuickQaSettings {
  model: QuickQaModelSelection;
  defaultWorkspaceId: string;
  pinnedWorkspaceIds: string[];
  profiles: Record<string, QuickQaWorkspaceProfile>;
  /** Let the phone attach one image to a question when the model accepts it. */
  allowImages: boolean;
}

/** Browser-side countdown configuration; the console runs the timer itself. */
export interface CountdownSettings {
  enabled: boolean;
  /** QuickQa-select durations in seconds; one to {@link COUNTDOWN_PRESET_LIMIT} entries. */
  presets: number[];
}

/** Upper bound for user-configured countdown presets. */
export const COUNTDOWN_PRESET_LIMIT = 5;
/** Smallest and largest accepted countdown duration, in seconds. */
export const COUNTDOWN_MIN_SECONDS = 1;
export const COUNTDOWN_MAX_SECONDS = 24 * 60 * 60;
/** Smallest and largest accepted pomodoro duration, in minutes. */
export const POMODORO_MIN_MINUTES = 0.1;
export const POMODORO_MAX_FOCUS_MINUTES = 180;
export const POMODORO_MAX_BREAK_MINUTES = 120;
/** Presets a fresh profile starts with; the user may keep one to five. */
export const DEFAULT_COUNTDOWN_PRESETS: readonly number[] = [60, 300, 600];

export interface RemoteControlSettings {
  version: number;
  token: string;
  tokenRotatedAt: number;
  tokenEnabled: boolean;
  allowedInterfaces: string[] | null;
  /** Set after the first startup that found at least one usable interface. */
  interfacesInitialized: boolean;
  theme: ThemeSetting;
  dshTheme: DshTheme;
  /** Plugin UI language: follow DSH or force a shipped language. */
  language: LanguageSetting;
  /** Active DSH locale pushed by the sidebar; empty until the first sync. */
  dshLocale: string;
  temperatureUnit: TemperatureUnit;
  weather: WeatherSettings;
  balance: BalanceSettings;
  notifications: NotificationSettings;
  tls: TlsSettings;
  navPosition: NavPosition;
  pomodoro: PomodoroSettings;
  countdown: CountdownSettings;
  quickqa: QuickQaSettings;
  /** Address embedded by the phone's "custom page"; empty means the page default. */
  customPageUrl: string;
  /** Accent color for the phone console as `#rrggbb`; empty keeps the shipped palette. */
  pageThemeColor: string;
  pageOrder: PageKey[];
  pageEnabled: Record<PageKey, boolean>;
  updatedAt: number;
}

export interface PublicSettings {
  tokenEnabled: boolean;
  tokenRotatedAt: number;
  allowedInterfaces: string[] | null;
  theme: ThemeSetting;
  effectiveTheme: DshTheme;
  language: LanguageSetting;
  /** Resolved console language for the phone page. */
  locale: PluginLocale;
  temperatureUnit: TemperatureUnit;
  weather: WeatherSettings;
  balance: BalanceSettings;
  notifications: NotificationSettings;
  tls: TlsSettings;
  navPosition: NavPosition;
  pomodoro: PomodoroSettings;
  countdown: CountdownSettings;
  quickqa: QuickQaSettings;
  customPageUrl: string;
  /** Accent color for the phone console as `#rrggbb`; empty keeps the shipped palette. */
  pageThemeColor: string;
  pageOrder: PageKey[];
  pageEnabled: Record<PageKey, boolean>;
  updatedAt: number;
}

export interface SettingsStore {
  readonly dir: string;
  readonly file: string;
  get(): RemoteControlSettings;
  public(): PublicSettings;
  update(patch: unknown): RemoteControlSettings;
  save(next: unknown): RemoteControlSettings;
  rotateToken(): RemoteControlSettings;
  setDshTheme(theme: string): RemoteControlSettings;
  setDshLocale(locale: string): RemoteControlSettings;
}

function dataDirectory(): string {
  if (process.env.DSH_PROFILE_DIR) return path.join(process.env.DSH_PROFILE_DIR, 'remote-control');
  if (process.env.DSH_HOME) return path.join(process.env.DSH_HOME, 'remote-control');
  return path.join(os.homedir(), '.dsh', 'remote-control');
}

function token(): string {
  return crypto.randomBytes(24).toString('base64url');
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

export function defaultSettings(): RemoteControlSettings {
  const now = Date.now();
  return {
    version: SETTINGS_VERSION,
    token: token(),
    tokenRotatedAt: now,
    tokenEnabled: true,
    allowedInterfaces: null,
    interfacesInitialized: false,
    theme: 'dsh',
    dshTheme: 'dark',
    language: 'dsh',
    dshLocale: '',
    temperatureUnit: 'celsius',
    weather: defaultWeatherSettings(),
    balance: {
      spendWindow: 'calendar',
      lowThreshold: null,
      showPeakValley: true,
    },
    notifications: {
      enabledApps: [],
      limit: 5,
      pushQuestions: false,
    },
    tls: {
      enabled: false,
      certPath: '',
      keyPath: '',
      trustedProxies: [],
      advanced: {
        wakeLock: false,
      },
    },
    navPosition: 'left',
    pomodoro: {
      enabled: false,
      focusMinutes: 25,
      breakMinutes: 5,
      soundPath: '',
      loopAlarm: false,
    },
    countdown: {
      enabled: false,
      presets: [...DEFAULT_COUNTDOWN_PRESETS],
    },
    quickqa: {
      model: { provider: '', model: '', reasoningEffort: '' },
      defaultWorkspaceId: '',
      pinnedWorkspaceIds: [],
      profiles: {},
      allowImages: false,
    },
    customPageUrl: '',
    pageThemeColor: '',
    pageOrder: ['home', 'sessions', 'quickqa', 'music', 'performance', 'custom'],
    pageEnabled: { home: true, sessions: true, quickqa: true, music: true, performance: true, custom: false },
    updatedAt: now,
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, 100))];
}

function quickqaText(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Normalize Quick Q&A settings. Only the default workspace and the pinned
 * workspaces retain a mode/permission profile; stale profiles for workspaces
 * the user no longer selected are dropped.
 */
function normalizeQuickQaSettings(value: unknown): QuickQaSettings {
  const input: JsonRecord = isRecord(value) ? value : {};
  const modelInput: JsonRecord = isRecord(input.model) ? input.model : {};
  const defaultWorkspaceId = quickqaText(input.defaultWorkspaceId, 300);
  const pinnedWorkspaceIds: string[] = [];
  if (Array.isArray(input.pinnedWorkspaceIds)) {
    for (const entry of input.pinnedWorkspaceIds) {
      const id = quickqaText(entry, 300);
      if (!id || id === defaultWorkspaceId || pinnedWorkspaceIds.includes(id)) continue;
      pinnedWorkspaceIds.push(id);
    }
  }
  const keep = new Set<string>([defaultWorkspaceId, ...pinnedWorkspaceIds]);
  const profilesInput: JsonRecord = isRecord(input.profiles) ? input.profiles : {};
  const profiles: Record<string, QuickQaWorkspaceProfile> = {};
  for (const [id, raw] of Object.entries(profilesInput)) {
    if (!keep.has(id) || !isRecord(raw)) continue;
    profiles[id] = {
      agentPreset: quickqaText(raw.agentPreset, 300),
      permissionPreset: quickqaText(raw.permissionPreset, 300),
    };
  }
  return {
    model: {
      provider: quickqaText(modelInput.provider, 200),
      model: quickqaText(modelInput.model, 300),
      reasoningEffort: quickqaText(modelInput.reasoningEffort, 120),
    },
    defaultWorkspaceId,
    pinnedWorkspaceIds,
    profiles,
    allowImages: input.allowImages === true,
  };
}

/**
 * Keep one to five preset durations, dropping blank/invalid slots so a user
 * who saved two or three presets keeps exactly that many. A missing or fully
 * empty list falls back to the defaults instead of leaving the countdown with
 * nothing to select.
 */
function normalizeCountdownPresets(value: unknown): number[] {
  if (!Array.isArray(value)) return [...DEFAULT_COUNTDOWN_PRESETS];
  const presets: number[] = [];
  for (const entry of value.slice(0, COUNTDOWN_PRESET_LIMIT)) {
    if (entry === null || entry === undefined || entry === '') continue;
    const seconds = Math.round(Number(entry));
    if (!Number.isFinite(seconds)) continue;
    presets.push(Math.max(COUNTDOWN_MIN_SECONDS, Math.min(COUNTDOWN_MAX_SECONDS, seconds)));
  }
  return presets.length > 0 ? presets : [...DEFAULT_COUNTDOWN_PRESETS];
}

/** Round a minute value to two decimals and clamp it to the accepted range. */
function normalizeMinutes(value: unknown, min: number, max: number, fallback: number): number {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return fallback;
  return Math.max(min, Math.min(max, Math.round(minutes * 100) / 100));
}

/** Normalize the shared name plus one provider's geodata. */
function normalizeProviderLocation(
  value: unknown,
  latitudeFallback: number | null,
  longitudeFallback: number | null,
): WeatherProviderLocation {
  const input: JsonRecord = isRecord(value) ? value : {};
  const latitudeInput = input.latitude === undefined || input.latitude === null || input.latitude === ''
    ? latitudeFallback
    : Number(input.latitude);
  const longitudeInput = input.longitude === undefined || input.longitude === null || input.longitude === ''
    ? longitudeFallback
    : Number(input.longitude);
  return {
    latitude: typeof latitudeInput === 'number' && Number.isFinite(latitudeInput) && latitudeInput >= -90 && latitudeInput <= 90
      ? latitudeInput
      : null,
    longitude: typeof longitudeInput === 'number' && Number.isFinite(longitudeInput) && longitudeInput >= -180 && longitudeInput <= 180
      ? longitudeInput
      : null,
    locationId: typeof input.locationId === 'string' ? input.locationId.trim().slice(0, 80) : '',
    timezone: typeof input.timezone === 'string' ? input.timezone.trim().slice(0, 80) : '',
    country: typeof input.country === 'string' ? input.country.trim().slice(0, 80) : '',
  };
}

/** Accept a bare host (or a pasted URL) and drop any path/protocol. */
function normalizeQWeatherHost(value: unknown): string {
  let host = typeof value === 'string' ? value.trim() : '';
  host = host.replace(/^https?:\/\//i, '').replace(/\/.*$/u, '').trim();
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$/iu.test(host)) return '';
  return host.slice(0, 120);
}

/**
 * Normalize the phone's custom-page address. A bare host gets `https://`, only
 * http(s) URLs are kept, and an empty or unusable value means the page falls
 * back to its built-in address.
 */
function normalizeCustomPageUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//iu.exec(raw);
  if (scheme && !/^https?$/iu.test(scheme[1])) return '';
  const candidate = scheme ? raw : `https://${raw.replace(/^\/\//u, '')}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (!url.hostname) return '';
    const href = url.toString();
    return href.length > 2048 ? '' : href;
  } catch {
    return '';
  }
}

/**
 * Normalize the phone console's accent color.
 *
 * Only opaque `#rgb` / `#rrggbb` values are kept. Anything else becomes empty,
 * which tells the phone to keep its shipped palette, so a hand-edited file can
 * never hand the console an unparsable color.
 */
export function normalizePageThemeColor(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return '';
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/u.exec(raw);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[0-9a-f]{6}$/u.test(raw) ? raw : '';
}

function normalizeQWeatherSettings(value: unknown): QWeatherSettings {
  const input: JsonRecord = isRecord(value) ? value : {};
  const limitInput = Number(input.monthlyLimit);
  const monthlyLimit = Number.isFinite(limitInput) && Number.isInteger(limitInput) && limitInput >= 1
    ? Math.min(QWEATHER_MAX_MONTHLY_LIMIT, limitInput)
    : QWEATHER_DEFAULT_MONTHLY_LIMIT;
  const refreshInput = Number(input.refreshMinutes);
  const requestedRefresh = Number.isInteger(refreshInput)
    && refreshInput >= 1
    && refreshInput <= QWEATHER_MAX_REFRESH_MINUTES
    ? refreshInput
    : QWEATHER_DEFAULT_REFRESH_MINUTES;
  return {
    apiHost: normalizeQWeatherHost(input.apiHost),
    credentialId: typeof input.credentialId === 'string' ? input.credentialId.trim().slice(0, 120) : '',
    projectId: typeof input.projectId === 'string' ? input.projectId.trim().slice(0, 120) : '',
    developerId: typeof input.developerId === 'string' ? input.developerId.trim().slice(0, 120) : '',
    privateKey: typeof input.privateKey === 'string' ? input.privateKey.trim().slice(0, 16_384) : '',
    monthlyLimit,
    // The user's interval is kept as entered; a low value only produces a
    // warning in the sidebar and is never raised to the quota-safe minimum.
    refreshMinutes: requestedRefresh,
    syncConsole: input.syncConsole === true,
  };
}

function normalize(raw: unknown): RemoteControlSettings {
  const base = defaultSettings();
  const input: JsonRecord = isRecord(raw) ? raw : {};
  const weather: JsonRecord = isRecord(input.weather) ? input.weather : {};
  const balance: JsonRecord = isRecord(input.balance) ? input.balance : {};
  const notifications: JsonRecord = isRecord(input.notifications) ? input.notifications : {};
  const tls: JsonRecord = isRecord(input.tls) ? input.tls : {};
  const tlsAdvanced: JsonRecord = isRecord(tls.advanced) ? tls.advanced : {};
  const pomodoro: JsonRecord = isRecord(input.pomodoro) ? input.pomodoro : {};
  const countdown: JsonRecord = isRecord(input.countdown) ? input.countdown : {};
  const latitudeInput = weather.latitude;
  const longitudeInput = weather.longitude;
  const latitude = latitudeInput === null || latitudeInput === undefined || latitudeInput === '' ? NaN : Number(latitudeInput);
  const longitude = longitudeInput === null || longitudeInput === undefined || longitudeInput === '' ? NaN : Number(longitudeInput);
  const mode = weather.mode === 'manual' ? 'manual' : 'auto';
  const zeroPair = latitude === 0 && longitude === 0;
  const validLatitude = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 ? latitude : null;
  const validLongitude = Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 ? longitude : null;
  const normalizedLatitude = mode === 'auto' && zeroPair ? null : validLatitude;
  const normalizedLongitude = mode === 'auto' && zeroPair ? null : validLongitude;
  const providerInput = weather.provider;
  const provider: WeatherProvider = oneOf(providerInput, WEATHER_PROVIDERS) ? providerInput : 'open-meteo';
  const locationsInput: JsonRecord = isRecord(weather.locations) ? weather.locations : {};
  const locations = Object.fromEntries(
    WEATHER_PROVIDERS.map((id) => [
      id,
      normalizeProviderLocation(locationsInput[id], normalizedLatitude, normalizedLongitude),
    ]),
  ) as Record<WeatherProvider, WeatherProviderLocation>;
  const lowThreshold = Number(balance.lowThreshold);
  const themeInput = input.theme;
  const dshThemeInput = input.dshTheme;
  const theme: ThemeSetting = oneOf(themeInput, ['dsh', 'light', 'dark'] as const) ? themeInput : 'dsh';
  const dshTheme: DshTheme = oneOf(dshThemeInput, ['light', 'dark'] as const) ? dshThemeInput : 'dark';
  const languageInput = input.language;
  const language: LanguageSetting = oneOf(languageInput, ['dsh', 'zh', 'en'] as const) ? languageInput : 'dsh';
  const navPositionInput = input.navPosition;
  const navPosition: NavPosition = oneOf(navPositionInput, ['left', 'right', 'top', 'bottom'] as const)
    ? navPositionInput
    : 'left';
  const pomodoroSettings: PomodoroSettings = {
    enabled: pomodoro.enabled === true,
    focusMinutes: normalizeMinutes(pomodoro.focusMinutes, POMODORO_MIN_MINUTES, POMODORO_MAX_FOCUS_MINUTES, 25),
    breakMinutes: normalizeMinutes(pomodoro.breakMinutes, POMODORO_MIN_MINUTES, POMODORO_MAX_BREAK_MINUTES, 5),
    soundPath: typeof pomodoro.soundPath === 'string' ? pomodoro.soundPath.slice(0, 2048) : '',
    loopAlarm: pomodoro.loopAlarm === true,
  };
  const countdownSettings: CountdownSettings = {
    enabled: countdown.enabled === true,
    presets: normalizeCountdownPresets(countdown.presets),
  };
  // Only one timer may be enabled; a hand-edited file that turns both on keeps
  // the pomodoro so existing profiles never change behavior silently.
  if (pomodoroSettings.enabled) countdownSettings.enabled = false;
  const requestedOrder = Array.isArray(input.pageOrder)
    ? input.pageOrder.filter((key): key is PageKey => typeof key === 'string' && (PAGE_KEYS as readonly string[]).includes(key))
    : [];
  const pageOrder: PageKey[] = [...new Set(requestedOrder)];
  for (const key of PAGE_KEYS) if (!pageOrder.includes(key)) pageOrder.push(key);
  const normalizedOrder = pageOrder.slice(0, PAGE_KEYS.length);
  const pageEnabledInput: JsonRecord = isRecord(input.pageEnabled) ? input.pageEnabled : {};
  // Every page is on by default except the custom page, which stays hidden
  // until the user explicitly enables it.
  const pageEnabled = Object.fromEntries(
    PAGE_KEYS.map((key) => [key, key === 'custom' ? pageEnabledInput[key] === true : pageEnabledInput[key] !== false]),
  ) as Record<PageKey, boolean>;
  if (!Object.values(pageEnabled).some(Boolean)) pageEnabled.home = true;

  return {
    version: SETTINGS_VERSION,
    token: typeof input.token === 'string' && input.token.length >= 16 ? input.token : base.token,
    tokenRotatedAt: Number.isFinite(Number(input.tokenRotatedAt)) ? Number(input.tokenRotatedAt) : base.tokenRotatedAt,
    tokenEnabled: input.tokenEnabled !== false,
    allowedInterfaces: input.allowedInterfaces === null ? null : normalizeStringArray(input.allowedInterfaces),
    interfacesInitialized: input.interfacesInitialized === true,
    theme,
    dshTheme,
    language,
    dshLocale: normalizeDshLocale(input.dshLocale),
    temperatureUnit: input.temperatureUnit === 'fahrenheit' ? 'fahrenheit' : 'celsius',
    weather: {
      mode,
      name: typeof weather.name === 'string' ? weather.name.slice(0, 80) : '',
      forecastMode: weather.forecastMode === 'daily' ? 'daily' : 'hourly',
      provider,
      locations,
      qweather: normalizeQWeatherSettings(weather.qweather),
    },
    balance: {
      spendWindow: balance.spendWindow === 'rolling' ? 'rolling' : 'calendar',
      lowThreshold:
        balance.lowThreshold === null || balance.lowThreshold === ''
          ? null
          : Number.isFinite(lowThreshold) && lowThreshold >= 0
            ? lowThreshold
            : null,
      showPeakValley: balance.showPeakValley !== false,
    },
    notifications: {
      enabledApps: normalizeStringArray(notifications.enabledApps),
      limit: Math.max(1, Math.min(20, Number.isFinite(Number(notifications.limit)) ? Math.round(Number(notifications.limit)) : 5)),
      pushQuestions: notifications.pushQuestions === true,
    },
    tls: {
      enabled: tls.enabled === true,
      certPath: typeof tls.certPath === 'string' ? tls.certPath.slice(0, 4096) : '',
      keyPath: typeof tls.keyPath === 'string' ? tls.keyPath.slice(0, 4096) : '',
      trustedProxies: normalizeTrustedProxies(tls.trustedProxies),
      advanced: {
        wakeLock: tlsAdvanced.wakeLock === true,
      },
    },
    navPosition,
    pomodoro: pomodoroSettings,
    countdown: countdownSettings,
    quickqa: normalizeQuickQaSettings(input.quickqa),
    customPageUrl: normalizeCustomPageUrl(input.customPageUrl),
    pageThemeColor: normalizePageThemeColor(input.pageThemeColor),
    pageOrder: normalizedOrder,
    pageEnabled,
    updatedAt: Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : Date.now(),
  };
}

export function createSettingsStore(): SettingsStore {
  const dir = dataDirectory();
  const file = path.join(dir, 'settings.json');
  fs.mkdirSync(dir, { recursive: true });

  let current: RemoteControlSettings;
  try {
    current = normalize(JSON.parse(fs.readFileSync(file, 'utf8')) as unknown);
  } catch {
    current = defaultSettings();
  }
  fs.writeFileSync(file, JSON.stringify(current, null, 2), 'utf8');

  function save(next: unknown): RemoteControlSettings {
    current = normalize({ ...(isRecord(next) ? next : {}), updatedAt: Date.now() });
    const temporary = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, JSON.stringify(current, null, 2), 'utf8');
    fs.renameSync(temporary, file);
    return current;
  }

  function update(patch: unknown): RemoteControlSettings {
    const source: JsonRecord = isRecord(patch) ? patch : {};
    const weatherPatch: JsonRecord = isRecord(source.weather) ? source.weather : {};
    const locationPatch: JsonRecord = isRecord(weatherPatch.locations) ? weatherPatch.locations : {};
    const locations = { ...current.weather.locations };
    for (const id of WEATHER_PROVIDERS) {
      const entry = locationPatch[id];
      if (isRecord(entry)) locations[id] = { ...locations[id], ...entry };
    }
    const next: JsonRecord = {
      ...current,
      ...source,
      weather: {
        ...current.weather,
        ...weatherPatch,
        locations,
        qweather: {
          ...current.weather.qweather,
          ...(isRecord(weatherPatch.qweather) ? weatherPatch.qweather : {}),
        },
      },
      balance: { ...current.balance, ...(isRecord(source.balance) ? source.balance : {}) },
      notifications: {
        ...current.notifications,
        ...(isRecord(source.notifications) ? source.notifications : {}),
      },
      tls: {
        ...current.tls,
        ...(isRecord(source.tls) ? source.tls : {}),
        advanced: {
          ...current.tls.advanced,
          ...(isRecord(source.tls) && isRecord(source.tls.advanced) ? source.tls.advanced : {}),
        },
      },
      pomodoro: { ...current.pomodoro, ...(isRecord(source.pomodoro) ? source.pomodoro : {}) },
      countdown: { ...current.countdown, ...(isRecord(source.countdown) ? source.countdown : {}) },
      quickqa: {
        ...current.quickqa,
        ...(isRecord(source.quickqa) ? source.quickqa : {}),
        model: {
          ...current.quickqa.model,
          ...(isRecord(source.quickqa) && isRecord(source.quickqa.model) ? source.quickqa.model : {}),
        },
        pinnedWorkspaceIds: isRecord(source.quickqa) && Array.isArray(source.quickqa.pinnedWorkspaceIds)
          ? source.quickqa.pinnedWorkspaceIds
          : current.quickqa.pinnedWorkspaceIds,
        profiles: isRecord(source.quickqa) && isRecord(source.quickqa.profiles)
          ? source.quickqa.profiles
          : current.quickqa.profiles,
      },
    };
    // Respect whichever timer the patch turns on, even when the caller sends
    // only one side of the pair; normalize() is the final authority.
    const pomodoroPatch = isRecord(source.pomodoro) ? source.pomodoro : {};
    const countdownPatch = isRecord(source.countdown) ? source.countdown : {};
    if (pomodoroPatch.enabled === true && countdownPatch.enabled !== true) {
      next.countdown = { ...(isRecord(next.countdown) ? next.countdown : {}), enabled: false };
    } else if (countdownPatch.enabled === true && pomodoroPatch.enabled !== true) {
      next.pomodoro = { ...(isRecord(next.pomodoro) ? next.pomodoro : {}), enabled: false };
    }
    return save(next);
  }

  function rotateToken(): RemoteControlSettings {
    return save({ ...current, token: token(), tokenRotatedAt: Date.now() });
  }

  function setDshTheme(theme: string): RemoteControlSettings {
    if (theme !== 'light' && theme !== 'dark') return current;
    if (current.dshTheme === theme) return current;
    return save({ ...current, dshTheme: theme });
  }

  function setDshLocale(locale: string): RemoteControlSettings {
    const next = normalizeDshLocale(locale);
    if (!next || current.dshLocale === next) return current;
    return save({ ...current, dshLocale: next });
  }

  function publicSettings(): PublicSettings {
    return {
      tokenEnabled: current.tokenEnabled,
      tokenRotatedAt: current.tokenRotatedAt,
      allowedInterfaces: current.allowedInterfaces,
      theme: current.theme,
      effectiveTheme: current.theme === 'dsh' ? current.dshTheme : current.theme,
      language: current.language,
      locale: resolveLocale(current.language, current.dshLocale),
      temperatureUnit: current.temperatureUnit,
      weather: {
        ...current.weather,
        locations: {
          nmc: { ...current.weather.locations.nmc },
          'open-meteo': { ...current.weather.locations['open-meteo'] },
          qweather: { ...current.weather.locations.qweather },
        },
        qweather: { ...current.weather.qweather },
      },
      balance: { ...current.balance },
      notifications: { ...current.notifications, enabledApps: [...current.notifications.enabledApps] },
      tls: {
        ...current.tls,
        trustedProxies: [...current.tls.trustedProxies],
        advanced: { ...current.tls.advanced },
      },
      navPosition: current.navPosition,
      pomodoro: { ...current.pomodoro },
      countdown: { ...current.countdown, presets: [...current.countdown.presets] },
      quickqa: {
        model: { ...current.quickqa.model },
        defaultWorkspaceId: current.quickqa.defaultWorkspaceId,
        pinnedWorkspaceIds: [...current.quickqa.pinnedWorkspaceIds],
        profiles: Object.fromEntries(
          Object.entries(current.quickqa.profiles).map(([id, profile]) => [id, { ...profile }]),
        ),
        allowImages: current.quickqa.allowImages,
      },
      customPageUrl: current.customPageUrl,
      pageThemeColor: current.pageThemeColor,
      pageOrder: [...current.pageOrder],
      pageEnabled: { ...current.pageEnabled },
      updatedAt: current.updatedAt,
    };
  }

  return {
    dir,
    file,
    get: () => current,
    public: publicSettings,
    update,
    save,
    rotateToken,
    setDshTheme,
    setDshLocale,
  };
}
