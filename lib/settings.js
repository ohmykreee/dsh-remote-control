/** Persistent plugin settings for the remote console. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SETTINGS_VERSION = 1;

function dataDirectory() {
  if (process.env.DSH_PROFILE_DIR) return path.join(process.env.DSH_PROFILE_DIR, 'remote-control');
  if (process.env.DSH_HOME) return path.join(process.env.DSH_HOME, 'remote-control');
  return path.join(os.homedir(), '.dsh', 'remote-control');
}

function token() {
  return crypto.randomBytes(24).toString('base64url');
}

export function defaultSettings() {
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
    pageOrder: ['home', 'sessions', 'music', 'performance'],
    pageEnabled: { home: true, sessions: true, music: true, performance: true },
    updatedAt: now,
  };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === 'string' && item.length > 0).slice(0, 100))];
}

function normalize(raw) {
  const base = defaultSettings();
  const input = raw && typeof raw === 'object' ? raw : {};
  const weather = input.weather && typeof input.weather === 'object' ? input.weather : {};
  const balance = input.balance && typeof input.balance === 'object' ? input.balance : {};
  const notifications = input.notifications && typeof input.notifications === 'object' ? input.notifications : {};
  const tls = input.tls && typeof input.tls === 'object' ? input.tls : {};
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
  const pageKeys = ['home', 'sessions', 'music', 'performance'];
  const requestedOrder = Array.isArray(input.pageOrder) ? input.pageOrder.filter((key) => pageKeys.includes(key)) : [];
  const pageOrder = [...new Set(requestedOrder)];
  for (const key of pageKeys) if (!pageOrder.includes(key)) pageOrder.push(key);
  const normalizedOrder = pageOrder.slice(0, pageKeys.length);
  const pageEnabledInput = input.pageEnabled && typeof input.pageEnabled === 'object' ? input.pageEnabled : {};
  const pageEnabled = Object.fromEntries(pageKeys.map((key) => [key, pageEnabledInput[key] !== false]));
  if (!Object.values(pageEnabled).some(Boolean)) pageEnabled.home = true;

  return {
    version: SETTINGS_VERSION,
    token: typeof input.token === 'string' && input.token.length >= 16 ? input.token : base.token,
    tokenRotatedAt: Number.isFinite(Number(input.tokenRotatedAt)) ? Number(input.tokenRotatedAt) : base.tokenRotatedAt,
    tokenEnabled: input.tokenEnabled !== false,
    allowedInterfaces: input.allowedInterfaces === null ? null : normalizeStringArray(input.allowedInterfaces),
    theme: ['dsh', 'light', 'dark'].includes(input.theme) ? input.theme : 'dsh',
    dshTheme: ['light', 'dark'].includes(input.dshTheme) ? input.dshTheme : 'dark',
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
    pageOrder: normalizedOrder,
    pageEnabled,
    updatedAt: Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : Date.now(),
  };
}

export function createSettingsStore() {
  const dir = dataDirectory();
  const file = path.join(dir, 'settings.json');
  fs.mkdirSync(dir, { recursive: true });

  let current;
  try {
    current = normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    current = defaultSettings();
  }
  fs.writeFileSync(file, JSON.stringify(current, null, 2), 'utf8');

  function save(next) {
    current = normalize({ ...next, updatedAt: Date.now() });
    const temporary = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, JSON.stringify(current, null, 2), 'utf8');
    fs.renameSync(temporary, file);
    return current;
  }

  function update(patch) {
    const source = patch && typeof patch === 'object' ? patch : {};
    const next = {
      ...current,
      ...source,
      weather: { ...current.weather, ...(source.weather && typeof source.weather === 'object' ? source.weather : {}) },
      balance: { ...current.balance, ...(source.balance && typeof source.balance === 'object' ? source.balance : {}) },
      notifications: {
        ...current.notifications,
        ...(source.notifications && typeof source.notifications === 'object' ? source.notifications : {}),
      },
      tls: { ...current.tls, ...(source.tls && typeof source.tls === 'object' ? source.tls : {}) },
    };
    return save(next);
  }

  function rotateToken() {
    return save({ ...current, token: token(), tokenRotatedAt: Date.now() });
  }

  function setDshTheme(theme) {
    if (!['light', 'dark'].includes(theme)) return current;
    if (current.dshTheme === theme) return current;
    return save({ ...current, dshTheme: theme });
  }

  function publicSettings() {
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
