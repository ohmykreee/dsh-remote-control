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
  QUICKQA_OPTIONS_URL,
  SETTINGS_URL,
  TOKEN_URL,
  WEATHER_REFRESH_URL,
  describeError,
  isRecord,
  isSettingsPayload,
  postJson,
  readClients,
  requestJson,
} from './api.js';
import { setPluginLanguage, useTranslator } from './i18n.js';
import {
  EMPTY_DRAFT,
  PAGE_ORDER,
  buildSavePatch,
  buildSettingsView,
  checkDraftIssues,
  createDraft,
  draftHasIssues,
  locationHint,
  mergeStaged,
  normalizePageOrder,
  pageLabels,
  quickQaImageInput,
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
import { renderQuickQa } from './sections/quickqa.js';
import { renderSystem } from './sections/system.js';
import { renderWeather } from './sections/weather.js';
import type {
  DraftState,
  LocationResult,
  PanelApi,
  QuickQaOptionsPayload,
  RemoteApp,
  RemoteClient,
  RemoteInfo,
  RemoteSettings,
  SavePatch,
  SettingsPayload,
  StagedSettings,
} from './types.js';

const { useEffect, useState, useCallback, useRef } = React;

type SectionKey = 'connection' | 'preferences' | 'quickqa' | 'pomodoro' | 'weather' | 'balance' | 'notifications' | 'apps' | 'system';

const MENU: Array<{ key: SectionKey; labelKey: string; icon: string }> = [
  { key: 'connection', labelKey: 'connection', icon: 'link' },
  { key: 'preferences', labelKey: 'menuPlugin', icon: 'sliders' },
  { key: 'quickqa', labelKey: 'menuQuickQa', icon: 'mic' },
  { key: 'pomodoro', labelKey: 'menuPomodoro', icon: 'timer' },
  { key: 'weather', labelKey: 'menuWeather', icon: 'cloud' },
  { key: 'balance', labelKey: 'menuBalance', icon: 'wallet' },
  { key: 'notifications', labelKey: 'menuNotifications', icon: 'bell' },
  { key: 'apps', labelKey: 'menuAppMapping', icon: 'apps' },
  { key: 'system', labelKey: 'menuSystem', icon: 'info' },
];

const NARROW_QUERY = '(max-width: 767px)';

/** Keep the "saved" banner visible long enough to read after a save. */
const SAVED_NOTICE_MS = 3200;

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
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [quickQaOptions, setQuickQaOptions] = useState<QuickQaOptionsPayload | null>(null);
  const [quickQaBusy, setQuickQaBusy] = useState(false);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [draggingWorkspaceId, setDraggingWorkspaceId] = useState<string | null>(null);
  const [workspaceDragIndex, setWorkspaceDragIndex] = useState<number | null>(null);
  const orderListRef = useRef<HTMLDivElement | null>(null);
  const workspaceListRef = useRef<HTMLDivElement | null>(null);
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
    // The saved plugin language drives every label in this panel; apply it
    // before the next render so the new language paints in one pass.
    setPluginLanguage(payload.settings.language);
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

  /** Desktop refresh: re-read the system position and weather, then reload settings. */
  const refreshSettings = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      hydrate(await postJson(WEATHER_REFRESH_URL));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }, [hydrate]);

  /** Refresh server-side stats without discarding staged edits. */
  const refreshData = useCallback(async (): Promise<void> => {
    try {
      const payload = await requestJson(SETTINGS_URL);
      if (isSettingsPayload(payload)) setData(payload);
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  /** Live voice/model/workspace/mode/permission catalogs for the quick section. */
  const refreshQuickQaOptions = useCallback(async (force = false): Promise<void> => {
    setQuickQaBusy(true);
    try {
      const payload = await requestJson(`${QUICKQA_OPTIONS_URL}${force ? '?refresh=1' : ''}`);
      if (isRecord(payload) && payload.ok !== false) {
        setQuickQaOptions(payload as unknown as QuickQaOptionsPayload);
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setQuickQaBusy(false);
    }
  }, []);

  const save = useCallback(async (patch: SavePatch): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      hydrate(await postJson(SETTINGS_URL, patch));
      setSettingsVersion((current) => current + 1);
      void refreshQuickQaOptions(true);
      setNotice(t('saved'));
      window.setTimeout(() => setNotice(''), SAVED_NOTICE_MS);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }, [hydrate, refreshQuickQaOptions, t]);

  const stage = useCallback((patch: StagedSettings): void => {
    setStaged((current) => mergeStaged(current, patch));
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!data) return;
    void refreshQuickQaOptions();
  }, [data, refreshQuickQaOptions]);

  useEffect(() => {
    if (section !== 'quickqa') return;
    void refreshQuickQaOptions();
    const timer = window.setInterval(() => { void refreshQuickQaOptions(); }, 5000);
    return () => window.clearInterval(timer);
  }, [section, refreshQuickQaOptions]);

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
      window.setTimeout(() => setNotice(''), SAVED_NOTICE_MS);
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
      window.setTimeout(() => setNotice(''), SAVED_NOTICE_MS);
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
      // With access verification on, disconnecting rotates the token, so the
      // panel gets a full payload and refreshes the pairing URL / QR code.
      if (isSettingsPayload(payload)) {
        setData(payload);
        setNotice(t('disconnectRotated'));
        window.setTimeout(() => setNotice(''), 1600);
        return;
      }
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

  const computeWorkspaceInsertIndex = (clientY: number): number => {
    const list = workspaceListRef.current;
    if (!list) return 0;
    const rows = [...list.querySelectorAll<HTMLElement>('.drc-quickqa-draggable:not(.is-dragging)')];
    for (let index = 0; index < rows.length; index += 1) {
      const rect = rows[index].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return index;
    }
    return rows.length;
  };

  const startWorkspaceDrag = (key: string, event: React.PointerEvent<HTMLElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const dragTarget = event.target;
    if (dragTarget instanceof Element && dragTarget.closest('button, input, a, select, textarea, .drc-quickqa-workspace-check')) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const configured = settingsRef.current?.quickqa;
    const known = new Set((quickQaOptions?.workspaces ?? []).map((workspace) => workspace.id));
    const order = [...new Set(configured?.pinnedWorkspaceIds ?? [])]
      .filter((id) => id && id !== configured?.defaultWorkspaceId && (known.size === 0 || known.has(id)));
    if (!order.includes(key)) return;
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
        setDraggingWorkspaceId(null);
        setWorkspaceDragIndex(null);
        return;
      }
      const remaining = order.filter((item) => item !== key);
      const insertAt = Math.max(0, Math.min(computeWorkspaceInsertIndex(upEvent.clientY), remaining.length));
      const next = [...remaining.slice(0, insertAt), key, ...remaining.slice(insertAt)];
      if (next.join('|') !== order.join('|')) stage({ quickqa: { pinnedWorkspaceIds: next } });
      setDraggingWorkspaceId(null);
      setWorkspaceDragIndex(null);
    };

    const onMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== pointerId) return;
      if (!started) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) return;
        started = true;
        setDraggingWorkspaceId(key);
        setWorkspaceDragIndex(originalIndex);
        document.body.classList.add('drc-sorting');
      }
      moveEvent.preventDefault();
      const next = computeWorkspaceInsertIndex(moveEvent.clientY);
      setWorkspaceDragIndex((current) => (current === next ? current : next));
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
        h(Btn, { primary: true, onClick: () => void refreshSettings(), disabled: busy }, t('refresh')),
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
  // Every manually edited field without an unfocus clamp is validated here.
  // One unusable value disables "save settings" and shows a banner.
  const issues = checkDraftIssues(settings, draft);
  const formInvalid = draftHasIssues(issues);

  const saveAll = (): void => {
    if (formInvalid) {
      setError(t('invalidFieldsHint'));
      return;
    }
    void save(buildSavePatch({
      data,
      settings,
      draft,
      selectedInterfaces,
      selectedApps,
      notificationApps,
      order,
      quickQaImageInput: quickQaImageInput(quickQaOptions?.model, settings.quickqa),
    }));
  };

  const api: PanelApi = {
    t,
    data,
    settings,
    draft,
    issues,
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
    quickQaOptions,
    quickQaBusy,
    refreshQuickQaOptions,
    draggingKey,
    dragIndex,
    draggingWorkspaceId,
    workspaceDragIndex,
    selectedInterfaces,
    selectedApps,
    appNames,
    orderListRef,
    workspaceListRef,
    setDraft,
    setError,
    setAppNames,
    selectAllApps,
    stage,
    save,
    saveAll,
    refreshData,
    settingsVersion,
    copy,
    rotate,
    saveAppName,
    requestLocation,
    disconnect,
    toggleApp,
    toggleInterface,
    togglePage,
    startOrderDrag,
    startWorkspaceDrag,
  };

  const content: React.ReactElement = section === 'connection' ? renderConnection(api)
    : section === 'preferences' ? renderPreferences(api)
      : section === 'quickqa' ? renderQuickQa(api)
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
          h(Btn, {
            primary: true,
            onClick: saveAll,
            disabled: busy || formInvalid,
            title: formInvalid ? t('invalidFieldsHint') : undefined,
          }, t('saveSettings')),
          h(Btn, { disabled: !remote, onClick: () => window.open(remote, '_blank', 'noopener,noreferrer') }, t('open')),
          h(Btn, { onClick: () => void refreshSettings(), disabled: busy }, t('refresh')),
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
        // The banner is a zero-height sticky overlay: it floats over the top
        // of the content instead of pushing the page down when it appears.
        (error || notice || formInvalid)
          ? h('div', { className: 'drc-banner-slot' },
            error ? h('div', { className: 'drc-banner is-error' }, `${t('error')}: ${error}`) : null,
            notice ? h('div', { className: 'drc-banner is-ok' }, notice) : null,
            formInvalid ? h('div', { className: 'drc-banner is-error' }, t('invalidFieldsHint')) : null,
          )
          : null,
        content,
      ),
    ),
  );
}
