/** Pure state helpers shared by the panel and its section renderers. */

import type {
  DraftState,
  LocationResult,
  RemoteApp,
  RemoteSettings,
  SavePatch,
  SettingsPayload,
  StagedSettings,
  Translator,
} from './types.js';
import { isRecord } from './api.js';

export const PAGE_ORDER: string[] = ['home', 'sessions', 'music', 'performance'];

export const EMPTY_DRAFT: DraftState = {
  certPath: '',
  keyPath: '',
  locationName: '',
  latitude: '',
  longitude: '',
  threshold: '',
  notificationLimit: '5',
  pomodoroFocus: '25',
  pomodoroBreak: '5',
  pomodoroSound: '',
};

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
    locationName: settings.weather?.name ?? '',
    latitude: text(settings.weather?.latitude),
    longitude: text(settings.weather?.longitude),
    threshold: text(settings.balance?.lowThreshold),
    notificationLimit: String(settings.notifications?.limit ?? 5),
    pomodoroFocus: String(settings.pomodoro?.focusMinutes ?? 25),
    pomodoroBreak: String(settings.pomodoro?.breakMinutes ?? 5),
    pomodoroSound: settings.pomodoro?.soundPath ?? '',
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

/** Layer staged edits over the Host settings document for rendering. */
export function buildSettingsView(base: RemoteSettings, staged: StagedSettings): RemoteSettings {
  return {
    ...base,
    ...staged,
    weather: { ...(base.weather ?? {}), ...(staged.weather ?? {}) },
    balance: { ...(base.balance ?? {}), ...(staged.balance ?? {}) },
    notifications: { ...(base.notifications ?? {}), ...(staged.notifications ?? {}) },
    tls: { ...(base.tls ?? {}), ...(staged.tls ?? {}) },
    pomodoro: { ...(base.pomodoro ?? {}), ...(staged.pomodoro ?? {}) },
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

/** Build the single batch body posted by "save settings". */
export function buildSavePatch(input: SavePatchInput): SavePatch {
  const { data, settings, draft, selectedInterfaces, selectedApps, notificationApps, order } = input;
  const allInterfaces = [...new Set((data.interfaces ?? []).map((entry) => entry.name))];
  const nextWeather: RemoteSettings['weather'] = {
    ...(settings.weather ?? {}),
    name: draft.locationName,
    latitude: draft.latitude === '' ? null : Number(draft.latitude),
    longitude: draft.longitude === '' ? null : Number(draft.longitude),
  };
  return {
    allowedInterfaces: selectedInterfaces.length === allInterfaces.length ? null : selectedInterfaces,
    tokenEnabled: settings.tokenEnabled,
    temperatureUnit: settings.temperatureUnit === 'fahrenheit' ? 'fahrenheit' : 'celsius',
    theme: settings.theme,
    navPosition: settings.navPosition ?? 'left',
    pomodoro: {
      enabled: Boolean(settings.pomodoro?.enabled),
      focusMinutes: Number(draft.pomodoroFocus) || 25,
      breakMinutes: Number(draft.pomodoroBreak) || 5,
      soundPath: draft.pomodoroSound,
      loopAlarm: Boolean(settings.pomodoro?.loopAlarm),
    },
    pageOrder: [...order],
    pageEnabled: settings.pageEnabled,
    tls: { enabled: Boolean(settings.tls?.enabled), certPath: draft.certPath, keyPath: draft.keyPath },
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
