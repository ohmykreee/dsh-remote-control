/**
 * The settings panel itself: data loading, staged edits, immediate actions,
 * pointer-based page reordering, and the DSH settings-style shell.
 *
 * Section markup lives in `sections/*` and receives the small `PanelApi` face
 * assembled here, so adding a section does not require touching this state
 * machine and changing this file does not require reading every section.
 */

import * as React from 'react';
import {
  APP_NAMES_URL,
  DISCONNECT_URL,
  LOCATION_URL,
  SETTINGS_URL,
  TOKEN_URL,
  describeError,
  isRecord,
  isSettingsPayload,
  postJson,
  readClients,
  requestJson,
} from './api.js';
import { useTranslator } from './i18n.js';
import {
  EMPTY_DRAFT,
  PAGE_ORDER,
  buildSavePatch,
  buildSettingsView,
  createDraft,
  locationHint,
  mergeStaged,
  normalizePageOrder,
  pageLabels,
} from './logic.js';
import { Btn, h } from './ui.js';
import { MenuIcon } from './icons.js';
import { CSS } from './styles.js';
import { renderAppMapping } from './sections/apps.js';
import { renderBalance } from './sections/balance.js';
import { renderConnection } from './sections/connection.js';
import { renderNotifications } from './sections/notifications.js';
import { renderPomodoro } from './sections/pomodoro.js';
import { renderPreferences } from './sections/preferences.js';
import { renderSystem } from './sections/system.js';
import { renderWeather } from './sections/weather.js';
import type {
  DraftState,
  LocationResult,
  PanelApi,
  RemoteApp,
  RemoteClient,
  RemoteInfo,
  RemoteSettings,
  SavePatch,
  SettingsPayload,
  StagedSettings,
} from './types.js';

const { useEffect, useState, useCallback, useRef } = React;

type SectionKey = 'connection' | 'preferences' | 'pomodoro' | 'weather' | 'balance' | 'notifications' | 'apps' | 'system';

const MENU: Array<{ key: SectionKey; labelKey: string; icon: string }> = [
  { key: 'connection', labelKey: 'connection', icon: 'link' },
  { key: 'preferences', labelKey: 'menuPlugin', icon: 'sliders' },
  { key: 'pomodoro', labelKey: 'menuPomodoro', icon: 'timer' },
  { key: 'weather', labelKey: 'menuWeather', icon: 'cloud' },
  { key: 'balance', labelKey: 'menuBalance', icon: 'wallet' },
  { key: 'notifications', labelKey: 'menuNotifications', icon: 'bell' },
  { key: 'apps', labelKey: 'menuAppMapping', icon: 'apps' },
  { key: 'system', labelKey: 'menuSystem', icon: 'info' },
];

const NARROW_QUERY = '(max-width: 767px)';

/** Follow the same breakpoint as the stylesheet: the rail becomes a selector. */
function useNarrowLayout(): boolean {
  const [narrow, setNarrow] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(NARROW_QUERY).matches
      : false
  ));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(NARROW_QUERY);
    const update = (): void => setNarrow(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return narrow;
}

function selectAllNames(payload: SettingsPayload): string[] {
  return (payload.interfaces ?? []).map((entry) => entry.name);
}

function disabledPages(order: string[], values: Record<string, boolean>): boolean {
  return order.every((key) => !values[key]);
}

export function RemotePanel(): React.ReactElement {
  const t = useTranslator();
  const narrow = useNarrowLayout();
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [section, setSection] = useState<SectionKey>('connection');
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [selectedInterfaces, setSelectedInterfaces] = useState<string[]>([]);
  const [selectedApps, setSelectedApps] = useState<string[]>([]);
  const [appNames, setAppNames] = useState<Record<string, string>>({});
  const [appBusyKey, setAppBusyKey] = useState('');
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationResult, setLocationResult] = useState<LocationResult | null>(null);
  const [staged, setStaged] = useState<StagedSettings>({});
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const orderListRef = useRef<HTMLDivElement | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  /** Latest merged settings, used by pointer handlers that outlive a render. */
  const settingsRef = useRef<RemoteSettings | null>(null);

  useEffect(() => () => {
    dragCleanupRef.current?.();
    dragCleanupRef.current = null;
  }, []);

  const hydrate = useCallback((payload: unknown): void => {
    if (!isSettingsPayload(payload)) return;
    setData(payload);
    setStaged({});
    const names = selectAllNames(payload);
    setSelectedInterfaces(payload.settings.allowedInterfaces === null ? names : [...payload.settings.allowedInterfaces]);
    const appKeys = (payload.apps ?? []).map((app) => app.key);
    const enabled = payload.settings.notifications?.enabledApps ?? [];
    setSelectedApps(enabled.length ? enabled.filter((key) => appKeys.includes(key)) : appKeys);
    setAppNames(Object.fromEntries((payload.apps ?? []).map((app) => [app.key, app.name])));
    setDraft(createDraft(payload.settings));
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      hydrate(await requestJson(SETTINGS_URL));
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
      hydrate(await postJson(SETTINGS_URL, patch));
      setNotice(t('saved'));
      window.setTimeout(() => setNotice(''), 1600);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }, [hydrate, t]);

  const stage = useCallback((patch: StagedSettings): void => {
    setStaged((current) => mergeStaged(current, patch));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const copy = async (): Promise<void> => {
    const url = data?.info?.routes?.remote || '';
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError(t('error'));
    }
  };

  const rotate = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      hydrate(await postJson(TOKEN_URL));
      setNotice(t('saved'));
      window.setTimeout(() => setNotice(''), 1600);
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
      hydrate(await postJson(APP_NAMES_URL, { key, name }));
      setNotice(t('saved'));
      window.setTimeout(() => setNotice(''), 1600);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setAppBusyKey('');
    }
  };

  const requestLocation = async (): Promise<void> => {
    setLocationBusy(true);
    setError('');
    try {
      const payload = await postJson(LOCATION_URL, { openSettings: true });
      const record = isRecord(payload) ? payload : {};
      const result: LocationResult = {
        allowed: record.allowed === true,
        access: String(record.access || 'unknown'),
        reason: typeof record.reason === 'string' ? record.reason : null,
        lowIntegrity: record.lowIntegrity === true,
        openedSettings: record.openedSettings === true,
      };
      setLocationResult(result);
      setNotice(locationHint(t, result));
      window.setTimeout(() => setNotice(''), 2600);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLocationBusy(false);
    }
  };

  const disconnect = async (id: string): Promise<void> => {
    try {
      const payload = await postJson(DISCONNECT_URL, { id });
      const clients = readClients(payload);
      setData((current) => (current ? { ...current, clients } : current));
    } catch (err) {
      setError(describeError(err));
    }
  };

  const toggleApp = (key: string): void => {
    const next = new Set(selectedApps);
    if (next.has(key)) next.delete(key); else next.add(key);
    if (next.size === 0) {
      setNotice(t('keepOneApp'));
      window.setTimeout(() => setNotice(''), 1600);
      return;
    }
    setSelectedApps([...next]);
  };

  const selectAllApps = (): void => {
    setSelectedApps((data?.apps ?? []).map((app) => app.key));
  };

  const toggleInterface = (name: string): void => {
    setSelectedInterfaces((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  };

  const togglePage = (key: string): void => {
    const current: Record<string, boolean> = settingsRef.current?.pageEnabled ?? {};
    const next: Record<string, boolean> = { ...current, [key]: !current[key] };
    if (disabledPages(PAGE_ORDER, next)) {
      setNotice(t('keepOnePage'));
      window.setTimeout(() => setNotice(''), 1600);
      return;
    }
    stage({ pageEnabled: next });
  };

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
    const order = settingsRef.current ? normalizePageOrder(settingsRef.current.pageOrder ?? PAGE_ORDER) : PAGE_ORDER;
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

  if (loading) {
    return h('div', { className: 'drc-page' },
      h('style', null, CSS),
      h('div', { className: 'drc-empty', style: { padding: 32 } }, t('loading')),
    );
  }
  if (!data) {
    return h('div', { className: 'drc-page' },
      h('style', null, CSS),
      h('div', { className: 'drc-empty', style: { padding: 32, maxWidth: 680 } },
        h('h1', { className: 'drc-section-title' }, t('heading')),
        h('p', { className: 'drc-banner is-error' }, error || t('noWebServer')),
        h(Btn, { primary: true, onClick: () => void load() }, t('refresh')),
      ),
    );
  }

  const info: RemoteInfo = data.info ?? {};
  const clients: RemoteClient[] = data.clients ?? [];
  const settings = buildSettingsView(data.settings, staged);
  settingsRef.current = settings;
  const order = normalizePageOrder(settings.pageOrder ?? PAGE_ORDER);
  const labels = pageLabels(t);
  const notificationApps: RemoteApp[] = data.apps ?? [];
  const remote = info.routes?.remote || '';

  const saveAll = (): void => {
    void save(buildSavePatch({
      data,
      settings,
      draft,
      selectedInterfaces,
      selectedApps,
      notificationApps,
      order,
    }));
  };

  const api: PanelApi = {
    t,
    data,
    settings,
    draft,
    info,
    apps: notificationApps,
    clients,
    busy,
    appBusyKey,
    locationBusy,
    locationResult,
    copied,
    order,
    labels,
    draggingKey,
    dragIndex,
    selectedInterfaces,
    selectedApps,
    appNames,
    orderListRef,
    setDraft,
    setError,
    setAppNames,
    selectAllApps,
    stage,
    save,
    saveAll,
    copy,
    rotate,
    saveAppName,
    requestLocation,
    disconnect,
    toggleApp,
    toggleInterface,
    togglePage,
    startOrderDrag,
  };

  const content: React.ReactElement = section === 'connection' ? renderConnection(api)
    : section === 'preferences' ? renderPreferences(api)
      : section === 'pomodoro' ? renderPomodoro(api)
        : section === 'weather' ? renderWeather(api)
          : section === 'balance' ? renderBalance(api)
            : section === 'notifications' ? renderNotifications(api)
              : section === 'apps' ? renderAppMapping(api)
                : renderSystem(api);

  return h('div', { className: 'drc-page' },
    h('style', null, CSS),
    h('div', { className: 'drc-shell' },
      h('div', { className: 'drc-nav-title' }, t('heading')),
      h('header', { className: 'drc-head' },
        h('div', { className: 'drc-head-actions' },
          h('span', { className: 'drc-status' },
            h('i', { className: `drc-dot ${info.running ? 'ok' : 'bad'}` }),
            info.running ? t('serviceRunning') : t('serviceStopped'),
          ),
          h(Btn, { primary: true, onClick: saveAll, disabled: busy }, t('saveSettings')),
          h(Btn, { disabled: !remote, onClick: () => window.open(remote, '_blank', 'noopener,noreferrer') }, t('open')),
          h(Btn, { onClick: () => void load(), disabled: busy }, t('refresh')),
        ),
      ),
      narrow
        ? h('nav', { className: 'drc-nav drc-nav-compact', 'aria-label': t('heading') },
          h('div', { className: 'drc-nav-select-wrap' },
            h('select', {
              className: 'drc-nav-select',
              value: section,
              'aria-label': t('heading'),
              onChange: (event: React.ChangeEvent<HTMLSelectElement>) => setSection(event.target.value as SectionKey),
            }, MENU.map((item) => h('option', { key: item.key, value: item.key }, t(item.labelKey)))),
          ),
        )
        : h('nav', { className: 'drc-nav', 'aria-label': t('heading') },
          h('div', { className: 'drc-nav-list' }, MENU.map((item) => h('button', {
            key: item.key,
            type: 'button',
            className: `drc-nav-item${section === item.key ? ' is-active' : ''}`,
            'aria-current': section === item.key ? 'page' : undefined,
            onClick: () => setSection(item.key),
          },
          h(MenuIcon, { name: item.icon }),
          h('span', { className: 'drc-nav-label' }, t(item.labelKey)),
          ))),
        ),
      h('main', { className: 'drc-main' },
        error ? h('div', { className: 'drc-banner is-error' }, `${t('error')}: ${error}`) : null,
        notice ? h('div', { className: 'drc-banner is-ok' }, notice) : null,
        content,
      ),
    ),
  );
}
