/**
 * Wire types and the client context contract for the remote-control page.
 *
 * Everything here is either a JSON payload shape from `/api/*` or a minimal
 * structural view of the DSH client context. Keeping these declarations in one
 * module lets the UI modules depend on the contract without importing each
 * other, and keeps the Host/Client wire shape reviewable in one place.
 */

import type * as React from 'react';

/** Network interface as reported by the settings API. */
export interface RemoteInterface {
  name: string;
  address: string;
  netmask?: string;
  cidr?: string | null;
  selected?: boolean;
  url?: string;
}

/** Notification/media application as reported by the settings API. */
export interface RemoteApp {
  key: string;
  name: string;
  customName?: string | null;
  defaultName?: string | null;
  count?: number;
  firstSeen?: number;
  lastSeen?: number;
  sources?: string[];
}

/** One connected phone/browser as reported by the settings API. */
export interface RemoteClient {
  id: string;
  label?: string;
  ip: string;
  connectedAt: number;
}

export interface RemoteRoutes {
  remote?: string;
  info?: string;
  settings?: string;
}

export interface RemoteTlsInfo {
  configured?: boolean;
  active?: boolean;
  error?: string | null;
}

/** Pairing/info payload read by the connection and system sections. */
export interface RemoteInfo {
  qrPath?: string;
  routes?: RemoteRoutes;
  tls?: RemoteTlsInfo;
  running?: boolean;
  platform?: string;
  platformLabel?: string;
  version?: string;
  protocol?: string;
  tokenRequired?: boolean;
  primaryUrl?: string;
  clients?: RemoteClient[];
}

export interface WeatherSettings {
  mode?: string;
  name?: string;
  latitude?: number | null;
  longitude?: number | null;
  forecastMode?: string;
}

export interface BalanceSettings {
  spendWindow?: string;
  lowThreshold?: number | null;
  showPeakValley?: boolean;
}

export interface NotificationSettings {
  enabledApps?: string[];
  limit?: number;
  pushQuestions?: boolean;
}

export interface TlsSettings {
  enabled?: boolean;
  certPath?: string;
  keyPath?: string;
}

export interface PomodoroSettings {
  enabled?: boolean;
  focusMinutes?: number;
  breakMinutes?: number;
  soundPath?: string;
  loopAlarm?: boolean;
}

/** Settings object from `/api/settings`; every section is optional on the wire. */
export interface RemoteSettings {
  tokenEnabled: boolean;
  allowedInterfaces: string[] | null;
  theme: string;
  temperatureUnit: string;
  navPosition?: string;
  pomodoro?: PomodoroSettings;
  pageOrder?: string[];
  pageEnabled?: Record<string, boolean>;
  weather?: WeatherSettings;
  balance?: BalanceSettings;
  notifications?: NotificationSettings;
  tls?: TlsSettings;
}

/** A capability probe that only reports availability. */
export interface CapabilityStatus {
  available?: boolean;
  ok?: boolean;
  error?: string | null;
}

/** `dsh-probe version` platform backends. */
export interface ProbeBackends {
  media?: string;
  volume?: string;
  performance?: string;
  notifications?: string;
  location?: string;
}

/** Native `dsh-probe` availability and build information. */
export interface ProbeCapability extends CapabilityStatus {
  binary?: string;
  platform?: string;
  arch?: string;
  directory?: string;
  disabled?: boolean;
  version?: string | null;
  backends?: ProbeBackends | null;
}

/** Host Node.js process information. */
export interface NodeCapability extends CapabilityStatus {
  version?: string;
  v8?: string;
  platform?: string;
  arch?: string;
  pid?: number;
  uptimeSeconds?: number;
  memory?: {
    rss?: number;
    heapUsed?: number;
    heapTotal?: number;
  };
}

export interface RemoteCapabilities {
  notifications?: CapabilityStatus;
  media?: CapabilityStatus;
  volume?: CapabilityStatus;
  weather?: { ok?: boolean | null; updatedAt?: number | null };
  probe?: ProbeCapability;
  node?: NodeCapability;
}

export interface DiagnosticsInfo {
  platform?: string;
  platformLabel?: string;
  version?: string;
  protocol?: string;
  clientCount?: number;
  notificationApps?: number;
  profile?: string;
}

/** Envelope returned by `/api/settings`, `/api/token/rotate`, and `/api/disconnect`. */
export interface SettingsPayload {
  settings: RemoteSettings;
  interfaces?: RemoteInterface[];
  apps?: RemoteApp[];
  clients?: RemoteClient[];
  capabilities?: RemoteCapabilities;
  diagnostics?: DiagnosticsInfo;
  info?: RemoteInfo;
}

/** Editable copies of the settings text fields. */
export interface DraftState {
  certPath: string;
  keyPath: string;
  locationName: string;
  latitude: string | number;
  longitude: string | number;
  threshold: string | number;
  notificationLimit: string;
  pomodoroFocus: string;
  pomodoroBreak: string;
  pomodoroSound: string;
}

/** Nested patch accumulated until the user presses "save settings". */
export interface StagedSettings {
  tokenEnabled?: boolean;
  temperatureUnit?: string;
  theme?: string;
  navPosition?: string;
  pomodoro?: PomodoroSettings;
  pageOrder?: string[];
  pageEnabled?: Record<string, boolean>;
  tls?: TlsSettings;
  weather?: WeatherSettings;
  balance?: BalanceSettings;
  notifications?: NotificationSettings;
}

/** Body posted to `/api/settings`. */
export interface SavePatch {
  allowedInterfaces: string[] | null;
  tokenEnabled: boolean;
  temperatureUnit: string;
  theme: string;
  navPosition: string;
  pomodoro: { enabled: boolean; focusMinutes: number; breakMinutes: number; soundPath: string; loopAlarm: boolean };
  pageOrder: string[];
  pageEnabled?: Record<string, boolean>;
  tls: { enabled: boolean; certPath: string; keyPath: string };
  weather: WeatherSettings;
  balance: { spendWindow: string; lowThreshold: number | null; showPeakValley: boolean };
  notifications: { enabledApps: string[]; limit: number; pushQuestions: boolean };
}

/** Result of `POST /api/location`. */
export interface LocationResult {
  allowed: boolean;
  access: string;
  reason: string | null;
  lowIntegrity: boolean;
  openedSettings: boolean;
}

export type ColorScheme = 'light' | 'dark';

/** Theme snapshot handed to `theme/change` handlers. */
export interface ThemeSnapshot {
  active?: {
    colorScheme?: ColorScheme;
  };
}

export interface LocaleService {
  bind(namespace: string): (key: string) => string;
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): void;
  subscribe?(listener: () => void): () => void;
}

export interface SlotRegisterOptions {
  name: string;
  id?: string;
  key?: string;
  order?: number;
  label?: () => string;
}

export interface SlotService {
  inject(slot: string, factory: () => unknown): void;
  register<P>(options: SlotRegisterOptions, component: React.ComponentType<P>): void;
}

/** Minimal structural view of the DSH client context used by this module. */
export interface ClientContext {
  locale: LocaleService;
  effect(fn: () => void | (() => void), label: string): unknown;
  on(event: string, handler: (snapshot?: ThemeSnapshot) => void): (() => void) | undefined;
  slots: SlotService;
  theme?: {
    getTheme?(): ThemeSnapshot | undefined;
  };
}

/** The translator shape used by every UI module. */
export type Translator = (key: string) => string;

/**
 * Everything the section renderers need from the panel. The panel owns state
 * and actions; sections stay presentational and can be tested/edited without
 * walking through the whole page component.
 */
export interface PanelApi {
  t: Translator;
  data: SettingsPayload;
  settings: RemoteSettings;
  draft: DraftState;
  info: RemoteInfo;
  apps: RemoteApp[];
  clients: RemoteClient[];
  busy: boolean;
  appBusyKey: string;
  locationBusy: boolean;
  locationResult: LocationResult | null;
  copied: boolean;
  order: string[];
  labels: Record<string, string>;
  draggingKey: string | null;
  dragIndex: number | null;
  selectedInterfaces: string[];
  selectedApps: string[];
  appNames: Record<string, string>;
  orderListRef: React.RefObject<HTMLDivElement | null>;
  setDraft: React.Dispatch<React.SetStateAction<DraftState>>;
  setError: (value: string) => void;
  setAppNames: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  selectAllApps: () => void;
  stage: (patch: StagedSettings) => void;
  save: (patch: SavePatch) => Promise<void>;
  saveAll: () => void;
  copy: () => Promise<void>;
  rotate: () => Promise<void>;
  saveAppName: (key: string, name: string) => Promise<void>;
  requestLocation: () => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  toggleApp: (key: string) => void;
  toggleInterface: (name: string) => void;
  togglePage: (key: string) => void;
  startOrderDrag: (key: string, event: React.PointerEvent<HTMLElement>) => void;
}
