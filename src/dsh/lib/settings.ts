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
}

export interface TlsSettings {
  enabled: boolean;
  certPath: string;
  keyPath: string;
}

/** Browser-side tomato timer configuration; only the console runs the timer. */
export interface PomodoroSettings {
  enabled: boolean;
  focusMinutes: number;
  breakMinutes: number;
  soundPath: string;
  /** Keep ringing until the console user explicitly dismisses the alarm. */
  loopAlarm: boolean;
}

export interface RemoteControlSettings {
  version: number;
  token: string;
  tokenRotatedAt: number;
  tokenEnabled: boolean;
  allowedInterfaces: string[] | null;
  theme: ThemeSetting;
  dshTheme: DshTheme;
  temperatureUnit: TemperatureUnit;
  weather: WeatherSettings;
  balance: BalanceSettings;
  notifications: NotificationSettings;
  tls: TlsSettings;
  navPosition: NavPosition;
  pomodoro: PomodoroSettings;
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
  temperatureUnit: TemperatureUnit;
  weather: WeatherSettings;
  balance: BalanceSettings;
  notifications: NotificationSettings;
  tls: TlsSettings;
  navPosition: NavPosition;
  pomodoro: PomodoroSettings;
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
    pageOrder: ['home', 'sessions', 'music', 'performance'],
    pageEnabled: { home: true, sessions: true, music: true, performance: true },
    updatedAt: now,
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, 100))];
}

function normalize(raw: unknown): RemoteControlSettings {
  const base = defaultSettings();
  const input: JsonRecord = isRecord(raw) ? raw : {};
  const weather: JsonRecord = isRecord(input.weather) ? input.weather : {};
  const balance: JsonRecord = isRecord(input.balance) ? input.balance : {};
  const notifications: JsonRecord = isRecord(input.notifications) ? input.notifications : {};
  const tls: JsonRecord = isRecord(input.tls) ? input.tls : {};
  const pomodoro: JsonRecord = isRecord(input.pomodoro) ? input.pomodoro : {};
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
  const navPositionInput = input.navPosition;
  const navPosition: NavPosition = oneOf(navPositionInput, ['left', 'right', 'top', 'bottom'] as const)
    ? navPositionInput
    : 'left';
  const focusMinutes = Math.round(Number(pomodoro.focusMinutes));
  const breakMinutes = Math.round(Number(pomodoro.breakMinutes));
  const pomodoroSettings: PomodoroSettings = {
    enabled: pomodoro.enabled === true,
    focusMinutes: Number.isFinite(focusMinutes) ? Math.max(1, Math.min(180, focusMinutes)) : 25,
    breakMinutes: Number.isFinite(breakMinutes) ? Math.max(1, Math.min(120, breakMinutes)) : 5,
    soundPath: typeof pomodoro.soundPath === 'string' ? pomodoro.soundPath.slice(0, 2048) : '',
    loopAlarm: pomodoro.loopAlarm === true,
  };
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
    },
    tls: {
      enabled: tls.enabled === true,
      certPath: typeof tls.certPath === 'string' ? tls.certPath.slice(0, 4096) : '',
      keyPath: typeof tls.keyPath === 'string' ? tls.keyPath.slice(0, 4096) : '',
    },
    navPosition,
    pomodoro: pomodoroSettings,
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
    };
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

  function publicSettings(): PublicSettings {
    return {
      tokenEnabled: current.tokenEnabled,
      tokenRotatedAt: current.tokenRotatedAt,
      allowedInterfaces: current.allowedInterfaces,
      theme: current.theme,
      effectiveTheme: current.theme === 'dsh' ? current.dshTheme : current.theme,
      temperatureUnit: current.temperatureUnit,
      weather: { ...current.weather },
      balance: { ...current.balance },
      notifications: { ...current.notifications, enabledApps: [...current.notifications.enabledApps] },
      tls: { ...current.tls },
      navPosition: current.navPosition,
      pomodoro: { ...current.pomodoro },
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
  };
}
