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

export type WeatherProviderId = 'nmc' | 'open-meteo' | 'qweather';

export interface ProviderLocationSettings {
  latitude?: number | null;
  longitude?: number | null;
  locationId?: string;
  timezone?: string;
  country?: string;
}

export interface QWeatherSettings {
  apiHost?: string;
  credentialId?: string;
  projectId?: string;
  developerId?: string;
  privateKey?: string;
  monthlyLimit?: number;
  refreshMinutes?: number;
  /** Read console finance/stats and reconcile the local call count. */
  syncConsole?: boolean;
}

export interface WeatherSettings {
  mode?: string;
  name?: string;
  forecastMode?: string;
  provider?: WeatherProviderId;
  locations?: Partial<Record<WeatherProviderId, ProviderLocationSettings>>;
  qweather?: QWeatherSettings;
}

/** One city from `GET/POST /api/geocode`. */
export interface GeocodePlace {
  id?: number | string;
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
  timezone?: string;
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
  advanced?: {
    /** Keep the phone screen awake while the console is visible; independent of `enabled`. */
    wakeLock?: boolean;
  };
}

export interface PomodoroSettings {
  enabled?: boolean;
  focusMinutes?: number;
  breakMinutes?: number;
  soundPath?: string;
  loopAlarm?: boolean;
}

export interface CountdownSettings {
  enabled?: boolean;
  /** One to five quick-select durations, in seconds. */
  presets?: number[];
}

export interface QuickQaModelSelection {
  provider?: string;
  model?: string;
  reasoningEffort?: string;
}

export interface QuickQaWorkspaceProfile {
  agentPreset?: string;
  permissionPreset?: string;
}

export interface QuickQaSettings {
  model?: QuickQaModelSelection;
  defaultWorkspaceId?: string;
  pinnedWorkspaceIds?: string[];
  profiles?: Record<string, QuickQaWorkspaceProfile>;
  /** Allow the phone to attach one image when the selected model accepts it. */
  allowImages?: boolean;
}

export interface QuickQaReasoningEffort {
  id: string;
  name: string;
}

export interface QuickQaModelOption {
  id: string;
  name: string;
  description?: string;
  reasoning: {
    efforts: QuickQaReasoningEffort[];
    defaultEffort?: string;
  } | null;
  /** False only when the route explicitly declares text-only input. */
  imageInput?: boolean;
}

export interface QuickQaModelGroup {
  id: string;
  name: string;
  models: QuickQaModelOption[];
}

export interface QuickQaModelCatalog {
  default?: QuickQaModelSelection;
  groups?: QuickQaModelGroup[];
  failures?: Array<{ id: string; name: string; message: string }>;
}

export interface QuickQaWorkspaceOption {
  id: string;
  title: string;
  path: string;
}

export interface QuickQaModeOption {
  id: string;
  name: string;
  description?: string;
  broken?: string;
}

export interface QuickQaPermissionOption {
  value: string;
  name: string;
  description?: string;
}

/** Live catalogs used by the Quick Q&A settings section. */
export interface QuickQaOptionsPayload {
  ok?: boolean;
  voice?: {
    ready?: boolean;
    providerName?: string;
    language?: string;
  };
  model?: QuickQaModelCatalog;
  workspaces?: QuickQaWorkspaceOption[];
  modes?: QuickQaModeOption[];
  permissions?: {
    options?: QuickQaPermissionOption[];
    defaultPreset?: string;
  };
  settings?: QuickQaSettings;
  pushQuestions?: boolean;
  errors?: string[];
  updatedAt?: number;
}

/** Quick Q&A settings exposed to the phone console. */
export interface RemoteQuickQaSettings {
  voiceReady?: boolean;
  defaultWorkspaceId?: string;
  defaultWorkspaceTitle?: string;
  pinned?: Array<{ id: string; title: string; path: string }>;
  pushQuestions?: boolean;
  /** Whether the phone may show the attach controls for one image. */
  allowImages?: boolean;
}

/** Settings object from `/api/settings`; every section is optional on the wire. */
export interface RemoteSettings {
  tokenEnabled: boolean;
  allowedInterfaces: string[] | null;
  theme: string;
  /** Plugin language preference: `dsh`, `zh`, or `en`. */
  language?: string;
  /** Resolved console language computed by the Host. */
  locale?: string;
  temperatureUnit: string;
  navPosition?: string;
  pomodoro?: PomodoroSettings;
  countdown?: CountdownSettings;
  quickqa?: QuickQaSettings;
  /** Address embedded by the phone's custom page; empty means its default. */
  customPageUrl?: string;
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

/** Media capability plus the backend-reported provider detail. */
export interface MediaCapability extends CapabilityStatus {
  appId?: string | null;
  title?: string | null;
  provider?: 'system' | 'private' | 'accessibility' | null;
  providerDetail?: string | null;
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

export interface WeatherQuota {
  month?: string;
  used?: number;
  limit?: number;
  remaining?: number;
  exhausted?: boolean;
}

export interface QWeatherConsoleStats {
  asOf?: string | null;
  success?: number;
  errors?: number;
  total?: number;
}

export interface QWeatherConsoleSnapshot {
  fetchedAt?: number;
  asOf?: string | null;
  stats?: QWeatherConsoleStats | null;
  monthlyUsed?: number | null;
  errors?: string[];
}

export interface WeatherCapability {
  ok?: boolean | null;
  updatedAt?: number | null;
  provider?: string;
  requestedProvider?: string;
  providerSwitched?: boolean;
  quota?: WeatherQuota;
  configured?: boolean;
  location?: { name?: string; nameFallback?: boolean; latitude?: number; longitude?: number; source?: string } | null;
  console?: QWeatherConsoleSnapshot | null;
  error?: string | null;
}

export interface RemoteCapabilities {
  notifications?: CapabilityStatus;
  media?: MediaCapability;
  volume?: CapabilityStatus;
  weather?: WeatherCapability;
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

/** One editable countdown preset, split into its minute and second fields. */
export interface CountdownPresetDraft {
  minutes: string;
  seconds: string;
}

/** Editable copies of the settings text fields. */
export interface DraftState {
  certPath: string;
  keyPath: string;
  qweatherApiHost: string;
  qweatherCredentialId: string;
  qweatherProjectId: string;
  qweatherDeveloperId: string;
  qweatherPrivateKey: string;
  qweatherMonthlyLimit: string;
  qweatherRefreshMinutes: string;
  qweatherSyncConsole: boolean;
  threshold: string | number;
  notificationLimit: string;
  pomodoroFocus: string;
  pomodoroBreak: string;
  pomodoroSound: string;
  /** Editable preset rows; one to five entries before save. */
  countdownPresets: CountdownPresetDraft[];
  /** Editable address for the phone's custom page. */
  customPageUrl: string;
}

/** Nested patch accumulated until the user presses "save settings". */
export interface StagedSettings {
  tokenEnabled?: boolean;
  temperatureUnit?: string;
  theme?: string;
  language?: string;
  navPosition?: string;
  pomodoro?: PomodoroSettings;
  countdown?: CountdownSettings;
  quickqa?: QuickQaSettings;
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
  language: string;
  navPosition: string;
  pomodoro: { enabled: boolean; focusMinutes: number; breakMinutes: number; soundPath: string; loopAlarm: boolean };
  countdown: { enabled: boolean; presets: number[] };
  quickqa: QuickQaSettings;
  customPageUrl: string;
  pageOrder: string[];
  pageEnabled?: Record<string, boolean>;
  tls: {
    enabled: boolean;
    certPath: string;
    keyPath: string;
    advanced: { wakeLock: boolean };
  };
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
  /** DSH's active locale snapshot (locale runtime). */
  getLocale?(): { active?: string } | undefined;
  getSnapshot?(): { active?: string } | undefined;
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
  quickQaOptions: QuickQaOptionsPayload | null;
  quickQaBusy: boolean;
  refreshQuickQaOptions: (force?: boolean) => Promise<void>;
  draggingKey: string | null;
  dragIndex: number | null;
  draggingWorkspaceId: string | null;
  workspaceDragIndex: number | null;
  selectedInterfaces: string[];
  selectedApps: string[];
  appNames: Record<string, string>;
  orderListRef: React.RefObject<HTMLDivElement | null>;
  workspaceListRef: React.RefObject<HTMLDivElement | null>;
  setDraft: React.Dispatch<React.SetStateAction<DraftState>>;
  setError: (value: string) => void;
  setAppNames: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  selectAllApps: () => void;
  stage: (patch: StagedSettings) => void;
  save: (patch: SavePatch) => Promise<void>;
  saveAll: () => void;
  refreshData: () => Promise<void>;
  settingsVersion: number;
  copy: () => Promise<void>;
  rotate: () => Promise<void>;
  saveAppName: (key: string, name: string) => Promise<void>;
  requestLocation: () => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  toggleApp: (key: string) => void;
  toggleInterface: (name: string) => void;
  togglePage: (key: string) => void;
  startOrderDrag: (key: string, event: React.PointerEvent<HTMLElement>) => void;
  startWorkspaceDrag: (key: string, event: React.PointerEvent<HTMLElement>) => void;
}
