/** Persistent plugin settings for the remote console. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { JsonRecord } from './types.js';
import { isRecord } from './types.js';

const SETTINGS_VERSION = 1;
const PAGE_KEYS = ['home', 'sessions', 'music', 'performance'] as const;

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

export interface WeatherSettings {
  mode: 'auto' | 'manual';
  name: string;
  latitude: number | null;
  longitude: number | null;
  forecastMode: ForecastMode;
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

export interface TlsSettings {
  enabled: boolean;
  certPath: string;
  keyPath: string;
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

/** Browser-side countdown configuration; the console runs the timer itself. */
export interface CountdownSettings {
  enabled: boolean;
  /** Quick-select durations in seconds; one to {@link COUNTDOWN_PRESET_LIMIT} entries. */
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
    theme: 'dsh',
    dshTheme: 'dark',
    language: 'dsh',
    dshLocale: '',
    temperatureUnit: 'celsius',
    weather: {
      mode: 'auto',
      name: '',
      latitude: null,
      longitude: null,
      forecastMode: 'hourly',
    },
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
    pageOrder: ['home', 'sessions', 'music', 'performance'],
    pageEnabled: { home: true, sessions: true, music: true, performance: true },
    updatedAt: now,
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, 100))];
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

function normalize(raw: unknown): RemoteControlSettings {
  const base = defaultSettings();
  const input: JsonRecord = isRecord(raw) ? raw : {};
  const weather: JsonRecord = isRecord(input.weather) ? input.weather : {};
  const balance: JsonRecord = isRecord(input.balance) ? input.balance : {};
  const notifications: JsonRecord = isRecord(input.notifications) ? input.notifications : {};
  const tls: JsonRecord = isRecord(input.tls) ? input.tls : {};
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
  const pageEnabled = Object.fromEntries(PAGE_KEYS.map((key) => [key, pageEnabledInput[key] !== false])) as Record<
    PageKey,
    boolean
  >;
  if (!Object.values(pageEnabled).some(Boolean)) pageEnabled.home = true;

  return {
    version: SETTINGS_VERSION,
    token: typeof input.token === 'string' && input.token.length >= 16 ? input.token : base.token,
    tokenRotatedAt: Number.isFinite(Number(input.tokenRotatedAt)) ? Number(input.tokenRotatedAt) : base.tokenRotatedAt,
    tokenEnabled: input.tokenEnabled !== false,
    allowedInterfaces: input.allowedInterfaces === null ? null : normalizeStringArray(input.allowedInterfaces),
    theme,
    dshTheme,
    language,
    dshLocale: normalizeDshLocale(input.dshLocale),
    temperatureUnit: input.temperatureUnit === 'fahrenheit' ? 'fahrenheit' : 'celsius',
    weather: {
      mode,
      name: typeof weather.name === 'string' ? weather.name.slice(0, 80) : '',
      latitude: normalizedLatitude,
      longitude: normalizedLongitude,
      forecastMode: weather.forecastMode === 'daily' ? 'daily' : 'hourly',
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
    },
    navPosition,
    pomodoro: pomodoroSettings,
    countdown: countdownSettings,
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
    const next: JsonRecord = {
      ...current,
      ...source,
      weather: { ...current.weather, ...(isRecord(source.weather) ? source.weather : {}) },
      balance: { ...current.balance, ...(isRecord(source.balance) ? source.balance : {}) },
      notifications: {
        ...current.notifications,
        ...(isRecord(source.notifications) ? source.notifications : {}),
      },
      tls: { ...current.tls, ...(isRecord(source.tls) ? source.tls : {}) },
      pomodoro: { ...current.pomodoro, ...(isRecord(source.pomodoro) ? source.pomodoro : {}) },
      countdown: { ...current.countdown, ...(isRecord(source.countdown) ? source.countdown : {}) },
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
      weather: { ...current.weather },
      balance: { ...current.balance },
      notifications: { ...current.notifications, enabledApps: [...current.notifications.enabledApps] },
      tls: { ...current.tls },
      navPosition: current.navPosition,
      pomodoro: { ...current.pomodoro },
      countdown: { ...current.countdown, presets: [...current.countdown.presets] },
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
