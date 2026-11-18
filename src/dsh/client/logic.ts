/** Pure state helpers shared by the panel and its section renderers. */

import type {
  CountdownPresetDraft,
  DraftState,
  LocationResult,
  ProviderLocationSettings,
  RemoteApp,
  RemoteSettings,
  SavePatch,
  SettingsPayload,
  StagedSettings,
  Translator,
  WeatherProviderId,
  WeatherSettings,
} from './types.js';
import { isRecord } from './api.js';

export const PAGE_ORDER: string[] = ['home', 'sessions', 'music', 'performance'];

/** Provider order used by the settings list and the quota fallback priority. */
export const WEATHER_PROVIDERS: WeatherProviderId[] = ['nmc', 'open-meteo', 'qweather'];

/** QWeather calls used by one refresh; mirrors the Host's quota estimate. */
export const QWEATHER_CALLS_PER_REFRESH = 4;
export const QWEATHER_DEFAULT_MONTHLY_LIMIT = 47_500;
export const QWEATHER_DEFAULT_REFRESH_MINUTES = 30;
export const QWEATHER_MIN_REFRESH_MINUTES = 5;
export const QWEATHER_MAX_REFRESH_MINUTES = 24 * 60;

export function normalizeWeatherProvider(value: unknown): WeatherProviderId {
  return value === 'nmc' || value === 'qweather' ? value : 'open-meteo';
}

export function weatherProviderLabel(t: Translator, provider: string | undefined): string {
  if (provider === 'nmc') return t('providerNmc');
  if (provider === 'qweather') return t('providerQweather');
  return t('providerOpenMeteo');
}

export function minimumQWeatherRefreshMinutes(monthlyLimit: number): number {
  const limit = Math.max(1, Math.floor(Number(monthlyLimit) || 0));
  const safe = Math.ceil((30 * 24 * 60 * QWEATHER_CALLS_PER_REFRESH) / limit);
  return Math.min(QWEATHER_MAX_REFRESH_MINUTES, Math.max(QWEATHER_MIN_REFRESH_MINUTES, safe));
}

export function estimatedMonthlyCalls(refreshMinutes: number): number {
  const minutes = Math.max(QWEATHER_MIN_REFRESH_MINUTES, Number(refreshMinutes) || QWEATHER_DEFAULT_REFRESH_MINUTES);
  return Math.round((30 * 24 * 60 * QWEATHER_CALLS_PER_REFRESH) / minutes);
}

/** Upper bound for user-configured countdown presets. */
export const COUNTDOWN_PRESET_LIMIT = 5;
/** Smallest and largest accepted countdown duration, in seconds. */
export const COUNTDOWN_MIN_SECONDS = 1;
export const COUNTDOWN_MAX_SECONDS = 86_400;
/** Presets a fresh profile starts with; the user may keep one to five. */
export const DEFAULT_COUNTDOWN_PRESETS: number[] = [60, 300, 600];

/** Pomodoro duration bounds, mirrored from the Host normalizer for the UI. */
export const POMODORO_MIN_MINUTES = 0.1;
export const POMODORO_MAX_FOCUS_MINUTES = 180;
export const POMODORO_MAX_BREAK_MINUTES = 120;

export const EMPTY_DRAFT: DraftState = {
  certPath: '',
  keyPath: '',
  qweatherApiHost: '',
  qweatherCredentialId: '',
  qweatherProjectId: '',
  qweatherDeveloperId: '',
  qweatherPrivateKey: '',
  qweatherMonthlyLimit: '47500',
  qweatherRefreshMinutes: '30',
  qweatherSyncConsole: false,
  threshold: '',
  notificationLimit: '5',
  pomodoroFocus: '25',
  pomodoroBreak: '5',
  pomodoroSound: '',
  countdownPresets: createCountdownDraft(DEFAULT_COUNTDOWN_PRESETS),
};

/** Parse one countdown preset input; null means the slot is not configured. */
export function parseCountdownPreset(value: unknown, fallback: number | null = null): number | null {
  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === '' || raw === null || raw === undefined) return fallback;
  const seconds = Math.round(Number(raw));
  if (!Number.isFinite(seconds)) return fallback;
  return Math.max(COUNTDOWN_MIN_SECONDS, Math.min(COUNTDOWN_MAX_SECONDS, seconds));
}

function isPresetDraft(value: unknown): value is CountdownPresetDraft {
  return isRecord(value) && typeof value.minutes === 'string' && typeof value.seconds === 'string';
}

/** Parse one minute/second preset row; null means the row is empty. */
export function presetDraftToSeconds(preset: CountdownPresetDraft): number | null {
  const minutesText = preset.minutes.trim();
  const secondsText = preset.seconds.trim();
  if (minutesText === '' && secondsText === '') return null;
  const minutes = Number(minutesText || 0);
  const seconds = Number(secondsText || 0);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  const total = Math.round(minutes * 60 + seconds);
  return Math.max(COUNTDOWN_MIN_SECONDS, Math.min(COUNTDOWN_MAX_SECONDS, total));
}

/**
 * Keep a minute field to digits with at most two decimal places. The raw text
 * is preserved otherwise, so "2", "2.5" and "2.55" all keep their own shape.
 */
export function sanitizeMinuteInput(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot < 0) return cleaned;
  const whole = cleaned.slice(0, dot);
  const fraction = cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2);
  return `${whole}.${fraction}`;
}

/**
 * Clamp a minute field on blur. In-range text stays exactly as typed; anything
 * outside the bounds (or unparsable) is capped to the nearest limit.
 */
export function capMinuteInput(value: string, min: number, max: number): string {
  const text = value.trim();
  if (text === '') return '';
  const minutes = Number(text);
  if (!Number.isFinite(minutes)) return '';
  if (minutes >= min && minutes <= max) return value;
  return String(Math.max(min, Math.min(max, minutes)));
}

/**
 * Clamp one countdown preset row on blur: total seconds are capped to the
 * supported range and whole minutes are carried out of the seconds field.
 */
export function capPresetDraft(preset: CountdownPresetDraft): CountdownPresetDraft {
  const minutesText = preset.minutes.trim();
  const secondsText = preset.seconds.trim();
  if (minutesText === '' && secondsText === '') return preset;
  const minutes = Number(minutesText || 0);
  const seconds = Number(secondsText || 0);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return preset;
  const total = Math.round(minutes * 60 + seconds);
  const capped = Math.max(COUNTDOWN_MIN_SECONDS, Math.min(COUNTDOWN_MAX_SECONDS, total));
  return { minutes: String(Math.floor(capped / 60)), seconds: String(capped % 60) };
}

/**
 * Normalize a preset list to one to five durations. Blank or invalid slots are
 * dropped so a two- or three-preset configuration stays exactly that long.
 * Entries may be raw seconds from settings or minute/second drafts from the UI.
 */
export function normalizeCountdownPresets(value: unknown): number[] {
  const input: unknown[] = Array.isArray(value) ? value : [];
  const presets: number[] = [];
  for (const entry of input.slice(0, COUNTDOWN_PRESET_LIMIT)) {
    const seconds = isPresetDraft(entry) ? presetDraftToSeconds(entry) : parseCountdownPreset(entry);
    if (seconds !== null) presets.push(seconds);
  }
  return presets.length > 0 ? presets : [...DEFAULT_COUNTDOWN_PRESETS];
}

/** Editable minute/second rows for the countdown preset list. */
export function createCountdownDraft(value: unknown): CountdownPresetDraft[] {
  return normalizeCountdownPresets(value).map((seconds) => ({
    minutes: String(Math.floor(seconds / 60)),
    seconds: String(seconds % 60),
  }));
}

/** Fill missing page keys and drop duplicates/unknown values. */
export function normalizePageOrder(input: unknown): string[] {
  const values: unknown[] = Array.isArray(input) ? input : [];
  const keys = values.filter((key): key is string => typeof key === 'string' && PAGE_ORDER.includes(key));
  const order = [...new Set(keys)];
  for (const key of PAGE_ORDER) if (!order.includes(key)) order.push(key);
  return order.slice(0, PAGE_ORDER.length);
}

export function pageLabels(t: Translator): Record<string, string> {
  return {
    home: t('pageHome'),
    sessions: t('pageSessions'),
    music: t('pageMusic'),
    performance: t('pagePerformance'),
  };
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/** Build the editable text-field state from the current settings document. */
export function createDraft(settings: RemoteSettings): DraftState {
  return {
    certPath: settings.tls?.certPath ?? '',
    keyPath: settings.tls?.keyPath ?? '',
    qweatherApiHost: settings.weather?.qweather?.apiHost ?? '',
    qweatherCredentialId: settings.weather?.qweather?.credentialId ?? '',
    qweatherProjectId: settings.weather?.qweather?.projectId ?? '',
    qweatherDeveloperId: settings.weather?.qweather?.developerId ?? '',
    qweatherPrivateKey: settings.weather?.qweather?.privateKey ?? '',
    qweatherMonthlyLimit: String(settings.weather?.qweather?.monthlyLimit ?? QWEATHER_DEFAULT_MONTHLY_LIMIT),
    qweatherRefreshMinutes: String(settings.weather?.qweather?.refreshMinutes ?? QWEATHER_DEFAULT_REFRESH_MINUTES),
    qweatherSyncConsole: settings.weather?.qweather?.syncConsole === true,
    threshold: text(settings.balance?.lowThreshold),
    notificationLimit: String(settings.notifications?.limit ?? 5),
    pomodoroFocus: String(settings.pomodoro?.focusMinutes ?? 25),
    pomodoroBreak: String(settings.pomodoro?.breakMinutes ?? 5),
    pomodoroSound: settings.pomodoro?.soundPath ?? '',
    countdownPresets: createCountdownDraft(settings.countdown?.presets),
  };
}

/** Merge a staged patch into the previous one without mutating either. */
export function mergeStaged(current: StagedSettings, patch: StagedSettings): StagedSettings {
  const merge = (left: unknown, right: unknown): unknown => {
    const next: Record<string, unknown> = { ...(isRecord(left) ? left : {}) };
    for (const [key, value] of Object.entries(isRecord(right) ? right : {})) {
      if (value && typeof value === 'object' && !Array.isArray(value)) next[key] = merge(next[key], value);
      else next[key] = value;
    }
    return next;
  };
  return merge(current, patch) as StagedSettings;
}

function mergeWeatherSettings(
  base: WeatherSettings | undefined,
  staged: WeatherSettings | undefined,
): WeatherSettings {
  const merged: WeatherSettings = { ...(base ?? {}), ...(staged ?? {}) };
  const locations: Partial<Record<WeatherProviderId, ProviderLocationSettings>> = {};
  for (const id of WEATHER_PROVIDERS) {
    const baseLocation = base?.locations?.[id];
    const stagedLocation = staged?.locations?.[id];
    if (baseLocation || stagedLocation) {
      locations[id] = { ...(baseLocation ?? {}), ...(stagedLocation ?? {}) };
    }
  }
  merged.locations = locations;
  merged.qweather = { ...(base?.qweather ?? {}), ...(staged?.qweather ?? {}) };
  return merged;
}

/** Layer staged edits over the Host settings document for rendering. */
export function buildSettingsView(base: RemoteSettings, staged: StagedSettings): RemoteSettings {
  return {
    ...base,
    ...staged,
    weather: mergeWeatherSettings(base.weather, staged.weather),
    balance: { ...(base.balance ?? {}), ...(staged.balance ?? {}) },
    notifications: { ...(base.notifications ?? {}), ...(staged.notifications ?? {}) },
    tls: {
      ...(base.tls ?? {}),
      ...(staged.tls ?? {}),
      advanced: { ...(base.tls?.advanced ?? {}), ...(staged.tls?.advanced ?? {}) },
    },
    pomodoro: { ...(base.pomodoro ?? {}), ...(staged.pomodoro ?? {}) },
    countdown: { ...(base.countdown ?? {}), ...(staged.countdown ?? {}) },
    pageEnabled: { ...(base.pageEnabled ?? {}), ...(staged.pageEnabled ?? {}) },
  };
}

export interface SavePatchInput {
  data: SettingsPayload;
  settings: RemoteSettings;
  draft: DraftState;
  selectedInterfaces: string[];
  selectedApps: string[];
  notificationApps: RemoteApp[];
  order: string[];
}

/** Minutes are posted as typed; empty or invalid fields keep their default. */
function minutesOr(value: string, fallback: number): number {
  const text = value.trim();
  if (text === '') return fallback;
  const minutes = Number(text);
  return Number.isFinite(minutes) ? minutes : fallback;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeLocationSettings(
  value: WeatherSettings['locations'],
): Partial<Record<WeatherProviderId, ProviderLocationSettings>> {
  const output: Partial<Record<WeatherProviderId, ProviderLocationSettings>> = {};
  for (const id of WEATHER_PROVIDERS) {
    const entry = value?.[id];
    if (!entry) continue;
    output[id] = {
      latitude: numberOrNull(entry.latitude),
      longitude: numberOrNull(entry.longitude),
      locationId: typeof entry.locationId === 'string' ? entry.locationId : '',
      timezone: typeof entry.timezone === 'string' ? entry.timezone : '',
      country: typeof entry.country === 'string' ? entry.country : '',
    };
  }
  return output;
}

/** Build the single batch body posted by "save settings". */
export function buildSavePatch(input: SavePatchInput): SavePatch {
  const { data, settings, draft, selectedInterfaces, selectedApps, notificationApps, order } = input;
  const allInterfaces = [...new Set((data.interfaces ?? []).map((entry) => entry.name))];
  const weatherProvider = normalizeWeatherProvider(settings.weather?.provider);
  const nextWeather: WeatherSettings = {
    mode: settings.weather?.mode === 'manual' ? 'manual' : 'auto',
    name: settings.weather?.name ?? '',
    // NMC only publishes a 7-day forecast; keep the saved mode consistent with
    // the disabled control shown in the settings page.
    forecastMode: weatherProvider === 'nmc'
      ? 'daily'
      : settings.weather?.forecastMode === 'daily' ? 'daily' : 'hourly',
    provider: weatherProvider,
    locations: normalizeLocationSettings(settings.weather?.locations),
    qweather: {
      apiHost: draft.qweatherApiHost.trim(),
      credentialId: draft.qweatherCredentialId.trim(),
      projectId: draft.qweatherProjectId.trim(),
      developerId: draft.qweatherDeveloperId.trim(),
      privateKey: draft.qweatherPrivateKey.trim(),
      monthlyLimit: numberOrNull(draft.qweatherMonthlyLimit) ?? QWEATHER_DEFAULT_MONTHLY_LIMIT,
      refreshMinutes: numberOrNull(draft.qweatherRefreshMinutes) ?? QWEATHER_DEFAULT_REFRESH_MINUTES,
      syncConsole: draft.qweatherSyncConsole === true,
    },
  };
  return {
    allowedInterfaces: selectedInterfaces.length === allInterfaces.length ? null : selectedInterfaces,
    tokenEnabled: settings.tokenEnabled,
    temperatureUnit: settings.temperatureUnit === 'fahrenheit' ? 'fahrenheit' : 'celsius',
    theme: settings.theme,
    language: settings.language === 'zh' || settings.language === 'en' ? settings.language : 'dsh',
    navPosition: settings.navPosition ?? 'left',
    pomodoro: {
      enabled: Boolean(settings.pomodoro?.enabled),
      focusMinutes: minutesOr(draft.pomodoroFocus, 25),
      breakMinutes: minutesOr(draft.pomodoroBreak, 5),
      soundPath: draft.pomodoroSound,
      loopAlarm: Boolean(settings.pomodoro?.loopAlarm),
    },
    countdown: {
      enabled: Boolean(settings.countdown?.enabled),
      presets: normalizeCountdownPresets(draft.countdownPresets),
    },
    pageOrder: [...order],
    pageEnabled: settings.pageEnabled,
    tls: {
      enabled: Boolean(settings.tls?.enabled),
      certPath: draft.certPath,
      keyPath: draft.keyPath,
      advanced: {
        wakeLock: settings.tls?.advanced?.wakeLock === true,
      },
    },
    weather: nextWeather,
    balance: {
      spendWindow: settings.balance?.spendWindow ?? 'calendar',
      lowThreshold: draft.threshold === '' ? null : Number(draft.threshold),
      showPeakValley: settings.balance?.showPeakValley !== false,
    },
    notifications: {
      enabledApps: notificationApps.length > 0 && selectedApps.length === notificationApps.length ? [] : selectedApps,
      limit: Number(draft.notificationLimit),
      pushQuestions: Boolean(settings.notifications?.pushQuestions),
    },
  };
}

/** Human-readable location-permission result. */
export function locationHint(t: Translator, result: Pick<LocationResult, 'allowed' | 'reason'>): string {
  if (result.allowed) return t('locationAllowed');
  if (result.reason === 'low-integrity') return t('locationLowIntegrity');
  if (result.reason === 'privacy-denied') return t('locationPrivacyDenied');
  if (result.reason === 'unspecified') return t('locationUnspecified');
  return t('locationFailed');
}

/** Human-readable Windows location access state. */
export function accessLabel(t: Translator, access: string): string {
  if (access === 'allowed') return t('accessAllowed');
  if (access === 'denied') return t('accessDenied');
  if (access === 'unspecified') return t('accessUnspecified');
  return t('accessUnknown');
}

/** Compact duration for connected-device age and Node.js uptime. */
export function formatDuration(ms: number, t: Translator): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} ${t('durationSeconds')}`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} ${t('durationMinutes')}`;
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours} ${t('durationHours')} ${minutes} ${t('durationMinutes')}`;
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days} ${t('durationDays')} ${hours} ${t('durationHours')}`;
}

/** Byte count with one decimal only when it stays readable. */
export function formatBytes(value: unknown): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || size >= 10 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unit]}`;
}
