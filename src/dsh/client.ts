/**
 * Browser half: sidebar launcher and the native-style remote-console settings page.
 *
 * TypeScript source: `scripts/build-dsh.mjs` compiles this module to `client.js` and
 * wraps the CommonJS output in the DSH module-loader factory.
 */

import * as React from 'react';

const h = React.createElement;
const { useEffect, useState, useCallback, useRef } = React;

/** One choice rendered by `Seg`. */
interface SegOption {
  value: string;
  label: string;
}

interface PanelIconProps {
  size?: number;
  active?: boolean;
}

interface MenuIconProps {
  name: string;
}

interface ToggleProps {
  checked?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

interface SegProps {
  options: SegOption[];
  value: string;
  onChange: (value: string) => void;
}

interface BtnProps {
  children?: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

interface FieldProps {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}

interface RowProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
}

interface StatusRowProps {
  label: string;
  value?: boolean;
}

/** Network interface as reported by the settings API. */
interface RemoteInterface {
  name: string;
  address: string;
  cidr?: string;
}

/** Notification/media application as reported by the settings API. */
interface RemoteApp {
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
interface RemoteClient {
  id: string;
  label?: string;
  ip: string;
  connectedAt: number;
}

interface RemoteRoutes {
  remote?: string;
}

interface RemoteTlsInfo {
  active?: boolean;
  error?: string;
}

/** Pairing/info payload read by the connection and system sections. */
interface RemoteInfo {
  qrPath?: string;
  routes?: RemoteRoutes;
  tls?: RemoteTlsInfo;
  running?: boolean;
  platformLabel?: string;
  version?: string;
  protocol?: string;
}

interface WeatherSettings {
  mode?: string;
  name?: string;
  latitude?: number | null;
  longitude?: number | null;
  forecastMode?: string;
}

interface BalanceSettings {
  spendWindow?: string;
  lowThreshold?: number | null;
  showPeakValley?: boolean;
}

interface NotificationSettings {
  enabledApps?: string[];
  limit?: number;
  pushQuestions?: boolean;
}

interface TlsSettings {
  enabled?: boolean;
  certPath?: string;
  keyPath?: string;
}

interface PomodoroSettings {
  enabled?: boolean;
  focusMinutes?: number;
  breakMinutes?: number;
  soundPath?: string;
  loopAlarm?: boolean;
}

/** Settings object from `/api/settings`; every section is optional on the wire. */
interface RemoteSettings {
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

interface CapabilityStatus {
  available?: boolean;
  ok?: boolean;
}

interface RemoteCapabilities {
  notifications?: CapabilityStatus;
  media?: CapabilityStatus;
  volume?: CapabilityStatus;
  weather?: CapabilityStatus;
}

interface DiagnosticsInfo {
  platformLabel?: string;
  version?: string;
  protocol?: string;
}

/** Envelope returned by `/api/settings`, `/api/token/rotate`, and `/api/disconnect`. */
interface SettingsPayload {
  settings: RemoteSettings;
  interfaces?: RemoteInterface[];
  apps?: RemoteApp[];
  clients?: RemoteClient[];
  capabilities?: RemoteCapabilities;
  diagnostics?: DiagnosticsInfo;
  info?: RemoteInfo;
}

/** Editable copies of the settings text fields. */
interface DraftState {
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
interface StagedSettings {
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
interface SavePatch {
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

type ColorScheme = 'light' | 'dark';

/** Theme snapshot handed to `theme/change` handlers. */
interface ThemeSnapshot {
  active?: {
    colorScheme?: ColorScheme;
  };
}

interface LocaleService {
  bind(namespace: string): (key: string) => string;
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): void;
}

interface SlotRegisterOptions {
  name: string;
  id?: string;
  key?: string;
  order?: number;
  label?: () => string;
}

interface SlotService {
  inject(slot: string, factory: () => unknown): void;
  register<P>(options: SlotRegisterOptions, component: React.ComponentType<P>): void;
}

/** Minimal structural view of the DSH client context used by this module. */
interface ClientContext {
  locale: LocaleService;
  effect(fn: () => void | (() => void), label: string): unknown;
  on(event: string, handler: (snapshot?: ThemeSnapshot) => void): (() => void) | undefined;
  slots: SlotService;
  theme?: {
    getTheme?(): ThemeSnapshot | undefined;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSettingsPayload(value: unknown): value is SettingsPayload {
  return isRecord(value) && isRecord(value.settings);
}

function errorText(value: unknown): string | undefined {
  const error = isRecord(value) ? value.error : undefined;
  return error ? String(error) : undefined;
}

function describeError(error: unknown): string {
  const message = isRecord(error) ? error.message : undefined;
  return message ? String(message) : String(error);
}

function isRemoteClient(value: unknown): value is RemoteClient {
  return isRecord(value) && typeof value.id === 'string' && typeof value.ip === 'string' && typeof value.connectedAt === 'number';
}

function readClients(value: unknown): RemoteClient[] {
  const list: unknown[] = isRecord(value) && Array.isArray(value.clients) ? value.clients : [];
  return list.filter(isRemoteClient);
}

const NS = 'dsh-remote-control';
const PANEL_ID = 'remote-control';
const SETTINGS_URL = '/dsh-remote-control/api/settings';
const APP_NAMES_URL = '/dsh-remote-control/api/apps';
const LOCATION_URL = '/dsh-remote-control/api/location';
const THEME_URL = '/dsh-remote-control/api/theme';
const TOKEN_URL = '/dsh-remote-control/api/token/rotate';
const DISCONNECT_URL = '/dsh-remote-control/api/disconnect';

const PAGE_LABELS: Record<string, string> = { home: '首页', sessions: '会话', music: '音乐' };
const PAGE_ORDER: string[] = ['home', 'sessions', 'music', 'performance'];
const normalizePageOrder = (input: unknown): string[] => {
  const values: unknown[] = Array.isArray(input) ? input : [];
  const keys = values.filter((key): key is string => typeof key === 'string' && PAGE_ORDER.includes(key));
  const order = [...new Set(keys)];
  for (const key of PAGE_ORDER) if (!order.includes(key)) order.push(key);
  return order.slice(0, PAGE_ORDER.length);
};

const CSS = `
      .drc-page {
        height: 100%;
        max-height: none;
        min-height: 0;
        display: flex;
        flex-direction: column;
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-base);
        overflow: hidden;
      }
      .drc-head {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        padding: 18px 26px 14px;
      }
      .drc-kicker {
        display: none;
      }
      .drc-head h1 {
        margin: 0 0 2px;
        font-size: 21px;
        line-height: 1.12;
        letter-spacing: -.025em;
        font-weight: 620;
      }
      .drc-head p {
        margin: 0;
        color: var(--dsw-alias-label-secondary);
        font-size: 11.5px;
        line-height: 1.5;
      }
      .drc-head-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
      .drc-body {
        flex: 1 1 auto;
        min-height: 0;
        display: grid;
        grid-template-columns: 216px minmax(0, 1fr);
        border-top: 1px solid var(--dsw-alias-border-l1);
        overflow: hidden;
      }
      .drc-menu {
        min-height: 0;
        overflow-y: auto;
        padding: 12px 10px 20px;
        border-right: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-layer-1);
      }
      .drc-menu-group { margin-bottom: 12px; }
      .drc-menu-parent {
        display: block;
        padding: 8px 10px 5px;
        color: var(--dsw-alias-label-secondary);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: .1em;
        text-transform: uppercase;
      }
      .drc-menu-item {
        width: 100%;
        min-height: 38px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 10px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font-size: 12px;
        text-align: left;
        cursor: pointer;
      }
      .drc-menu-item svg { width: 16px; height: 16px; flex: 0 0 auto; color: var(--dsw-alias-label-secondary); }
      .drc-menu-item.is-active {
        background: var(--dsw-alias-bg-layer-2);
        box-shadow: inset 2px 0 0 var(--dsw-alias-brand-primary);
        font-weight: 620;
      }
      .drc-menu-item.is-active svg { color: var(--dsw-alias-brand-primary); }
      .drc-main {
        min-height: 0;
        overflow-y: auto;
        padding: 20px 26px 44px;
        scrollbar-width: thin;
      }
      .drc-main::-webkit-scrollbar { width: 8px; }
      .drc-main::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-l2); border-radius: 999px; }
      .drc-section { max-width: 760px; }
      .drc-section h2 { margin: 0; font-size: 20px; letter-spacing: -.02em; font-weight: 620; }
      .drc-desc { margin: 5px 0 14px; color: var(--dsw-alias-label-secondary); font-size: 11.5px; line-height: 1.6; }
      .drc-section > .drc-desc, .drc-page-desc { margin: 6px 0 18px; max-width: 680px; font-size: 12px; line-height: 1.65; }
      .drc-card {
        margin-top: 12px;
        padding: 16px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 14px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .drc-card + .drc-card { margin-top: 10px; }
      .drc-card h3 { margin: 0 0 5px; font-size: 16px; font-weight: 620; letter-spacing: -.01em; }
      .drc-card .drc-desc { margin: 0 0 12px; font-size: 11px; line-height: 1.55; }
      .drc-muted { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.55; }
      .drc-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 10px 0;
        border-top: 1px solid var(--dsw-alias-border-l1);
      }
      .drc-row:first-of-type { border-top: 0; padding-top: 2px; }
      .drc-row-title { font-size: 12px; font-weight: 600; }
      .drc-row-desc { margin-top: 3px; color: var(--dsw-alias-label-secondary); font-size: 10.5px; line-height: 1.5; }
      .drc-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      .drc-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        min-height: 34px;
        padding: 0 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 9px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
      }
      .drc-btn.is-primary { border-color: transparent; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
      .drc-btn.is-danger { border-color: transparent; background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); color: var(--dsw-alias-state-error-primary); }
      .drc-btn:disabled { opacity: .45; cursor: default; }
      .drc-toggle {
        width: 42px; height: 24px; padding: 0; border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 999px; background: var(--dsw-alias-bg-layer-2); position: relative; cursor: pointer; flex: 0 0 auto;
      }
      .drc-toggle i {
        position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%;
        background: var(--dsw-alias-label-secondary); transition: left .16s ease, background .16s ease;
      }
      .drc-toggle.is-on { border-color: transparent; background: var(--dsw-alias-brand-primary); }
      .drc-toggle.is-on i { left: 21px; background: var(--dsw-alias-bg-base); }
      .drc-seg { display: inline-flex; width: auto; max-width: 100%; flex-wrap: wrap; gap: 4px; padding: 4px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); }
      .drc-seg button {
        min-height: 31px; padding: 0 10px; border: 0; border-radius: 7px; background: transparent;
        color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 550; cursor: pointer;
      }
      .drc-seg button.is-active { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); font-weight: 650; }
      .drc-fields { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
      .drc-field { display: flex; flex-direction: column; gap: 5px; flex: 1 1 190px; min-width: 0; }
      .drc-field span { color: var(--dsw-alias-label-secondary); font-size: 10px; }
      .drc-field input {
        width: 100%; height: 36px; padding: 0 10px; box-sizing: border-box;
        border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
        background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
        outline: none; font-size: 11.5px;
      }
      .drc-field input:focus { border-color: var(--dsw-alias-brand-primary); }
      .drc-list { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
      .drc-list-row {
        display: flex; align-items: center; gap: 9px; padding: 7px 9px;
        border-radius: 8px; background: var(--dsw-alias-bg-layer-2); font-size: 11.5px;
      }
      .drc-list-row label { display: flex; align-items: center; gap: 9px; flex: 1; cursor: pointer; }
      .drc-code { color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 9.5px; }
      .drc-qr {
        display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
      }
      .drc-qr-frame {
        width: 164px; height: 164px; flex: 0 0 auto; padding: 7px; box-sizing: border-box;
        border-radius: 12px; background: #fff; display: grid; place-items: center;
        box-shadow: 0 8px 24px rgba(0,0,0,.14);
      }
      .drc-qr-frame img { width: 150px; height: 150px; display: block; image-rendering: pixelated; }
      .drc-qr-copy { min-width: 220px; flex: 1 1 280px; }
      .drc-url {
        display: block; margin-top: 10px; padding: 9px 10px; border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px; color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.45;
        word-break: break-all; overflow-wrap: anywhere; white-space: pre-wrap; max-height: 62px; overflow: hidden;
      }
      .drc-apps { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      .drc-app {
        display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 10px;
        border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px;
        background: transparent; color: var(--dsw-alias-label-secondary); font-size: 10.5px; cursor: pointer;
      }
      .drc-app.is-on { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent); }
      .drc-app i { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-label-secondary); }
      .drc-app.is-on i { background: var(--dsw-alias-brand-primary); }
      .drc-map-row {
        display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 9px;
        border-radius: 8px; background: var(--dsw-alias-bg-layer-2);
      }
      .drc-map-row + .drc-map-row { margin-top: 6px; }
      .drc-map-main { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 3px; }
      .drc-map-input {
        width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 11.5px;
      }
      .drc-map-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
      .drc-map-key { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
      .drc-map-meta { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; }
      .drc-tag {
        padding: 2px 6px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1);
        color: var(--dsw-alias-label-secondary); font-size: 9px; white-space: nowrap;
      }
      .drc-order-row { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); font-size: 11.5px; cursor: grab; transition: opacity .15s ease, border-color .15s ease; touch-action: none; }
      .drc-order-row.is-dragging { position: absolute; width: 0; height: 0; min-height: 0; margin: 0; padding: 0; border: 0; opacity: 0; visibility: hidden; overflow: hidden; pointer-events: none; transition: none; }
      .drc-order-row b { width: 18px; color: var(--dsw-alias-label-secondary); font-family: ui-monospace, monospace; font-size: 10px; font-weight: 500; }
      .drc-order-row .drc-order-label { flex: 1; }
      .drc-drag-handle { color: var(--dsw-alias-label-secondary); font-size: 12px; letter-spacing: -2px; cursor: grab; }
      .drc-order-placeholder { height: 37px; display: flex; align-items: center; gap: 8px; padding: 0 10px; border: 1px dashed var(--dsw-alias-brand-primary, #4d6bff); border-radius: 8px; background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bff) 9%, transparent); pointer-events: none; }
      .drc-order-placeholder-title { color: var(--dsw-alias-brand-primary, #4d6bff); font-size: 11.5px; font-weight: 600; }
      .drc-order-placeholder .drc-drag-handle { color: var(--dsw-alias-brand-primary, #4d6bff); cursor: grabbing; }
      body.drc-sorting,
      body.drc-sorting * { user-select: none !important; cursor: grabbing !important; }
      .drc-order-end { height: 14px; }
      .drc-status-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 11.5px; }
      .drc-status-row:first-child { border-top: 0; }
      .drc-status { display: inline-flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 10.5px; }
      .drc-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
      .drc-dot.ok { background: var(--dsw-alias-state-success-primary); }
      .drc-dot.bad { background: var(--dsw-alias-state-error-primary); }
      .drc-client { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 10px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); }
      .drc-client strong { display: block; font-size: 11.5px; font-weight: 620; }
      .drc-client small { display: block; margin-top: 2px; color: var(--dsw-alias-label-secondary); font-size: 9.5px; font-family: ui-monospace, monospace; }
      .drc-banner { margin: 0 26px 8px; padding: 9px 11px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; font-size: 11px; }
      .drc-banner.is-error { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent); }
      .drc-banner.is-ok { color: var(--dsw-alias-state-success-primary); }
      .drc-facts { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 8px; color: var(--dsw-alias-label-secondary); font-size: 10.5px; }
      @media (max-width: 760px) {
        .drc-body { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
        .drc-menu { display: flex; gap: 14px; overflow-x: auto; overflow-y: hidden; border-right: 0; border-bottom: 1px solid var(--dsw-alias-border-l1); padding: 8px 10px; }
        .drc-menu-group { margin-bottom: 0; display: flex; align-items: center; gap: 4px; }
        .drc-menu-parent { padding: 0 6px; white-space: nowrap; }
        .drc-menu-item { width: auto; white-space: nowrap; }
        .drc-head { padding: 16px 18px 10px; }
        .drc-main { padding: 16px 18px 36px; }
      }
    `;

const zh: Record<string, string> = {
  title: '远程控制台', kicker: 'REMOTE CONSOLE', heading: '远程控制台',
  subtitle: '手机控制台的连接、显示与数据偏好。', running: '运行中', stopped: '未运行',
  refresh: '刷新', save: '保存', saved: '已保存', error: '操作失败', loading: '正在读取设置…',
  pairing: '扫码连接', pairingHint: '手机与电脑连接同一个局域网，扫描二维码即可打开。',
  open: '在电脑上打开', copy: '复制链接', copied: '已复制', connection: '连接',
  menuPlugin: '插件设置', menuNetwork: '开放网卡', menuAccess: '访问验证', menuTheme: '主题与页面', menuTls: 'HTTPS 证书',
  menuWeather: '天气设置', menuBalance: '余额显示', menuNotifications: '通知设置', menuSystem: '系统信息',
  menuStatus: '服务状态', menuClients: '已连接设备', menuDiagnostics: '诊断信息',
  network: '开放网卡', networkHint: '只有勾选网卡所在网段的设备可以访问控制台。',
  pluginHint: '手机端的访问方式、温度单位、主题、页面顺序与 HTTPS 证书；修改后点击保存设置生效。',
  access: '访问验证', accessHint: '开启后，手机首次打开需要扫描带验证令牌的链接。',
  token: '链接验证', rotate: '立即刷新验证令牌', rotateHint: '刷新后已连接设备会断开，需要重新扫码。',
  theme: '主题与页面', themeHint: '选择手机控制台跟随 DSH 主题，或固定亮暗模式。',
  temperatureUnit: '温度单位', temperatureUnitHint: '手机端天气和性能页使用的温度显示单位。', celsius: '摄氏度 (°C)', fahrenheit: '华氏度 (°F)',
  followDsh: '跟随 DSH', light: '浅色', dark: '深色',
  pageOrder: '页面顺序', pageOrderHint: '拖拽调整手机端四个页面的左右顺序；关闭的页面不会在后台轮询。',
  tls: 'HTTPS 证书', tlsHint: '可选。填写 PEM 证书和私钥路径后启用 HTTPS；保存后连接会短暂中断。',
  certPath: '证书路径', keyPath: '私钥路径', saveTls: '保存证书配置',
  tlsOn: 'HTTPS 已启用', tlsOff: 'HTTPS 未启用', tlsError: '证书配置有误，当前仍使用 HTTP',
  weather: '天气设置', weatherHint: '自动定位优先使用本机位置；也可以固定一个城市。',
  forecastDisplay: '天气卡片显示', hourly: '小时天气', daily: '7 天天气',
  saveSettings: '保存设置', pagePerformance: '性能',
  auto: '本机位置', manual: '手动位置', locationName: '位置名称', latitude: '纬度', longitude: '经度', saveLocation: '保存位置',
  balance: '余额显示', balanceHint: '选择本周（日历）或最近 7 天（滚动）作为消耗统计窗口。',
  calendar: '本周（日历）', rolling: '最近 7 天（滚动）', lowThreshold: '低余额提醒线',
  lowThresholdHint: '低于这个金额时，手机端余额会显示为红色。留空关闭提醒。', saveThreshold: '保存提醒线',
  notifications: '通知设置', notificationsHint: '所有应用默认接收通知；取消勾选的应用不会显示在手机端。',
  allApps: '全部显示', limit: '显示数量', noApps: '还没有记录到通知应用。',
  status: '服务状态', statusHint: '当前系统服务能力。', clients: '已连接设备', clientsHint: '正在访问控制台的手机或浏览器。', noClients: '当前没有已连接设备。', disconnect: '断开',
  diagnostics: '诊断信息', systemName: '系统', version: '版本', protocol: '连接方式', clientCount: '设备数量',
  notificationsStatus: '通知', mediaStatus: '媒体', volumeStatus: '音量', weatherStatus: '天气',
  healthy: '正常', unavailable: '不可用', checking: '待检测',
  pageHome: '首页', pageSessions: '会话', pageMusic: '音乐', moveUp: '上移', moveDown: '下移',
  noWebServer: '当前部署没有可用的 webServer。', serviceRunning: '服务运行中', serviceStopped: '服务未运行',
};
const en: Record<string, string> = { ...zh, title: 'Remote control', heading: 'Remote control', subtitle: 'Connection, display, and data preferences for the phone console.', running: 'Running', stopped: 'Stopped', refresh: 'Refresh', save: 'Save', saved: 'Saved', error: 'Action failed', loading: 'Reading settings…', pairing: 'Scan to connect', pairingHint: 'Connect the phone to the same LAN and scan the QR code.', open: 'Open on this computer', copy: 'Copy link', copied: 'Copied', connection: 'Connection', menuPlugin: 'Plugin settings', menuNetwork: 'Open interfaces', menuAccess: 'Access verification', menuTheme: 'Theme & pages', menuTls: 'HTTPS certificate', menuWeather: 'Weather', menuBalance: 'Balance display', menuNotifications: 'Notifications', menuSystem: 'System information', menuStatus: 'Service status', menuClients: 'Connected devices', menuDiagnostics: 'Diagnostics', network: 'Open network interfaces', networkHint: 'Only devices on the checked interface subnets can access the console.', pluginHint: 'Access, temperature unit, theme, page order, and HTTPS for the phone console; changes apply after Save.', access: 'Access verification', accessHint: 'When enabled, the first open requires a link with a verification token.', token: 'Link verification', rotate: 'Rotate verification token', rotateHint: 'Rotating disconnects existing devices; scan again to reconnect.', theme: 'Theme & pages', themeHint: 'Follow DSH, or force light or dark mode on the phone console.', temperatureUnit: 'Temperature unit', temperatureUnitHint: 'Temperature unit used by the phone weather and performance pages.', celsius: 'Celsius (°C)', fahrenheit: 'Fahrenheit (°F)', followDsh: 'Follow DSH', light: 'Light', dark: 'Dark', pageOrder: 'Page order', pageOrderHint: 'Drag to reorder the four phone pages; disabled pages stop polling.', tls: 'HTTPS certificate', tlsHint: 'Optional. Provide PEM certificate and key paths, then enable HTTPS. Saving briefly drops connections.', certPath: 'Certificate path', keyPath: 'Private key path', saveTls: 'Save certificate', tlsOn: 'HTTPS enabled', tlsOff: 'HTTPS disabled', tlsError: 'Certificate error; still serving HTTP', weather: 'Weather', weatherHint: 'Automatic uses this computer location; or pin a city.', auto: 'This computer', manual: 'Manual', locationName: 'Location name', latitude: 'Latitude', longitude: 'Longitude', saveLocation: 'Save location', balance: 'Balance display', balanceHint: 'Choose the current week (calendar) or the latest 7 days (rolling) as the spend window.', calendar: 'This week (calendar)', rolling: 'Last 7 days (rolling)', lowThreshold: 'Low-balance warning', lowThresholdHint: 'Show the phone balance in red below this amount. Leave empty to disable.', saveThreshold: 'Save warning', notifications: 'Notifications', notificationsHint: 'All apps are enabled by default. Unchecked apps are hidden on the phone.', allApps: 'Show all', limit: 'Visible count', noApps: 'No notification apps recorded yet.', status: 'Service status', statusHint: 'Current system service capabilities.', clients: 'Connected devices', clientsHint: 'Phones or browsers currently using the console.', noClients: 'No device is connected.', disconnect: 'Disconnect', diagnostics: 'Diagnostics', systemName: 'System', version: 'Version', protocol: 'Transport', clientCount: 'Devices', notificationsStatus: 'Notifications', mediaStatus: 'Media', volumeStatus: 'Volume', weatherStatus: 'Weather', healthy: 'Healthy', unavailable: 'Unavailable', checking: 'Not checked', pageHome: 'Home', pageSessions: 'Sessions', pageMusic: 'Music', moveUp: 'Move up', moveDown: 'Move down', noWebServer: 'This deployment has no webServer.', serviceRunning: 'Service running', serviceStopped: 'Service stopped', forecastDisplay: 'Weather card', hourly: 'Hourly', daily: '7 days', saveSettings: 'Save settings', pagePerformance: 'Performance' };

const extraZh: Record<string, string> = {
  menuPlugin: '偏好设置',
  menuPomodoro: '番茄钟设置',
  connectionHint: '扫码配对、可访问的网卡、访问验证与 HTTPS 证书。',
  preferencesHint: '手机端的温度单位、主题、页面顺序与导航栏位置；修改后点击保存设置生效。',
  navPosition: '导航栏位置',
  navPositionHint: '选择手机控制台导航栏停靠在屏幕的哪一侧。',
  navLeft: '左侧', navRight: '右侧', navTop: '上方', navBottom: '下方',
  pomodoro: '番茄钟设置',
  pomodoroHint: '手机端番茄钟的启用、时长、提示音与循环响铃。',
  pomodoroEnable: '启用番茄钟',
  pomodoroEnableHint: '开启后，时钟下方会出现番茄钟卡片。',
  pomodoroFocus: '专注时长（分钟）',
  pomodoroBreak: '休息时长（分钟）',
  pomodoroSound: '提示音文件',
  pomodoroSoundHint: '留空则使用内置的轻柔提示音；也可以填写本机音频文件路径或 http(s) 链接。',
  pomodoroSoundPlaceholder: '例如：D:\\sounds\\chime.mp3',
  pomodoroBuiltin: '内置提示音',
  pomodoroLoop: '循环响铃直到停止',
  pomodoroLoopHint: '开启后，时间到的提示音会循环播放，直到在手机端点击「停止响铃」才停止；关闭时只播放一次。',
  peakValley: '显示梁文峰 / 梁文谷',
  peakValleyHint: '在余额卡片右下角按当前计费时段显示淡色图标：工作日 9:00–12:00、14:00–18:00 为梁文峰（高峰），其余时间及节假日全天为梁文谷（空闲，价格为高峰的一半）。判断在手机浏览器中完成，节假日数据从 timor.tech 获取。',
  menuAppMapping: '软件映射',
  appMapping: '软件映射',
  appMappingHint: '通知与音乐播放里显示的应用名称。这里是所有在系统里出现过的应用，修改后立即保存，并同时用于手机端通知和音乐来源。',
  sourceNotification: '通知',
  sourceMusic: '音乐',
  resetName: '恢复默认',
  locationPermission: '定位权限',
  locationPermissionHint: 'Windows 定位需要系统隐私授权。点击下面的按钮申请定位权限；如果被拒绝，会自动打开系统「位置」设置页。开启「位置服务」和「允许桌面应用访问你的位置」后重试即可。',
  locationRequest: '请求定位权限',
  locationRequesting: '正在请求…',
  locationAllowed: '定位权限已授予，天气会自动使用本机位置。',
  locationPrivacyDenied: '系统拒绝了定位权限，已打开「位置」设置页；请开启「位置服务」和「允许桌面应用访问你的位置」后重试。',
  locationLowIntegrity: '探针正以低完整性级别运行，Windows 会拒绝定位。请用普通终端重新执行 pnpm build:rust（或参考 INSTALLATION.md 的修复指南）。',
  locationUnspecified: '系统还没有授予定位权限，已打开设置页，请手动开启后重试。',
  locationFailed: '定位权限请求失败，请稍后重试。',
  locationStatus: '当前状态',
  accessAllowed: '已授权', accessDenied: '已拒绝', accessUnspecified: '未授权', accessUnknown: '未知',
  pushQuestions: '推送问询',
  pushQuestionsHint: '开启后，会话进入等待回答时会推送完整的问题和选项。手机控制台的会话页点击该会话，会弹出悬浮框，可直接点选选项或填写自定义回复。',
  tlsEnable: '启用 HTTPS',
  pomodoroTimer: '番茄钟',
  pomodoroTimerHint: '启用后显示在手机端时钟下方；设置专注与休息时长。',
  weatherPageHint: '手机端天气的位置来源、显示方式与定位权限。',
  weatherSource: '天气位置',
  forecastDisplayHint: '选择天气卡片展示小时预报还是 7 天预报。',
  balancePageHint: '手机端余额卡片的统计窗口、低余额提醒与峰谷标记。',
  balanceSpend: '消耗统计',
  peakValleyBlock: '峰谷标记',
  peakValleyToggle: '显示峰谷标记',
  notificationsPageHint: '手机端通知卡片的推送、可见应用与显示数量。',
  notificationApps: '通知应用',
  pushQuestionsToggle: '允许远程回答',
  limitDisplay: '显示数量',
  limitField: '数量',
  notificationLimitHint: '手机端通知卡片最多显示的通知数量（1–20）。',
  appsPageHint: '手机端通知和音乐里显示的应用名称；修改后立即保存。',
  appNamesBlock: '应用名称',
  systemPageHint: '服务运行状态、已连接设备与诊断信息。',
  diagnosticsHint: '版本、协议与已连接设备数量。',
};
const extraEn: Record<string, string> = {
  menuPlugin: 'Preferences',
  menuPomodoro: 'Pomodoro',
  connectionHint: 'Pairing, reachable interfaces, access verification, and the HTTPS certificate.',
  preferencesHint: 'Temperature unit, theme, page order, and navigation placement for the phone console; save to apply.',
  navPosition: 'Navigation bar',
  navPositionHint: 'Choose which screen edge hosts the phone console navigation bar.',
  navLeft: 'Left', navRight: 'Right', navTop: 'Top', navBottom: 'Bottom',
  pomodoro: 'Pomodoro',
  pomodoroHint: 'Enable, duration, alert sound, and looping for the phone pomodoro.',
  pomodoroEnable: 'Enable pomodoro',
  pomodoroEnableHint: 'Show a pomodoro card below the clock.',
  pomodoroFocus: 'Focus minutes',
  pomodoroBreak: 'Break minutes',
  pomodoroSound: 'Alert sound',
  pomodoroSoundHint: 'Leave empty for the built-in gentle chime, or use a local audio file path or http(s) URL.',
  pomodoroSoundPlaceholder: 'e.g. D:\\sounds\\chime.mp3',
  pomodoroBuiltin: 'Built-in chime',
  pomodoroLoop: 'Loop until stopped',
  pomodoroLoopHint: 'When enabled, the end-of-timer sound repeats until you click Stop ringing on the phone. When disabled, it plays once.',
  peakValley: 'Show peak / valley',
  peakValleyHint: 'Show a faint tariff icon in the balance card corner: weekdays 9:00–12:00 and 14:00–18:00 are Liang Wenfeng (peak); all other times and holidays are Liang Wengu (off-peak at half price). The browser judges this and loads holiday data from timor.tech.',
  menuAppMapping: 'App names',
  appMapping: 'App names',
  appMappingHint: 'Display names used by notifications and media. Every app seen on this system is listed; a rename saves immediately and applies to both phone notifications and the music source label.',
  sourceNotification: 'Notification',
  sourceMusic: 'Music',
  resetName: 'Reset',
  locationPermission: 'Location permission',
  locationPermissionHint: 'Windows location access needs a privacy grant. The button asks for permission; when it is denied, the system Location settings page opens. Enable "Location services" and "Let desktop apps access your location", then retry.',
  locationRequest: 'Request location access',
  locationRequesting: 'Requesting…',
  locationAllowed: 'Location access granted; weather will use this computer position.',
  locationPrivacyDenied: 'Windows denied location access and the Settings page was opened; enable "Location services" and "Let desktop apps access your location", then retry.',
  locationLowIntegrity: 'The probe is running at low integrity, which Windows rejects for location. Rebuild it from a normal terminal (pnpm build:rust) or follow the INSTALLATION.md repair guide.',
  locationUnspecified: 'Location access has not been granted yet; the Settings page was opened.',
  locationFailed: 'The location permission request failed; try again later.',
  locationStatus: 'Current status',
  accessAllowed: 'Allowed', accessDenied: 'Denied', accessUnspecified: 'Not granted', accessUnknown: 'Unknown',
  pushQuestions: 'Push inquiries',
  pushQuestionsHint: 'When enabled, a session waiting for an answer pushes the complete question and options. Tapping that session on the phone opens a floating sheet where you can choose an option or type a custom reply.',
  tlsEnable: 'Enable HTTPS',
  pomodoroTimer: 'Pomodoro timer',
  pomodoroTimerHint: 'Show the timer below the clock and set focus and break lengths.',
  weatherPageHint: 'Location source, display mode, and location permission for the phone weather page.',
  weatherSource: 'Weather location',
  forecastDisplayHint: 'Choose hourly or 7-day forecast for the weather card.',
  balancePageHint: 'Spend window, low-balance alert, and peak/off-peak marker for the phone balance card.',
  balanceSpend: 'Spend window',
  peakValleyBlock: 'Peak / off-peak marker',
  peakValleyToggle: 'Show peak/off-peak marker',
  notificationsPageHint: 'Push questions, visible apps, and display limit for phone notifications.',
  notificationApps: 'Notification apps',
  pushQuestionsToggle: 'Allow remote answers',
  limitDisplay: 'Display limit',
  limitField: 'Count',
  notificationLimitHint: 'Maximum number of notifications shown on the phone card (1–20).',
  appsPageHint: 'App names shown in phone notifications and media; changes save immediately.',
  appNamesBlock: 'App names',
  systemPageHint: 'Service status, connected devices, and diagnostics.',
  diagnosticsHint: 'Version, protocol, and connected device count.',
};
Object.assign(zh, extraZh);
Object.assign(en, extraEn);

const C = {
  text: 'var(--dsw-alias-label-primary)',
  muted: 'var(--dsw-alias-label-secondary)',
  border: 'var(--dsw-alias-border-l1)',
  layer1: 'var(--dsw-alias-bg-layer-1)',
  layer2: 'var(--dsw-alias-bg-layer-2)',
  accent: 'var(--dsw-alias-brand-primary)',
  success: 'var(--dsw-alias-state-success-primary)',
  error: 'var(--dsw-alias-state-error-primary)',
  idle: 'var(--dsw-alias-state-idle-primary)',
};

function PanelIcon({ size = 20, active = false }: PanelIconProps): React.ReactElement {
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, style: { display: 'block', color: active ? C.accent : 'currentColor' } },
    h('rect', { x: 4.2, y: 2.8, width: 15.6, height: 18.4, rx: 4, stroke: 'currentColor', strokeWidth: 1.7 }),
    h('path', { d: 'M9.3 18.1h5.4', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
    h('circle', { cx: 12, cy: 10.5, r: 3.5, stroke: 'currentColor', strokeWidth: 1.7 }),
    h('path', { d: 'M2.6 8.2c-1 1.1-1.5 2.3-1.5 3.6 0 1.4.5 2.6 1.5 3.7M21.4 8.2c1 1.1 1.5 2.3 1.5 3.6 0 1.4-.5 2.6-1.5 3.7', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', opacity: 0.7 }),
  );
}

const MENU_ICONS: Record<string, string> = {
  link: '<path d="M9.5 14.5 14.5 9.5M7.1 16.9a3.5 3.5 0 0 1 0-5l2.1-2.1M16.9 7.1a3.5 3.5 0 0 1 0 5l-2.1 2.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="16" cy="7" r="2.4" stroke="currentColor" stroke-width="1.7"/><circle cx="8" cy="17" r="2.4" stroke="currentColor" stroke-width="1.7"/>',
  cloud: '<path d="M6.5 18h10.2a4.3 4.3 0 0 0 .7-8.5A5.5 5.5 0 0 0 7 8.6 4.7 4.7 0 0 0 6.5 18Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  wallet: '<rect x="3.5" y="6" width="17" height="13" rx="3" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 10h17M16 14.5h2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  bell: '<path d="M6 10a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6ZM10 20h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  apps: '<rect x="3.5" y="3.5" width="7.2" height="7.2" rx="1.8" stroke="currentColor" stroke-width="1.7"/><rect x="13.3" y="3.5" width="7.2" height="7.2" rx="1.8" stroke="currentColor" stroke-width="1.7"/><rect x="3.5" y="13.3" width="7.2" height="7.2" rx="1.8" stroke="currentColor" stroke-width="1.7"/><rect x="13.3" y="13.3" width="7.2" height="7.2" rx="1.8" stroke="currentColor" stroke-width="1.7"/>',
  timer: '<circle cx="12" cy="13.5" r="7" stroke="currentColor" stroke-width="1.7"/><path d="M12 9.5v4l2.8 1.7M9 2.8h6M12 2.8v2.2M18.8 6.2l1.5-1.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  info: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7"/><path d="M12 11v6M12 7.2v.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
};

function MenuIcon({ name }: MenuIconProps): React.ReactElement {
  return h('svg', { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, dangerouslySetInnerHTML: { __html: MENU_ICONS[name] || MENU_ICONS.info } });
}

function Toggle({ checked, onChange, label }: ToggleProps): React.ReactElement {
  return h('button', { type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label, className: `drc-toggle${checked ? ' is-on' : ''}`, onClick: () => onChange(!checked) }, h('i'));
}

function Seg({ options, value, onChange }: SegProps): React.ReactElement {
  return h('div', { className: 'drc-seg' }, options.map((option) => h('button', { key: option.value, type: 'button', className: value === option.value ? 'is-active' : '', onClick: () => onChange(option.value) }, option.label)));
}

function Btn({ children, onClick, primary = false, danger = false, disabled = false }: BtnProps): React.ReactElement {
  return h('button', { type: 'button', className: `drc-btn${primary ? ' is-primary' : ''}${danger ? ' is-danger' : ''}`, onClick, disabled }, children);
}

function Field({ label, value, onChange, placeholder, inputMode }: FieldProps): React.ReactElement {
  return h('label', { className: 'drc-field' }, h('span', null, label), h('input', { value: value ?? '', placeholder, inputMode, onChange: (event) => onChange(event.target.value) }));
}

function Row({ title, description, children }: RowProps): React.ReactElement {
  return h('div', { className: 'drc-row' },
    h('div', { style: { minWidth: 0 } }, h('div', { className: 'drc-row-title' }, title), description ? h('div', { className: 'drc-row-desc' }, description) : null),
    h('div', { style: { flex: '0 0 auto' } }, children),
  );
}

function StatusRow({ label, value }: StatusRowProps): React.ReactElement {
  const state = value === true ? 'ok' : value === false ? 'bad' : '';
  return h('div', { className: 'drc-status-row' }, h('span', null, label), h('span', { className: 'drc-status' }, h('i', { className: `drc-dot ${state}` }), state === 'ok' ? '正常' : state === 'bad' ? '不可用' : '待检测'));
}

function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分`;
}

function RemotePanel(): React.ReactElement {
  const t = (key: string): string => zh[key] ?? en[key] ?? key;
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [section, setSection] = useState('connection');
  const [draft, setDraft] = useState<DraftState>({ certPath: '', keyPath: '', locationName: '', latitude: '', longitude: '', threshold: '', notificationLimit: '5', pomodoroFocus: '25', pomodoroBreak: '5', pomodoroSound: '' });
  const [selectedInterfaces, setSelectedInterfaces] = useState<string[]>([]);
  const [selectedApps, setSelectedApps] = useState<string[]>([]);
  const [appNames, setAppNames] = useState<Record<string, string>>({});
  const [appBusyKey, setAppBusyKey] = useState('');
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationResult, setLocationResult] = useState<{ allowed: boolean; access: string; reason: string | null; lowIntegrity: boolean; openedSettings: boolean } | null>(null);
  const [staged, setStaged] = useState<StagedSettings>({});
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const orderListRef = useRef<HTMLDivElement | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    dragCleanupRef.current?.();
    dragCleanupRef.current = null;
  }, []);

  const hydrate = useCallback((payload: unknown): void => {
    if (!isSettingsPayload(payload)) return;
    setData(payload);
    setStaged({});
    const names = [...new Set((payload.interfaces ?? []).map((entry) => entry.name))];
    setSelectedInterfaces(payload.settings.allowedInterfaces === null ? names : [...payload.settings.allowedInterfaces]);
    const appKeys = (payload.apps ?? []).map((app) => app.key);
    const enabled = payload.settings.notifications?.enabledApps ?? [];
    setSelectedApps(enabled.length ? enabled.filter((key) => appKeys.includes(key)) : appKeys);
    setAppNames(Object.fromEntries((payload.apps ?? []).map((app) => [app.key, app.name])));
    setDraft({
      certPath: payload.settings.tls?.certPath ?? '',
      keyPath: payload.settings.tls?.keyPath ?? '',
      locationName: payload.settings.weather?.name ?? '',
      latitude: payload.settings.weather?.latitude ?? '',
      longitude: payload.settings.weather?.longitude ?? '',
      threshold: payload.settings.balance?.lowThreshold ?? '',
      notificationLimit: String(payload.settings.notifications?.limit ?? 5),
      pomodoroFocus: String(payload.settings.pomodoro?.focusMinutes ?? 25),
      pomodoroBreak: String(payload.settings.pomodoro?.breakMinutes ?? 5),
      pomodoroSound: payload.settings.pomodoro?.soundPath ?? '',
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(SETTINGS_URL, { credentials: 'same-origin', cache: 'no-store' });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorText(payload) || `HTTP ${response.status}`);
      hydrate(payload);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [hydrate]);

  const save = useCallback(async (patch: SavePatch): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(SETTINGS_URL, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorText(payload) || `HTTP ${response.status}`);
      hydrate(payload);
      setNotice(t('saved'));
      setTimeout(() => setNotice(''), 1600);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }, [hydrate, t]);

  const stage = useCallback((patch: StagedSettings): void => {
    setStaged((current) => {
      const merge = (left: unknown, right: unknown): StagedSettings => {
        const next: Record<string, unknown> = { ...(isRecord(left) ? left : {}) };
        for (const [key, value] of Object.entries(isRecord(right) ? right : {})) {
          if (value && typeof value === 'object' && !Array.isArray(value)) next[key] = merge(next[key], value);
          else next[key] = value;
        }
        return next as StagedSettings;
      };
      return merge(current, patch);
    });
  }, []);

  useEffect(() => { void load(); }, [load]);

  const copy = async () => {
    const url = data?.info?.routes?.remote || '';
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError(t('error'));
    }
  };

  const rotate = async () => {
    setBusy(true);
    try {
      const response = await fetch(TOKEN_URL, { method: 'POST', credentials: 'same-origin' });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorText(payload) || `HTTP ${response.status}`);
      hydrate(payload);
      setNotice(t('saved'));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const saveAppName = async (key: string, name: string): Promise<void> => {
    setAppBusyKey(key);
    setError('');
    try {
      const response = await fetch(APP_NAMES_URL, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, name }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorText(payload) || `HTTP ${response.status}`);
      hydrate(payload);
      setNotice(t('saved'));
      setTimeout(() => setNotice(''), 1600);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setAppBusyKey('');
    }
  };

  const locationHint = (result: { allowed: boolean; access: string; reason: string | null }): string => {
    if (result.allowed) return t('locationAllowed');
    if (result.reason === 'low-integrity') return t('locationLowIntegrity');
    if (result.reason === 'privacy-denied') return t('locationPrivacyDenied');
    if (result.reason === 'unspecified') return t('locationUnspecified');
    return t('locationFailed');
  };

  const requestLocation = async (): Promise<void> => {
    setLocationBusy(true);
    setError('');
    try {
      const response = await fetch(LOCATION_URL, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ openSettings: true }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorText(payload) || `HTTP ${response.status}`);
      const record = isRecord(payload) ? payload : {};
      const result = {
        allowed: record.allowed === true,
        access: String(record.access || 'unknown'),
        reason: typeof record.reason === 'string' ? record.reason : null,
        lowIntegrity: record.lowIntegrity === true,
        openedSettings: record.openedSettings === true,
      };
      setLocationResult(result);
      setNotice(locationHint(result));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLocationBusy(false);
    }
  };

  const disconnect = async (id: string): Promise<void> => {
    try {
      const response = await fetch(DISCONNECT_URL, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorText(payload) || `HTTP ${response.status}`);
      const clients = readClients(payload);
      setData((current) => (current ? { ...current, clients } : current));
    } catch (err) {
      setError(describeError(err));
    }
  };

  const toggleApp = (key: string): void => {
    const all = (data?.apps ?? []).map((app) => app.key);
    const next = new Set(selectedApps);
    if (next.has(key)) next.delete(key); else next.add(key);
    if (next.size === 0) {
      setNotice('至少保留一个通知应用');
      setTimeout(() => setNotice(''), 1600);
      return;
    }
    setSelectedApps([...next]);
  };

  const toggleInterface = (name: string): void => {
    setSelectedInterfaces((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  };

  if (loading) return h('div', { style: { padding: 32, color: C.muted, fontSize: 12 } }, t('loading'));
  if (!data) return h('div', { style: { padding: 32, maxWidth: 680 } }, h('h1', null, t('heading')), h('p', { style: { color: C.error, fontSize: 12 } }, error || t('noWebServer')), h(Btn, { primary: true, onClick: () => void load() }, t('refresh')));

  const baseSettings = data.settings;
  const settings: RemoteSettings = {
    ...baseSettings,
    ...staged,
    weather: { ...(baseSettings.weather ?? {}), ...(staged.weather ?? {}) },
    balance: { ...(baseSettings.balance ?? {}), ...(staged.balance ?? {}) },
    notifications: { ...(baseSettings.notifications ?? {}), ...(staged.notifications ?? {}) },
    tls: { ...(baseSettings.tls ?? {}), ...(staged.tls ?? {}) },
    pomodoro: { ...(baseSettings.pomodoro ?? {}), ...(staged.pomodoro ?? {}) },
    pageEnabled: { ...(baseSettings.pageEnabled ?? {}), ...(staged.pageEnabled ?? {}) },
  };
  const info: RemoteInfo = data.info ?? {};
  const apps: RemoteApp[] = data.apps ?? [];
  const clients: RemoteClient[] = data.clients ?? [];
  const order = normalizePageOrder(settings.pageOrder ?? PAGE_ORDER);
  const labels: Record<string, string> = { home: t('pageHome'), sessions: t('pageSessions'), music: t('pageMusic'), performance: t('pagePerformance') };

  const computeInsertIndex = (clientY: number): number => {
    const list = orderListRef.current;
    if (!list) return 0;
    const rows = [...list.querySelectorAll<HTMLElement>('.drc-order-row:not(.is-dragging)')];
    for (let index = 0; index < rows.length; index += 1) {
      const rect = rows[index].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return index;
    }
    return rows.length;
  };

  const startOrderDrag = (key: string, event: React.PointerEvent<HTMLElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const dragTarget = event.target;
    if (dragTarget instanceof Element && dragTarget.closest('button, input, a, select, textarea')) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const originalIndex = order.indexOf(key);
    let started = false;

    const finish = (upEvent: PointerEvent): void => {
      if (upEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.classList.remove('drc-sorting');
      dragCleanupRef.current = null;
      if (!started || upEvent.type === 'pointercancel') {
        setDraggingKey(null);
        setDragIndex(null);
        return;
      }
      const remaining = order.filter((item) => item !== key);
      const insertAt = Math.max(0, Math.min(computeInsertIndex(upEvent.clientY), remaining.length));
      const next = [...remaining.slice(0, insertAt), key, ...remaining.slice(insertAt)];
      if (next.join('|') !== order.join('|')) stage({ pageOrder: next });
      setDraggingKey(null);
      setDragIndex(null);
    };

    const onMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== pointerId) return;
      if (!started) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) return;
        started = true;
        setDraggingKey(key);
        setDragIndex(originalIndex);
        document.body.classList.add('drc-sorting');
      }
      moveEvent.preventDefault();
      const next = computeInsertIndex(moveEvent.clientY);
      setDragIndex((current) => (current === next ? current : next));
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    dragCleanupRef.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.classList.remove('drc-sorting');
    };
  };

  const togglePage = (key: string): void => {
    const next: Record<string, boolean> = { ...(settings.pageEnabled ?? {}), [key]: !settings.pageEnabled?.[key] };
    if (!Object.values(next).some(Boolean)) {
      setNotice('至少保留一个页面');
      setTimeout(() => setNotice(''), 1600);
      return;
    }
    stage({ pageEnabled: next });
  };

  const saveAll = (): void => {
    const nextOrder = [...order];
    const nextWeather: WeatherSettings = {
      ...(settings.weather ?? {}),
      name: draft.locationName,
      latitude: draft.latitude === '' ? null : Number(draft.latitude),
      longitude: draft.longitude === '' ? null : Number(draft.longitude),
    };
    const patch: SavePatch = {
      allowedInterfaces: selectedInterfaces.length === [...new Set((data.interfaces ?? []).map((entry) => entry.name))].length ? null : selectedInterfaces,
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
      pageOrder: nextOrder,
      pageEnabled: settings.pageEnabled,
      tls: { enabled: Boolean(settings.tls?.enabled), certPath: draft.certPath, keyPath: draft.keyPath },
      weather: nextWeather,
      balance: { spendWindow: settings.balance?.spendWindow ?? 'calendar', lowThreshold: draft.threshold === '' ? null : Number(draft.threshold), showPeakValley: settings.balance?.showPeakValley !== false },
      notifications: {
        enabledApps: notificationApps.length > 0 && selectedApps.length === notificationApps.length ? [] : selectedApps,
        limit: Number(draft.notificationLimit),
        pushQuestions: Boolean(settings.notifications?.pushQuestions),
      },
    };
    void save(patch);
  };

  const sectionHead = (title: string, desc: string): React.ReactElement => h('div', null, h('h2', null, title), desc ? h('p', { className: 'drc-desc drc-page-desc' }, desc) : null);
  const blockHead = (title: string, desc: string): React.ReactElement => h('div', null, h('h3', null, title), desc ? h('p', { className: 'drc-desc' }, desc) : null);

  const renderConnection = (): React.ReactElement => h('div', { className: 'drc-section' },
    sectionHead(t('connection'), t('connectionHint')),
    h('div', { className: 'drc-card' },
      h('h3', null, t('pairing')),
      h('p', { className: 'drc-desc' }, t('pairingHint')),
      h('div', { className: 'drc-qr' },
        h('div', { className: 'drc-qr-frame' }, h('img', { src: info.qrPath, alt: t('pairing'), width: 150, height: 150 })),
        h('div', { className: 'drc-qr-copy' },
          h('div', { className: 'drc-actions', style: { marginTop: 0 } },
            h(Btn, { primary: true, disabled: !info.routes?.remote, onClick: () => window.open(info.routes?.remote || '', '_blank', 'noopener,noreferrer') }, t('open')),
            h(Btn, { disabled: !info.routes?.remote, onClick: () => void copy() }, copied ? t('copied') : t('copy')),
          ),
          h('code', { className: 'drc-url' }, info.routes?.remote || '—'),
          info.tls?.error ? h('p', { className: 'drc-muted', style: { color: C.error, marginTop: 8 } }, `${t('tlsError')}: ${info.tls.error}`) : null,
        ),
      ),
    ),
    networkBlock(),
    accessBlock(),
    tlsBlock(),
  );

  const networkBlock = (): React.ReactElement => h('div', { className: 'drc-card' },
    h('h3', null, t('network')),
    h('p', { className: 'drc-desc' }, t('networkHint')),
    h('div', { className: 'drc-list' },
      (data.interfaces ?? []).map((entry) => h('div', { className: 'drc-list-row', key: `${entry.name}-${entry.address}` },
        h('label', null,
          h('input', { type: 'checkbox', checked: selectedInterfaces.includes(entry.name), onChange: () => toggleInterface(entry.name) }),
          h('span', null, entry.name),
        ),
        h('span', { className: 'drc-code' }, entry.cidr || entry.address),
      )),
    ),
  );

  const accessBlock = (): React.ReactElement => h('div', { className: 'drc-card' },
    blockHead(t('access'), t('accessHint')),
    h(Row, { title: t('token'), description: t('rotateHint') }, h(Toggle, { checked: settings.tokenEnabled, label: t('token'), onChange: (checked) => stage({ tokenEnabled: checked }) })),
    h('div', { className: 'drc-actions' }, h(Btn, { danger: true, onClick: () => void rotate(), disabled: busy }, t('rotate'))),
  );

  const unitBlock = (): React.ReactElement => h('div', { className: 'drc-card' },
    h('h3', null, t('temperatureUnit')),
    h('p', { className: 'drc-desc' }, t('temperatureUnitHint')),
    h(Seg, {
      options: [
        { value: 'celsius', label: t('celsius') },
        { value: 'fahrenheit', label: t('fahrenheit') },
      ],
      value: settings.temperatureUnit ?? 'celsius',
      onChange: (value) => stage({ temperatureUnit: value }),
    }),
  );

  const orderRows = (): React.ReactElement[] => {
    const rows: React.ReactElement[] = [];
    const remaining = draggingKey ? order.filter((key) => key !== draggingKey) : order;
    const rawIndex = draggingKey ? (dragIndex == null ? order.indexOf(draggingKey) : dragIndex) : -1;
    const insertAt = draggingKey ? Math.max(0, Math.min(rawIndex, remaining.length)) : -1;
    let visualIndex = 0;
    const placeholder = () => h('div', { className: 'drc-order-placeholder', key: 'order-placeholder' },
      h('span', { className: 'drc-drag-handle', 'aria-hidden': 'true' }, '⋮⋮'),
      h('span', { className: 'drc-order-placeholder-title' }, labels[draggingKey ?? ''] || ''),
    );

    for (const key of order) {
      if (key === draggingKey) {
        // Stay mounted (never unmount the card mid-drag) but take it out
        // of layout; the dashed placeholder marks the insertion point.
        rows.push(h('div', {
          className: 'drc-order-row is-dragging',
          key,
        },
        h('span', { className: 'drc-drag-handle', 'aria-hidden': 'true' }, '⋮⋮'),
        h('b', null, ''),
        h('span', { className: 'drc-order-label' }, labels[key]),
        h(Toggle, { checked: settings.pageEnabled?.[key] !== false, label: labels[key], onChange: () => togglePage(key) }),
        ));
        continue;
      }
      if (draggingKey && remaining.indexOf(key) === insertAt) rows.push(placeholder());
      visualIndex += 1;
      rows.push(h('div', {
        className: 'drc-order-row',
        key,
        onPointerDown: (event) => startOrderDrag(key, event),
      },
      h('span', { className: 'drc-drag-handle', 'aria-hidden': 'true' }, '⋮⋮'),
      h('b', null, String(visualIndex)),
      h('span', { className: 'drc-order-label' }, labels[key]),
      h(Toggle, { checked: settings.pageEnabled?.[key] !== false, label: labels[key], onChange: () => togglePage(key) }),
      ));
    }
    if (draggingKey && insertAt >= remaining.length) rows.push(placeholder());
    rows.push(h('div', { className: 'drc-order-end', key: 'order-end' }));
    return rows;
  };

  const themeBlock = (): React.ReactElement => h('div', { className: 'drc-card' },
    blockHead(t('theme'), t('themeHint')),
    h(Seg, { options: [{ value: 'dsh', label: t('followDsh') }, { value: 'light', label: t('light') }, { value: 'dark', label: t('dark') }], value: settings.theme, onChange: (value) => stage({ theme: value }) }),
  );

  const orderBlock = (): React.ReactElement => h('div', { className: 'drc-card' },
    blockHead(t('pageOrder'), t('pageOrderHint')),
    h('div', { className: 'drc-list', ref: orderListRef }, orderRows()),
  );

  const navBlock = (): React.ReactElement => h('div', { className: 'drc-card' },
    h('h3', null, t('navPosition')),
    h('p', { className: 'drc-desc' }, t('navPositionHint')),
    h(Seg, {
      options: [
        { value: 'left', label: t('navLeft') },
        { value: 'right', label: t('navRight') },
        { value: 'top', label: t('navTop') },
        { value: 'bottom', label: t('navBottom') },
      ],
      value: settings.navPosition ?? 'left',
      onChange: (value) => stage({ navPosition: value }),
    }),
  );

  const tlsBlock = (): React.ReactElement => h('div', { className: 'drc-card' },
    blockHead(t('tls'), t('tlsHint')),
    h(Row, { title: t('tlsEnable') }, h(Toggle, {
      checked: settings.tls?.enabled, label: t('tlsEnable'), onChange: (checked) => {
        if (checked && (!draft.certPath || !draft.keyPath)) { setError('请先填写证书和私钥路径'); return; }
        stage({ tls: { enabled: checked } });
      },
    })),
    h('div', { className: 'drc-fields' },
      h(Field, { label: t('certPath'), value: draft.certPath, onChange: (value) => setDraft((current) => ({ ...current, certPath: value })), placeholder: 'C:\\certs\\fullchain.pem' }),
      h(Field, { label: t('keyPath'), value: draft.keyPath, onChange: (value) => setDraft((current) => ({ ...current, keyPath: value })), placeholder: 'C:\\certs\\privkey.pem' }),
    ),
    h('div', { className: 'drc-actions' },
      h('span', { className: 'drc-muted' }, settings.tls?.enabled ? (info.tls?.active ? t('tlsOn') : t('tlsError')) : t('tlsOff')),
    ),
  );

  const accessLabel = (access: string): string => {
    if (access === 'allowed') return t('accessAllowed');
    if (access === 'denied') return t('accessDenied');
    if (access === 'unspecified') return t('accessUnspecified');
    return t('accessUnknown');
  };

  const locationBlock = (): React.ReactElement => h('div', { className: 'drc-card' },
    h('h3', null, t('locationPermission')),
    h('p', { className: 'drc-desc' }, t('locationPermissionHint')),
    h('div', { className: 'drc-actions', style: { marginTop: 0 } },
      h(Btn, { primary: true, onClick: () => void requestLocation(), disabled: locationBusy || busy }, locationBusy ? t('locationRequesting') : t('locationRequest')),
      locationResult ? h('span', { className: 'drc-muted' }, `${t('locationStatus')} · ${accessLabel(locationResult.access)}`) : null,
    ),
  );

  const renderWeather = (): React.ReactElement => h('div', { className: 'drc-section' },
    sectionHead(t('weather'), t('weatherPageHint')),
    locationBlock(),
    h('div', { className: 'drc-card' },
      blockHead(t('weatherSource'), t('weatherHint')),
      h(Seg, { options: [{ value: 'auto', label: t('auto') }, { value: 'manual', label: t('manual') }], value: settings.weather?.mode ?? 'auto', onChange: (value) => stage({ weather: { mode: value } }) }),
      h('div', { className: 'drc-fields' },
        h(Field, { label: t('locationName'), value: draft.locationName, onChange: (value) => setDraft((current) => ({ ...current, locationName: value })), placeholder: '例如：示例城市' }),
        h(Field, { label: t('latitude'), value: draft.latitude, onChange: (value) => setDraft((current) => ({ ...current, latitude: value })), placeholder: '0.0000', inputMode: 'decimal' }),
        h(Field, { label: t('longitude'), value: draft.longitude, onChange: (value) => setDraft((current) => ({ ...current, longitude: value })), placeholder: '0.0000', inputMode: 'decimal' }),
      ),
    ),
    h('div', { className: 'drc-card' },
      blockHead(t('forecastDisplay'), t('forecastDisplayHint')),
      h(Seg, { options: [{ value: 'hourly', label: t('hourly') }, { value: 'daily', label: t('daily') }], value: settings.weather?.forecastMode ?? 'hourly', onChange: (value) => stage({ weather: { forecastMode: value } }) }),
    ),
  );

  const renderBalance = (): React.ReactElement => h('div', { className: 'drc-section' },
    sectionHead(t('balance'), t('balancePageHint')),
    h('div', { className: 'drc-card' },
      blockHead(t('balanceSpend'), t('balanceHint')),
      h(Seg, { options: [{ value: 'calendar', label: t('calendar') }, { value: 'rolling', label: t('rolling') }], value: settings.balance?.spendWindow ?? 'calendar', onChange: (value) => stage({ balance: { spendWindow: value } }) }),
    ),
    h('div', { className: 'drc-card' },
      blockHead(t('lowThreshold'), t('lowThresholdHint')),
      h('div', { className: 'drc-fields' }, h(Field, { label: t('lowThreshold'), value: draft.threshold, onChange: (value) => setDraft((current) => ({ ...current, threshold: value })), placeholder: '例如：5', inputMode: 'decimal' })),
    ),
    h('div', { className: 'drc-card' },
      blockHead(t('peakValleyBlock'), t('peakValleyHint')),
      h(Row, { title: t('peakValleyToggle') }, h(Toggle, {
        checked: settings.balance?.showPeakValley !== false,
        label: t('peakValley'),
        onChange: (checked) => stage({ balance: { showPeakValley: checked } }),
      })),
    ),
  );

  const notificationApps = apps;

  const renderNotifications = (): React.ReactElement => h('div', { className: 'drc-section' },
    sectionHead(t('notifications'), t('notificationsPageHint')),
    h('div', { className: 'drc-card' },
      blockHead(t('pushQuestions'), t('pushQuestionsHint')),
      h(Row, { title: t('pushQuestionsToggle') }, h(Toggle, {
        checked: Boolean(settings.notifications?.pushQuestions),
        label: t('pushQuestions'),
        onChange: (checked) => stage({ notifications: { pushQuestions: checked } }),
      })),
    ),
    h('div', { className: 'drc-card' },
      blockHead(t('notificationApps'), t('notificationsHint')),
      notificationApps.length === 0 ? h('p', { className: 'drc-muted' }, t('noApps')) : h('div', { className: 'drc-apps' }, notificationApps.map((app) => h('button', { key: app.key, type: 'button', className: `drc-app${selectedApps.includes(app.key) ? ' is-on' : ''}`, onClick: () => toggleApp(app.key) }, h('i'), app.name))),
      h('div', { className: 'drc-actions' },
        h(Btn, { onClick: () => setSelectedApps(notificationApps.map((app) => app.key)) }, t('allApps')),
      ),
    ),
    h('div', { className: 'drc-card' },
      blockHead(t('limitDisplay'), t('notificationLimitHint')),
      h('div', { className: 'drc-fields' },
        h(Field, { label: t('limitField'), value: draft.notificationLimit, onChange: (value) => setDraft((current) => ({ ...current, notificationLimit: value })), placeholder: '5', inputMode: 'numeric' }),
      ),
    ),
  );

  const renderAppMapping = (): React.ReactElement => h('div', { className: 'drc-section' },
    sectionHead(t('appMapping'), t('appsPageHint')),
    h('div', { className: 'drc-card' },
      blockHead(t('appNamesBlock'), t('appMappingHint')),
      apps.length === 0 ? h('p', { className: 'drc-muted' }, t('noApps')) : h('div', null, apps.map((app) => h('div', { className: 'drc-map-row', key: app.key },
        h('div', { className: 'drc-map-main' },
          h('input', {
            className: 'drc-map-input',
            value: appNames[app.key] ?? app.name,
            placeholder: app.defaultName || app.key,
            onChange: (event) => {
              const value = event.target.value;
              setAppNames((current) => ({ ...current, [app.key]: value }));
            },
            onKeyDown: (event) => {
              if (event.key === 'Enter') void saveAppName(app.key, event.currentTarget.value);
            },
          }),
          h('small', { className: 'drc-code drc-map-key', title: app.key }, app.key),
        ),
        h('div', { className: 'drc-map-meta' },
          (app.sources ?? []).map((source) => h('span', { className: 'drc-tag', key: source }, source === 'music' ? t('sourceMusic') : t('sourceNotification'))),
          h(Btn, { onClick: () => void saveAppName(app.key, appNames[app.key] ?? app.name), disabled: appBusyKey === app.key }, t('save')),
          h(Btn, { onClick: () => void saveAppName(app.key, ''), disabled: appBusyKey === app.key || !app.customName }, t('resetName')),
        ),
      ))),
    ),
  );

  const renderPreferences = (): React.ReactElement => h('div', { className: 'drc-section' },
    sectionHead(t('menuPlugin'), t('preferencesHint')),
    unitBlock(),
    themeBlock(),
    orderBlock(),
    navBlock(),
  );

  const renderPomodoro = (): React.ReactElement => h('div', { className: 'drc-section' },
    sectionHead(t('pomodoro'), t('pomodoroHint')),
    h('div', { className: 'drc-card' },
      blockHead(t('pomodoroTimer'), t('pomodoroTimerHint')),
      h(Row, { title: t('pomodoroEnable'), description: t('pomodoroEnableHint') }, h(Toggle, {
        checked: Boolean(settings.pomodoro?.enabled),
        label: t('pomodoroEnable'),
        onChange: (checked) => stage({ pomodoro: { enabled: checked } }),
      })),
      h('div', { className: 'drc-fields' },
        h(Field, { label: t('pomodoroFocus'), value: draft.pomodoroFocus, onChange: (value) => setDraft((current) => ({ ...current, pomodoroFocus: value })), placeholder: '25', inputMode: 'numeric' }),
        h(Field, { label: t('pomodoroBreak'), value: draft.pomodoroBreak, onChange: (value) => setDraft((current) => ({ ...current, pomodoroBreak: value })), placeholder: '5', inputMode: 'numeric' }),
      ),
      h(Row, { title: t('pomodoroLoop'), description: t('pomodoroLoopHint') }, h(Toggle, {
        checked: Boolean(settings.pomodoro?.loopAlarm),
        label: t('pomodoroLoop'),
        onChange: (checked) => stage({ pomodoro: { loopAlarm: checked } }),
      })),
    ),
    h('div', { className: 'drc-card' },
      h('h3', null, t('pomodoroSound')),
      h('p', { className: 'drc-desc' }, t('pomodoroSoundHint')),
      h('div', { className: 'drc-fields' },
        h(Field, { label: t('pomodoroSound'), value: draft.pomodoroSound, onChange: (value) => setDraft((current) => ({ ...current, pomodoroSound: value })), placeholder: t('pomodoroSoundPlaceholder') }),
      ),
      h('div', { className: 'drc-actions' },
        h('span', { className: 'drc-muted' }, draft.pomodoroSound.trim() ? draft.pomodoroSound : t('pomodoroBuiltin')),
      ),
    ),
  );

  const statusBlock = (): React.ReactElement => h('div', { className: 'drc-card' },
    h('h3', null, t('status')),
    h('p', { className: 'drc-desc' }, t('statusHint')),
    h(StatusRow, { label: t('notificationsStatus'), value: data.capabilities?.notifications?.available }),
    h(StatusRow, { label: t('mediaStatus'), value: data.capabilities?.media?.available ?? data.capabilities?.media?.ok }),
    h(StatusRow, { label: t('volumeStatus'), value: data.capabilities?.volume?.available ?? data.capabilities?.volume?.ok }),
    h(StatusRow, { label: t('weatherStatus'), value: data.capabilities?.weather?.ok }),
  );

  const clientsBlock = (): React.ReactElement => h('div', { className: 'drc-card' },
    h('h3', null, t('clients')),
    h('p', { className: 'drc-desc' }, t('clientsHint')),
    clients.length === 0 ? h('p', { className: 'drc-muted' }, t('noClients')) : h('div', { className: 'drc-list' }, clients.map((client) => h('div', { className: 'drc-client', key: client.id }, h('div', null, h('strong', null, client.label || '设备'), h('small', null, `${client.ip} · ${duration(Date.now() - client.connectedAt)}`)), h(Btn, { danger: true, onClick: () => void disconnect(client.id) }, t('disconnect'))))),
  );

  const diagnosticsBlock = (): React.ReactElement => h('div', { className: 'drc-card' },
    h('h3', null, t('diagnostics')),
    h('p', { className: 'drc-desc' }, t('diagnosticsHint')),
    h('div', { className: 'drc-facts' },
      h('span', null, `${t('systemName')} · ${data.diagnostics?.platformLabel || info.platformLabel || '—'}`),
      h('span', null, `${t('version')} · ${data.diagnostics?.version || info.version || '—'}`),
      h('span', null, `${t('protocol')} · ${data.diagnostics?.protocol || info.protocol || 'http'}`),
      h('span', null, `${t('clientCount')} · ${clients.length}`),
    ),
  );

  const renderSystem = (): React.ReactElement => h('div', { className: 'drc-section' },
    sectionHead(t('menuSystem'), t('systemPageHint')),
    statusBlock(),
    clientsBlock(),
    diagnosticsBlock(),
  );

  const content: React.ReactElement = section === 'connection' ? renderConnection()
    : section === 'preferences' ? renderPreferences()
      : section === 'pomodoro' ? renderPomodoro()
        : section === 'weather' ? renderWeather()
          : section === 'balance' ? renderBalance()
            : section === 'notifications' ? renderNotifications()
              : section === 'apps' ? renderAppMapping()
                : renderSystem();

  const menu: Array<{ key: string; label: string; icon: string }> = [
    { key: 'connection', label: t('connection'), icon: 'link' },
    { key: 'preferences', label: t('menuPlugin'), icon: 'sliders' },
    { key: 'pomodoro', label: t('menuPomodoro'), icon: 'timer' },
    { key: 'weather', label: t('menuWeather'), icon: 'cloud' },
    { key: 'balance', label: t('menuBalance'), icon: 'wallet' },
    { key: 'notifications', label: t('menuNotifications'), icon: 'bell' },
    { key: 'apps', label: t('menuAppMapping'), icon: 'apps' },
    { key: 'system', label: t('menuSystem'), icon: 'info' },
  ];

  return h('div', { className: 'drc-page' },
    h('style', null, CSS),
    h('header', { className: 'drc-head' },
      h('div', null, h('h1', null, t('heading')), h('p', null, t('subtitle'))),
      h('div', { className: 'drc-head-actions' },
        h('span', { className: 'drc-status' }, h('i', { className: `drc-dot ${info.running ? 'ok' : 'bad'}` }), info.running ? t('serviceRunning') : t('serviceStopped')),
        h(Btn, { primary: true, onClick: saveAll, disabled: busy }, t('saveSettings')),
        h(Btn, { disabled: !info.routes?.remote, onClick: () => window.open(info.routes?.remote || '', '_blank', 'noopener,noreferrer') }, t('open')),
        h(Btn, { onClick: () => void load(), disabled: busy }, t('refresh')),
      ),
    ),
    error ? h('div', { className: 'drc-banner is-error' }, `${t('error')}: ${error}`) : null,
    notice ? h('div', { className: 'drc-banner is-ok' }, notice) : null,
    h('div', { className: 'drc-body' },
      h('aside', { className: 'drc-menu' },
        menu.map((item) => h('button', { key: item.key, type: 'button', className: `drc-menu-item${section === item.key ? ' is-active' : ''}`, onClick: () => setSection(item.key) },
          h(MenuIcon, { name: item.icon }),
          item.label,
        )),
      ),
      h('main', { className: 'drc-main' }, content),
    ),
  );
}

export const inject: string[] = ['slots', 'locale', 'theme'];

export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS);
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-remote-control: dictionaries');
  ctx.effect(() => {
    let active = true;
    const sync = (snapshot?: ThemeSnapshot): void => {
      if (!active) return;
      const scheme = snapshot?.active?.colorScheme || ctx.theme?.getTheme?.()?.active?.colorScheme;
      if (!scheme) return;
      void fetch(THEME_URL, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: scheme }) }).catch(() => {});
    };
    sync(ctx.theme?.getTheme?.());
    const off = ctx.on?.('theme/change', sync);
    return () => { active = false; try { off?.(); } catch { /* ignore */ } };
  }, 'dsh-remote-control: theme sync');
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 12, label: () => t('title') }, PanelIcon)), 'dsh-remote-control: sidebar launcher');
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, RemotePanel)), 'dsh-remote-control: settings panel');
}

export const __test = { zh, en, PanelIcon, RemotePanel };
