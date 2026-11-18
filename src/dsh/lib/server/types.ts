/** Wire payloads shared by the LAN server, sidebar routes, and snapshots. */

import type {
  CountdownSettings,
  PluginLocale,
  PomodoroSettings,
  TemperatureUnit,
} from '../settings/index.js';

/** Response headers accepted by the JSON and text helpers. */
export type ResponseHeaders = Record<string, string | number>;

/** Parsed IPv4 network of one interface. */
export interface CidrInfo {
  network: number;
  mask: number;
  prefix: number;
  cidr: string;
}

/** One LAN interface as exposed to the settings panel. */
export interface InterfaceEntry {
  name: string;
  address: string;
  netmask: string;
  cidr: string | null;
  selected: boolean;
  url?: string;
}

/** One advertised console URL for a selected interface. */
export interface RemoteUrlEntry {
  name: string;
  address: string;
  url?: string;
}

/** Browser-facing settings snapshot pushed over the socket. */
export interface RemoteSettingsPayload {
  theme: string;
  /** Resolved console language (Chinese or English). */
  locale: PluginLocale;
  temperatureUnit: TemperatureUnit;
  notificationLimit: number;
  /** Whether the phone may show and answer pending session questions. */
  pushQuestions: boolean;
  navPosition: string;
  balance: {
    spendWindow: string;
    lowThreshold: number | null;
    showPeakValley: boolean;
  };
  pomodoro: PomodoroSettings;
  countdown: {
    enabled: boolean;
    presets: number[];
  };
  /** Safe subset: the phone only needs the HTTPS state and advanced toggles. */
  tls: {
    enabled: boolean;
    advanced: {
      wakeLock: boolean;
    };
  };
  pageOrder: string[];
  pageEnabled: Record<string, boolean>;
  /** Quick Q&A workspace choices, voice readiness, and page defaults. */
  quickqa: {
    voiceReady: boolean;
    defaultWorkspaceId: string;
    defaultWorkspaceTitle: string;
    pinned: Array<{ id: string; title: string; path: string }>;
    pushQuestions: boolean;
  };
}
