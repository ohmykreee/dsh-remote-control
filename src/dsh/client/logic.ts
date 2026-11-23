/** Pure state helpers shared by the panel and its section renderers. */

import type {
  CountdownPresetDraft,
  DraftIssues,
  DraftState,
  LocationResult,
  ProviderLocationSettings,
  QuickQaModelCatalog,
  QuickQaModelOption,
  QuickQaSettings,
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

export const PAGE_ORDER: string[] = ['home', 'sessions', 'quickqa', 'music', 'performance', 'custom'];

/** Provider order used by the settings list and the quota fallback priority. */
export const WEATHER_PROVIDERS: WeatherProviderId[] = ['nmc', 'open-meteo', 'qweather'];

/** QWeather calls used by one refresh; mirrors the Host's quota estimate. */
export const QWEATHER_CALLS_PER_REFRESH = 4;
export const QWEATHER_DEFAULT_MONTHLY_LIMIT = 47_500;
/** Largest monthly limit Node.js can represent without unsafe integer math. */
export const QWEATHER_MAX_MONTHLY_LIMIT = Number.MAX_SAFE_INTEGER;
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
  const minutes = Math.max(1, Number(refreshMinutes) || QWEATHER_DEFAULT_REFRESH_MINUTES);
  return Math.round((30 * 24 * 60 * QWEATHER_CALLS_PER_REFRESH) / minutes);
}

/** Upper bound for user-configured countdown presets. */
export const COUNTDOWN_PRESET_LIMIT = 5;
/** Smallest and largest accepted countdown duration, in seconds. */
export const COUNTDOWN_MIN_SECONDS = 1;
export const COUNTDOWN_MAX_SECONDS = 86_400;
/** Presets a fresh profile starts with; the user may keep one to five. */
export const DEFAULT_COUNTDOWN_PRESETS: number[] = [60, 300, 600];

/** Display limit used when the notification count field has no valid value. */
export const DEFAULT_NOTIFICATION_LIMIT = 5;

/** Pomodoro duration bounds, mirrored from the Host normalizer for the UI. */
export const POMODORO_MIN_MINUTES = 0.1;
export const POMODORO_MAX_FOCUS_MINUTES = 180;
export const POMODORO_MAX_BREAK_MINUTES = 120;

export const EMPTY_DRAFT: DraftState = {
  certPath: '',
  keyPath: '',
  trustedProxies: '',
  qweatherApiHost: '',
  qweatherCredentialId: '',
  qweatherProjectId: '',
  qweatherDeveloperId: '',
  qweatherPrivateKey: '',
  qweatherMonthlyLimit: '47500',
  qweatherRefreshMinutes: '30',
  qweatherSyncConsole: false,
  threshold: '',
  notificationLimit: String(DEFAULT_NOTIFICATION_LIMIT),
  pomodoroFocus: '25',
  pomodoroBreak: '5',
  pomodoroSound: '',
  countdownPresets: createCountdownDraft(DEFAULT_COUNTDOWN_PRESETS),
  customPageUrl: '',
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
    quickqa: t('pageQuickQa'),
    music: t('pageMusic'),
    performance: t('pagePerformance'),
    custom: t('pageCustom'),
  };
}

/** Shipped accent per phone theme; the picker shows it while the setting is empty. */
export const DEFAULT_PAGE_THEME_COLORS: Record<'light' | 'dark', string> = {
  dark: '#7d96ff',
  light: '#3457d5',
};

/** Phone theme after resolving "follow DSH" against the last synced DSH theme. */
export function effectivePageTheme(settings: RemoteSettings): 'light' | 'dark' {
  if (settings.theme === 'light' || settings.theme === 'dark') return settings.theme;
  return settings.effectiveTheme === 'light' ? 'light' : 'dark';
}

/** Default accent the picker shows; it mirrors the phone's shipped token. */
export function defaultPageThemeColor(settings: RemoteSettings): string {
  return DEFAULT_PAGE_THEME_COLORS[effectivePageTheme(settings)];
}

/** Keep only the opaque hex accents the Host accepts; invalid input clears. */
export function normalizePageThemeColor(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return '';
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/u.exec(raw);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[0-9a-f]{6}$/u.test(raw) ? raw : '';
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/** Build the editable text-field state from the current settings document. */
export function createDraft(settings: RemoteSettings): DraftState {
  return {
    certPath: settings.tls?.certPath ?? '',
    keyPath: settings.tls?.keyPath ?? '',
    trustedProxies: (settings.tls?.trustedProxies ?? []).join(', '),
    qweatherApiHost: settings.weather?.qweather?.apiHost ?? '',
    qweatherCredentialId: settings.weather?.qweather?.credentialId ?? '',
    qweatherProjectId: settings.weather?.qweather?.projectId ?? '',
    qweatherDeveloperId: settings.weather?.qweather?.developerId ?? '',
    qweatherPrivateKey: settings.weather?.qweather?.privateKey ?? '',
    qweatherMonthlyLimit: String(settings.weather?.qweather?.monthlyLimit ?? QWEATHER_DEFAULT_MONTHLY_LIMIT),
    qweatherRefreshMinutes: String(settings.weather?.qweather?.refreshMinutes ?? QWEATHER_DEFAULT_REFRESH_MINUTES),
    qweatherSyncConsole: settings.weather?.qweather?.syncConsole === true,
    threshold: text(settings.balance?.lowThreshold),
    notificationLimit: String(settings.notifications?.limit ?? DEFAULT_NOTIFICATION_LIMIT),
    pomodoroFocus: String(settings.pomodoro?.focusMinutes ?? 25),
    pomodoroBreak: String(settings.pomodoro?.breakMinutes ?? 5),
    pomodoroSound: settings.pomodoro?.soundPath ?? '',
    countdownPresets: createCountdownDraft(settings.countdown?.presets),
    customPageUrl: settings.customPageUrl ?? '',
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

function mergeQuickQaSettings(base: QuickQaSettings | undefined, staged: QuickQaSettings | undefined): QuickQaSettings {
  return {
    ...(base ?? {}),
    ...(staged ?? {}),
    model: { ...(base?.model ?? {}), ...(staged?.model ?? {}) },
    pinnedWorkspaceIds: staged?.pinnedWorkspaceIds ?? base?.pinnedWorkspaceIds ?? [],
    profiles: { ...(base?.profiles ?? {}), ...(staged?.profiles ?? {}) },
  };
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
    quickqa: mergeQuickQaSettings(base.quickqa, staged.quickqa),
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
  /** Effective-model image support; null when the live catalog is not loaded. */
  quickQaImageInput: boolean | null;
}

/** Minutes are posted as typed; empty or invalid fields keep their default. */
function minutesOr(value: string, fallback: number): number {  const text = value.trim();
  if (text === '') return fallback;
  const minutes = Number(text);
  return Number.isFinite(minutes) ? minutes : fallback;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Split the comma-separated trusted-proxy field. The Host validates and
 * canonicalizes each entry, so the client only trims and drops blanks.
 */
export function parseTrustedProxiesInput(value: string): string[] {
  return checkTrustedProxiesInput(value).entries;
}

/** Result of checking the trusted-proxy field, including rejected entries. */
export interface TrustedProxyInputCheck {
  entries: string[];
  invalid: string[];
}

function isIpv4Address(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/u.test(part));
}

function isIpv6Address(value: string): boolean {
  const text = value.toLowerCase();
  if (!text.includes(':') || text.includes(':::')) return false;
  const halves = text.split('::');
  if (halves.length > 2) return false;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups = [...head, ...tail];
  let count = 0;
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    if (index === groups.length - 1 && group.includes('.')) {
      if (!isIpv4Address(group)) return false;
      count += 2;
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/u.test(group)) return false;
    count += 1;
  }
  return halves.length === 2 ? count < 8 : count === 8;
}

/** One entry must be an IPv4/IPv6 address with an optional CIDR prefix. */
function isValidProxyEntry(entry: string): boolean {
  let text = entry.trim();
  if (!text) return false;
  let prefix: number | null = null;
  const slash = text.indexOf('/');
  if (slash >= 0) {
    if (text.indexOf('/', slash + 1) >= 0) return false;
    const prefixText = text.slice(slash + 1);
    if (!/^\d{1,3}$/u.test(prefixText)) return false;
    prefix = Number(prefixText);
    text = text.slice(0, slash);
  }
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  if (text.includes('[') || text.includes(']')) return false;
  // An IPv4-mapped IPv6 entry is stored as plain IPv4 by the Host, so its
  // prefix must be in the IPv4 range too.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(text);
  if (mapped && isIpv4Address(mapped[1])) return prefix === null || prefix <= 32;
  if (isIpv4Address(text)) return prefix === null || prefix <= 32;
  if (isIpv6Address(text)) return prefix === null || prefix <= 128;
  return false;
}

/**
 * Validate the trusted-proxy text field before it is sent to the Host.
 *
 * Only ASCII commas separate entries. A malformed entry, a full-width comma, a
 * semicolon, or a blank slot between commas is rejected so the panel can block
 * "save settings" instead of persisting a silently shortened list.
 */
export function checkTrustedProxiesInput(value: string): TrustedProxyInputCheck {
  const entries: string[] = [];
  const invalid: string[] = [];
  const raw = typeof value === 'string' ? value : '';
  if (!raw.trim()) return { entries, invalid };
  for (const piece of raw.split(',')) {
    const token = piece.trim();
    if (!isValidProxyEntry(token)) {
      invalid.push(token || piece);
      continue;
    }
    if (!entries.includes(token)) entries.push(token);
  }
  return { entries, invalid };
}

/** Host truncates these values; reject anything that would be silently cut. */
function isValidPathInput(value: string): boolean {
  const path = value.trim();
  return path.length > 0
    && path.length <= 4096
    && !path.includes('\0')
    && !path.includes('://')
    && !/[\r\n]/u.test(path);
}

/** QWeather accepts a bare host with an optional port; a pasted URL is stripped. */
function isValidQWeatherHostInput(value: string): boolean {
  const text = value.trim();
  if (!text) return true;
  const host = text.replace(/^https?:\/\//iu, '').replace(/\/.*$/u, '').trim();
  if (!host || host.length > 120) return false;
  const match = /^[a-z0-9.-]+(?::(\d{1,5}))?$/iu.exec(host);
  if (!match) return false;
  if (match[1] === undefined) return true;
  const port = Number(match[1]);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** A PEM private key is only checked when the user typed one. */
function isValidPrivateKeyInput(value: string): boolean {
  const key = value.trim();
  if (!key) return true;
  if (key.length > 16_384) return false;
  return /^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/mu.test(key)
    && /-----END [A-Z0-9 ]*PRIVATE KEY-----/mu.test(key);
}

/** Optional address: empty uses the built-in page; otherwise it must be http(s). */
function isValidCustomPageUrlInput(value: string): boolean {
  const raw = value.trim();
  if (!raw) return true;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//iu.exec(raw);
  if (scheme && !/^https?$/iu.test(scheme[1])) return false;
  const candidate = scheme ? raw : `https://${raw.replace(/^\/\//u, '')}`;
  if (candidate.length > 2048) return false;
  try {
    const url = new URL(candidate);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Invalid custom-page addresses clear on blur; the phone then uses its default. */
export function clampCustomPageUrlInput(value: string): string {
  const raw = value.trim();
  return raw && isValidCustomPageUrlInput(raw) ? raw : '';
}

/** Invalid low-balance thresholds clear to empty, which disables the alert. */
export function clampThresholdInput(value: string | number): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 && number < Number.MAX_SAFE_INTEGER ? text : '';
}

function thresholdValue(value: string | number): number | null {
  const text = clampThresholdInput(value);
  return text === '' ? null : Number(text);
}

/** Invalid notification counts fall back to the default on blur. */
export function clampNotificationLimitInput(value: string): string {
  const text = value.trim();
  if (!/^\d+$/u.test(text)) return String(DEFAULT_NOTIFICATION_LIMIT);
  const count = Number(text);
  return count >= 1 && count <= 20 ? String(count) : String(DEFAULT_NOTIFICATION_LIMIT);
}

/**
 * QWeather monthly limit: any positive integer up to the largest safe JS
 * integer is kept; higher numbers cap at that ceiling, while decimals,
 * negatives, and unparsable text return to the default.
 */
export function clampQWeatherMonthlyLimitInput(value: string): string {
  const text = value.trim();
  if (!text) return '';
  if (!/^\d+$/u.test(text)) return String(QWEATHER_DEFAULT_MONTHLY_LIMIT);
  const number = Number(text);
  if (!Number.isFinite(number) || number < 1) return String(QWEATHER_DEFAULT_MONTHLY_LIMIT);
  if (number > QWEATHER_MAX_MONTHLY_LIMIT) return String(QWEATHER_MAX_MONTHLY_LIMIT);
  return String(number);
}

/**
 * QWeather refresh interval: too low is still saved (the sidebar warns), but
 * zero, decimals, negatives, and values outside 1..1440 return to the default
 * on blur.
 */
export function clampQWeatherRefreshInput(value: string): string {
  const text = value.trim();
  if (!text) return '';
  if (!/^\d+$/u.test(text)) return String(QWEATHER_DEFAULT_REFRESH_MINUTES);
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < 1 || number > QWEATHER_MAX_REFRESH_MINUTES) {
    return String(QWEATHER_DEFAULT_REFRESH_MINUTES);
  }
  return String(number);
}

/** Alert sound: empty uses the built-in tone, otherwise a local path or http(s) URL. */
function isValidSoundInput(value: string): boolean {
  const text = value.trim();
  if (!text) return true;
  if (text.length > 2048 || text.includes('\0') || /[\r\n]/u.test(text)) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//iu.exec(text);
  return !scheme || /^https?$/iu.test(scheme[1]);
}

/**
 * Validate manually edited fields that cannot repair themselves.
 *
 * Minute inputs, countdown presets, the low-balance threshold, the notification
 * count, the custom page address, and the QWeather limit/refresh fields clamp
 * only when the field loses focus, so they are absent here. The fields checked
 * below have no clamp: an unusable value disables "save settings" instead of
 * being silently replaced by the Host.
 */
export function checkDraftIssues(settings: RemoteSettings, draft: DraftState): DraftIssues {
  const tlsEnabled = settings.tls?.enabled === true;
  const qweatherActive = normalizeWeatherProvider(settings.weather?.provider) === 'qweather';
  const certPath = draft.certPath.trim();
  const keyPath = draft.keyPath.trim();

  return {
    certPath: tlsEnabled && !isValidPathInput(certPath),
    keyPath: tlsEnabled && !isValidPathInput(keyPath),
    trustedProxies: checkTrustedProxiesInput(draft.trustedProxies).invalid.length > 0,
    // QWeather fields are only rendered while that provider is selected; a
    // hidden leftover must not block saving another provider's settings.
    qweatherApiHost: qweatherActive && !isValidQWeatherHostInput(draft.qweatherApiHost),
    qweatherIds: qweatherActive && [draft.qweatherCredentialId, draft.qweatherProjectId, draft.qweatherDeveloperId]
      .some((value) => value.trim().length > 120),
    qweatherPrivateKey: qweatherActive && !isValidPrivateKeyInput(draft.qweatherPrivateKey),
    pomodoroSound: !isValidSoundInput(draft.pomodoroSound),
  };
}

/** True when at least one manually edited field must be fixed before saving. */
export function draftHasIssues(issues: DraftIssues): boolean {
  return Object.values(issues).some(Boolean);
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

/**
 * The model Quick Q&A will actually use: the explicit selection when it is
 * still routable, otherwise the catalog default and then the first model.
 */
export function effectiveQuickQaModel(
  catalog: QuickQaModelCatalog | undefined,
  settings: QuickQaSettings | undefined,
): QuickQaModelOption | null {
  const groups = catalog?.groups ?? [];
  if (groups.length === 0) return null;
  const selected = settings?.model ?? {};
  const selectedGroup = groups.find((group) => group.id === selected.provider);
  const selectedModel = selectedGroup?.models.find((model) => model.id === selected.model);
  if (selectedModel) return selectedModel;
  const fallback = catalog?.default;
  if (fallback?.provider && fallback.model) {
    const group = groups.find((entry) => entry.id === fallback.provider);
    const model = group?.models.find((entry) => entry.id === fallback.model);
    if (model) return model;
  }
  return groups[0]?.models[0] ?? null;
}

/**
 * Image support for the effective model. `null` means the live catalog has not
 * been read yet, so the caller must not turn the saved option off by guesswork.
 */
export function quickQaImageInput(
  catalog: QuickQaModelCatalog | undefined,
  settings: QuickQaSettings | undefined,
): boolean | null {
  if (!catalog || (catalog.groups?.length ?? 0) === 0) return null;
  const model = effectiveQuickQaModel(catalog, settings);
  return model ? model.imageInput !== false : null;
}

/**
 * Keep only the default and pinned workspaces in the saved quickqa profile.
 * A workspace that is merely available in the picker keeps no saved mode.
 * A model that explicitly declares text-only input forces image attachments off.
 */
export function normalizeQuickQaForSave(
  value: QuickQaSettings | undefined,
  imageInput: boolean | null = null,
): QuickQaSettings {
  const defaultWorkspaceId = String(value?.defaultWorkspaceId ?? '').trim();
  const pinnedWorkspaceIds: string[] = [];
  for (const entry of Array.isArray(value?.pinnedWorkspaceIds) ? value.pinnedWorkspaceIds : []) {
    const id = String(entry ?? '').trim();
    if (!id || id === defaultWorkspaceId || pinnedWorkspaceIds.includes(id)) continue;
    pinnedWorkspaceIds.push(id);
  }
  const profiles: NonNullable<QuickQaSettings['profiles']> = {};
  for (const id of [defaultWorkspaceId, ...pinnedWorkspaceIds]) {
    if (!id) continue;
    const profile = value?.profiles?.[id];
    profiles[id] = {
      agentPreset: String(profile?.agentPreset ?? '').trim(),
      permissionPreset: String(profile?.permissionPreset ?? '').trim(),
    };
  }
  return {
    model: {
      provider: String(value?.model?.provider ?? '').trim(),
      model: String(value?.model?.model ?? '').trim(),
      reasoningEffort: String(value?.model?.reasoningEffort ?? '').trim(),
    },
    defaultWorkspaceId,
    pinnedWorkspaceIds,
    profiles,
    allowImages: imageInput === false ? false : value?.allowImages === true,
  };
}

/** Build the single batch body posted by "save settings". */
export function buildSavePatch(input: SavePatchInput): SavePatch {
  const { settings, draft, selectedInterfaces, selectedApps, notificationApps, order } = input;
  const weatherProvider = normalizeWeatherProvider(settings.weather?.provider);
  const monthlyLimitText = clampQWeatherMonthlyLimitInput(draft.qweatherMonthlyLimit);
  const refreshMinutesText = clampQWeatherRefreshInput(draft.qweatherRefreshMinutes);
  const monthlyLimit = monthlyLimitText === '' ? QWEATHER_DEFAULT_MONTHLY_LIMIT : Number(monthlyLimitText);
  const refreshMinutes = refreshMinutesText === '' ? QWEATHER_DEFAULT_REFRESH_MINUTES : Number(refreshMinutesText);
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
      monthlyLimit,
      refreshMinutes,
      syncConsole: draft.qweatherSyncConsole === true,
    },
  };
  return {
    allowedInterfaces: [...new Set(selectedInterfaces)],
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
    quickqa: normalizeQuickQaForSave(settings.quickqa, input.quickQaImageInput),
    customPageUrl: clampCustomPageUrlInput(draft.customPageUrl),
    pageThemeColor: normalizePageThemeColor(settings.pageThemeColor),
    pageOrder: [...order],
    pageEnabled: settings.pageEnabled,
    tls: {
      enabled: Boolean(settings.tls?.enabled),
      certPath: draft.certPath,
      keyPath: draft.keyPath,
      trustedProxies: parseTrustedProxiesInput(draft.trustedProxies),
      advanced: {
        // The wake-lock switch is independent of the HTTPS switch: the padlock
        // needs a secure context to take effect, but turning HTTPS off must not
        // silently reset the user's choice.
        wakeLock: settings.tls?.advanced?.wakeLock === true,
      },
    },
    weather: nextWeather,
    balance: {
      spendWindow: settings.balance?.spendWindow ?? 'calendar',
      lowThreshold: thresholdValue(draft.threshold),
      showPeakValley: settings.balance?.showPeakValley !== false,
    },
    notifications: {
      enabledApps: notificationApps.length > 0 && selectedApps.length === notificationApps.length ? [] : selectedApps,
      limit: Number(clampNotificationLimitInput(draft.notificationLimit)),
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
