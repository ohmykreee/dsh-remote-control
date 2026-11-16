/** Weather section: provider, location permission, city match, QWeather JWT, display. */

import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Btn, Field, Seg, TextArea, Toggle, groupHead, h, sectionHead } from '../ui.js';
import type {
  GeocodePlace,
  PanelApi,
  QWeatherConsoleSnapshot,
  QWeatherSettings,
  Translator,
  WeatherProviderId,
} from '../types.js';
import {
  QWEATHER_DEFAULT_MONTHLY_LIMIT,
  QWEATHER_DEFAULT_REFRESH_MINUTES,
  WEATHER_PROVIDERS,
  accessLabel,
  estimatedMonthlyCalls,
  minimumQWeatherRefreshMinutes,
  normalizeWeatherProvider,
  weatherProviderLabel,
} from '../logic.js';
import {
  GEOCODE_URL,
  QWEATHER_KEYPAIR_URL,
  QWEATHER_SYNC_URL,
  describeError,
  isRecord,
  postJson,
} from '../api.js';

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';

interface CitySearchProps {
  t: Translator;
  provider: WeatherProviderId;
  initialValue: string;
  disabled: boolean;
  qweather: QWeatherSettings;
  onSelect: (place: GeocodePlace) => void;
}

function readPlaces(payload: unknown): GeocodePlace[] {
  const record = isRecord(payload) ? payload : {};
  const raw: unknown[] = Array.isArray(record.results) ? record.results : [];
  const places: GeocodePlace[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const latitude = Number(item.latitude);
    const longitude = Number(item.longitude);
    if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const id = item.id;
    places.push({
      id: typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id)) ? id : undefined,
      name,
      latitude,
      longitude,
      country: typeof item.country === 'string' ? item.country : '',
      admin1: typeof item.admin1 === 'string' ? item.admin1 : '',
      timezone: typeof item.timezone === 'string' ? item.timezone : '',
    });
  }
  return places;
}

function placeMeta(place: GeocodePlace): string {
  return [place.admin1, place.country]
    .map((part) => (part || '').trim())
    .filter(Boolean)
    .join(' · ');
}

function providerHintKey(provider: WeatherProviderId): string {
  if (provider === 'nmc') return 'providerNmcHint';
  if (provider === 'qweather') return 'providerQweatherHint';
  return 'providerOpenMeteoHint';
}

/** Only the OS location APIs are treated as a system-reported position. */
function isSystemLocationSource(value: string | undefined): boolean {
  const source = (value || '').toLowerCase();
  return source.includes('geolocation') || source.includes('geoclue') || source.includes('gps') || source === 'system';
}

/** Fill `{name}` placeholders; the client translator only resolves keys. */
function fill(t: Translator, key: string, params: Record<string, string | number>): string {
  return t(key).replace(/\{(\w+)\}/g, (match, name: string) => (
    name in params ? String(params[name]) : match
  ));
}

/**
 * City combobox for the manual weather location. The search request carries the
 * provider (and any QWeather credentials currently in the form) so switching
 * providers works before "save settings"; the matched coordinates or station id
 * are shown as a hint instead of editable fields.
 */
function CitySearch({ t, provider, initialValue, disabled, qweather, onSelect }: CitySearchProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [places, setPlaces] = useState<GeocodePlace[]>([]);
  const [active, setActive] = useState(-1);
  const [failure, setFailure] = useState('');
  const [query, setQuery] = useState(initialValue);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // A saved/picked location or a provider switch resets the search text.
  useEffect(() => {
    setQuery(initialValue);
  }, [initialValue, provider]);

  // Automatic mode disables the field; an open list must not linger.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  // Dismiss the list when clicking anywhere else on the page.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (wrapRef.current && target instanceof Node && wrapRef.current.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Debounced search through the Host proxy. Keystrokes abort the previous
  // request so an older result cannot overwrite a newer query.
  useEffect(() => {
    if (!open || disabled) {
      setStatus('idle');
      setPlaces([]);
      setActive(-1);
      setFailure('');
      return;
    }
    const value = query.trim();
    if (!value) {
      setStatus('idle');
      setPlaces([]);
      setActive(-1);
      setFailure('');
      return;
    }
    setStatus('loading');
    setFailure('');
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const body: Record<string, unknown> = { q: value, provider };
      if (provider === 'qweather') {
        body.qweather = {
          apiHost: qweather.apiHost ?? '',
          credentialId: qweather.credentialId ?? '',
          projectId: qweather.projectId ?? '',
          developerId: qweather.developerId ?? '',
          privateKey: qweather.privateKey ?? '',
          monthlyLimit: qweather.monthlyLimit,
          refreshMinutes: qweather.refreshMinutes,
        };
      }
      postJson(GEOCODE_URL, body)
        .then((payload) => {
          if (controller.signal.aborted) return;
          const next = readPlaces(payload);
          setPlaces(next);
          setStatus('ready');
          setActive(next.length ? 0 : -1);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setPlaces([]);
          setStatus('error');
          setActive(-1);
          setFailure(describeError(error));
        });
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    open,
    disabled,
    query,
    provider,
    qweather.apiHost,
    qweather.credentialId,
    qweather.projectId,
    qweather.developerId,
    qweather.privateKey,
    qweather.monthlyLimit,
    qweather.refreshMinutes,
  ]);

  const visible = open && !disabled && query.trim().length > 0;

  const choose = (place: GeocodePlace): void => {
    onSelect(place);
    setQuery(place.name);
    setOpen(false);
    inputRef.current?.blur();
  };

  const pickActive = (): void => {
    if (active >= 0 && places[active]) choose(places[active]);
  };

  const errorTitle = /quota|limit reached/i.test(failure)
    ? t('citySearchQuota')
    : /unauthorized|401|\bjwt\b/i.test(failure)
      ? t('citySearchAuth')
      : /\b404\b/.test(failure)
        ? t('citySearchUnavailable')
        : t('citySearchFailed');

  return h('div', { className: 'drc-field drc-city', ref: wrapRef },
    h('span', null, t('locationSearch')),
    h('input', {
      ref: inputRef,
      value: query,
      disabled,
      placeholder: t('citySearchPlaceholder'),
      autoComplete: 'off',
      spellCheck: false,
      role: 'combobox',
      'aria-expanded': visible,
      'aria-autocomplete': 'list',
      'aria-controls': 'drc-city-options',
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        setOpen(true);
        setQuery(event.target.value);
      },
      onFocus: () => {
        if (!disabled && query.trim()) setOpen(true);
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Tab') {
          setOpen(false);
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          if (!visible) setOpen(true);
          else if (places.length) setActive((current) => (current + 1) % places.length);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          if (visible && places.length) setActive((current) => (current <= 0 ? places.length - 1 : current - 1));
          return;
        }
        if (event.key === 'Enter') {
          if (visible && active >= 0) {
            event.preventDefault();
            pickActive();
          }
          return;
        }
        if (event.key === 'Escape' && visible) {
          event.preventDefault();
          setOpen(false);
        }
      },
    }),
    visible
      ? h('div', { className: 'drc-city-menu', id: 'drc-city-options', role: 'listbox', 'aria-label': t('locationSearch') },
        status === 'loading'
          ? h('div', { className: 'drc-city-empty' }, t('citySearching'))
          : status === 'error'
            ? h('div', { className: 'drc-city-empty is-error' },
              h('span', { className: 'drc-city-error-title' }, errorTitle),
              failure ? h('span', { className: 'drc-city-error-detail' }, failure) : null,
            )
            : status === 'ready' && places.length === 0
              ? h('div', { className: 'drc-city-empty' }, t('cityNoResults'))
              : places.map((place, index) => h('button', {
                key: `${place.id ?? 'city'}-${place.latitude}-${place.longitude}-${index}`,
                type: 'button',
                role: 'option',
                'aria-selected': index === active,
                className: `drc-city-option${index === active ? ' is-active' : ''}`,
                onMouseEnter: () => setActive(index),
                onClick: () => choose(place),
              },
              h('span', { className: 'drc-city-name' }, place.name),
              placeMeta(place) ? h('span', { className: 'drc-city-meta' }, placeMeta(place)) : null,
              )),
      )
      : null,
  );
}

function permissionGroup(api: PanelApi): React.ReactElement {
  const { t, locationResult, locationBusy, busy, requestLocation } = api;
  return h('div', { className: 'drc-group' },
    groupHead(t('locationPermission'), t('locationPermissionHint')),
    h('div', { className: 'drc-actions' },
      h(Btn, { primary: true, disabled: locationBusy || busy, onClick: () => void requestLocation() }, locationBusy ? t('locationRequesting') : t('locationRequest')),
      locationResult ? h('span', { className: 'drc-row-desc' }, `${t('locationStatus')} · ${accessLabel(t, locationResult.access)}`) : null,
    ),
  );
}

function providerGroup(api: PanelApi): React.ReactElement {
  const { t, settings, stage } = api;
  const provider = normalizeWeatherProvider(settings.weather?.provider);
  return h('div', { className: 'drc-group' },
    groupHead(t('weatherProvider'), t('weatherProviderHint')),
    h('div', { className: 'drc-actions' },
      h(Seg, {
        options: WEATHER_PROVIDERS.map((id) => ({ value: id, label: weatherProviderLabel(t, id) })),
        value: provider,
        onChange: (value) => stage({
          weather: {
            provider: value as WeatherProviderId,
            ...(value === 'nmc' ? { forecastMode: 'daily' } : {}),
          },
        }),
      }),
    ),
    h('div', { className: 'drc-actions' },
      h('span', { className: 'drc-row-desc' }, t(providerHintKey(provider))),
    ),
  );
}

interface QWeatherKeyPairProps {
  t: Translator;
  setDraft: PanelApi['setDraft'];
  setError: (value: string) => void;
}

/** Generate the Ed25519 key pair used for first-time QWeather setup. */
function QWeatherKeyPair({ t, setDraft, setError }: QWeatherKeyPairProps): React.ReactElement {
  const [publicKey, setPublicKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const generate = async (): Promise<void> => {
    setBusy(true);
    setNotice('');
    try {
      const payload = await postJson(QWEATHER_KEYPAIR_URL);
      const record = isRecord(payload) ? payload : {};
      const privateKey = typeof record.privateKey === 'string' ? record.privateKey : '';
      const nextPublicKey = typeof record.publicKey === 'string' ? record.publicKey : '';
      if (!privateKey || !nextPublicKey) throw new Error(t('qweatherKeyFailed'));
      setDraft((current) => ({ ...current, qweatherPrivateKey: privateKey }));
      setPublicKey(nextPublicKey);
      setNotice(t('qweatherKeyReady'));
    } catch (error) {
      setError(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(publicKey);
      setNotice(t('copied'));
    } catch {
      setError(t('error'));
    }
  };

  return h('div', { className: 'drc-token' },
    h('div', { className: 'drc-actions' },
      h(Btn, { primary: true, onClick: () => void generate(), disabled: busy }, busy ? t('qweatherGeneratingKey') : t('qweatherGenerateKey')),
      publicKey ? h(Btn, { small: true, onClick: () => void copy() }, t('qweatherCopyPublicKey')) : null,
      notice ? h('span', { className: 'drc-row-desc' }, notice) : null,
    ),
    h('p', { className: 'drc-row-desc' }, t('qweatherKeyHint')),
    publicKey
      ? h('div', { className: 'drc-public-key' },
        h('span', { className: 'drc-row-desc' }, t('qweatherPublicKey')),
        h('textarea', {
          className: 'drc-token-output',
          value: publicKey,
          readOnly: true,
          rows: 4,
          spellCheck: false,
          onFocus: (event: React.FocusEvent<HTMLTextAreaElement>) => event.currentTarget.select(),
        }),
      )
      : null,
  );
}

function QWeatherConsole({ api }: { api: PanelApi }): React.ReactElement {
  const { t, draft, setDraft, data, setError } = api;
  const initial = data.capabilities?.weather?.console ?? null;
  const [snapshot, setSnapshot] = useState<QWeatherConsoleSnapshot | null>(initial);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSnapshot(initial);
  }, [initial]);

  const sync = async (): Promise<void> => {
    setBusy(true);
    try {
      const payload = await postJson(QWEATHER_SYNC_URL);
      const record = isRecord(payload) ? payload : {};
      setSnapshot(isRecord(record.console) ? record.console as QWeatherConsoleSnapshot : null);
      await api.refreshData();
    } catch (error) {
      setError(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const monthly = typeof snapshot?.monthlyUsed === 'number' && Number.isFinite(snapshot.monthlyUsed)
    ? snapshot.monthlyUsed
    : null;
  const stats = snapshot?.stats;
  const errors = snapshot?.errors ?? [];
  const saved = data.settings.weather?.qweather;
  const dirty = !saved
    || saved.syncConsole !== true
    || saved.apiHost !== draft.qweatherApiHost.trim()
    || saved.credentialId !== draft.qweatherCredentialId.trim()
    || saved.projectId !== draft.qweatherProjectId.trim()
    || saved.developerId !== draft.qweatherDeveloperId.trim()
    || saved.privateKey !== draft.qweatherPrivateKey.trim()
    || (saved.monthlyLimit ?? QWEATHER_DEFAULT_MONTHLY_LIMIT) !== (Number(draft.qweatherMonthlyLimit) || QWEATHER_DEFAULT_MONTHLY_LIMIT)
    || (saved.refreshMinutes ?? QWEATHER_DEFAULT_REFRESH_MINUTES) !== (Number(draft.qweatherRefreshMinutes) || QWEATHER_DEFAULT_REFRESH_MINUTES);

  return h('div', { className: 'drc-console' },
    h('div', { className: 'drc-row' },
      h('div', { className: 'drc-row-main' },
        h('div', { className: 'drc-row-title' }, t('qweatherSyncConsole')),
        h('div', { className: 'drc-row-desc' }, t('qweatherSyncConsoleHint')),
      ),
      h('div', { className: 'drc-row-control' },
        h(Toggle, {
          checked: draft.qweatherSyncConsole,
          label: t('qweatherSyncConsole'),
          onChange: (checked) => setDraft((current) => ({ ...current, qweatherSyncConsole: checked })),
        }),
      ),
    ),
    draft.qweatherSyncConsole
      ? h('div', { className: 'drc-console-body' },
        h('div', { className: 'drc-actions' },
          h(Btn, { small: true, onClick: () => void sync(), disabled: busy || dirty }, busy ? t('qweatherSyncing') : t('qweatherSyncNow')),
          snapshot?.asOf
            ? h('span', { className: 'drc-row-desc' }, fill(t, 'qweatherConsoleAsOf', { asOf: snapshot.asOf }))
            : null,
        ),
        dirty
          ? h('div', { className: 'drc-row-desc' }, t('qweatherSyncSaveFirst'))
          : null,
        monthly !== null
          ? h('div', { className: 'drc-row-desc' }, fill(t, 'qweatherConsoleMonthly', { used: monthly }))
          : null,
        stats
          ? h('div', { className: 'drc-row-desc' }, fill(t, 'qweatherConsole24h', {
            total: stats.total ?? 0,
            success: stats.success ?? 0,
            errors: stats.errors ?? 0,
          }))
          : null,
        monthly === null && stats
          ? h('div', { className: 'drc-row-desc' }, t('qweatherConsoleNoMonthly'))
          : null,
        !stats && errors.length === 0
          ? h('div', { className: 'drc-row-desc' }, t('qweatherConsoleNever'))
          : null,
        errors.length > 0
          ? h('div', { className: 'drc-warning' }, t('qweatherConsolePermission'))
          : null,
      )
      : null,
  );
}

function QWeatherGroup({ api }: { api: PanelApi }): React.ReactElement {
  const { t, draft, setDraft, data } = api;
  const [editingKey, setEditingKey] = useState(false);
  const savedPrivateKey = data.settings.weather?.qweather?.privateKey ?? '';
  const showKeyEditor = !savedPrivateKey || editingKey;
  useEffect(() => {
    setEditingKey(false);
  }, [api.settingsVersion]);
  const cancelKeyEdit = (): void => {
    setDraft((current) => ({ ...current, qweatherPrivateKey: savedPrivateKey }));
    setEditingKey(false);
  };
  const capability = data.capabilities?.weather;
  const quota = capability?.quota;
  const limit = Number(draft.qweatherMonthlyLimit) || QWEATHER_DEFAULT_MONTHLY_LIMIT;
  const refresh = Number(draft.qweatherRefreshMinutes) || QWEATHER_DEFAULT_REFRESH_MINUTES;
  const minimum = minimumQWeatherRefreshMinutes(limit);
  const estimate = estimatedMonthlyCalls(Math.max(refresh, minimum));
  const estimateText = fill(t, 'qweatherEstimate', { calls: estimate });
  const usageText = quota
    ? `${fill(t, 'qweatherUsage', {
      used: quota.used ?? 0,
      limit: quota.limit ?? limit,
      month: quota.month ?? '',
    })} · ${estimateText}`
    : estimateText;
  const exhausted = quota?.exhausted === true;
  const actualProvider = capability?.provider;

  return h('div', { className: 'drc-group' },
    groupHead(t('qweatherAuth'), t('qweatherAuthHint')),
    showKeyEditor ? h(QWeatherKeyPair, { t, setDraft, setError: api.setError }) : null,
    h('div', { className: 'drc-fields' },
      h(Field, {
        label: t('qweatherDeveloperId'),
        value: draft.qweatherDeveloperId,
        onChange: (value) => setDraft((current) => ({ ...current, qweatherDeveloperId: value })),
      }),
      h(Field, {
        label: t('qweatherApiHost'),
        value: draft.qweatherApiHost,
        placeholder: 'xxxxxx.qweatherapi.com',
        onChange: (value) => setDraft((current) => ({ ...current, qweatherApiHost: value })),
      }),
    ),
    h('div', { className: 'drc-fields' },
      h(Field, {
        label: t('qweatherProjectId'),
        value: draft.qweatherProjectId,
        onChange: (value) => setDraft((current) => ({ ...current, qweatherProjectId: value })),
      }),
      h(Field, {
        label: t('qweatherCredentialId'),
        value: draft.qweatherCredentialId,
        placeholder: t('qweatherCredentialIdPlaceholder'),
        onChange: (value) => setDraft((current) => ({ ...current, qweatherCredentialId: value })),
      }),
    ),
    showKeyEditor
      ? h('div', null,
        h(TextArea, {
          label: t('qweatherPrivateKey'),
          value: draft.qweatherPrivateKey,
          rows: 5,
          mono: true,
          placeholder: '-----BEGIN PRIVATE KEY-----',
          onChange: (value) => setDraft((current) => ({ ...current, qweatherPrivateKey: value })),
        }),
        savedPrivateKey
          ? h('div', { className: 'drc-actions' },
            h(Btn, { small: true, onClick: cancelKeyEdit }, t('cancel')),
          )
          : null,
      )
      : h('div', { className: 'drc-row' },
        h('div', { className: 'drc-row-main' },
          h('div', { className: 'drc-row-title' }, t('qweatherPrivateKeyConfigured')),
          h('div', { className: 'drc-row-desc' }, t('qweatherPrivateKeyConfiguredHint')),
        ),
        h('div', { className: 'drc-row-control' },
          h(Btn, { small: true, onClick: () => setEditingKey(true) }, t('qweatherReplaceKey')),
        ),
      ),
    h('div', { className: 'drc-fields' },
      h(Field, {
        label: t('qweatherMonthlyLimit'),
        value: draft.qweatherMonthlyLimit,
        inputMode: 'numeric',
        onChange: (value) => setDraft((current) => ({ ...current, qweatherMonthlyLimit: value.replace(/[^\d]/g, '') })),
      }),
      h(Field, {
        label: t('qweatherRefreshMinutes'),
        value: draft.qweatherRefreshMinutes,
        inputMode: 'numeric',
        onChange: (value) => setDraft((current) => ({ ...current, qweatherRefreshMinutes: value.replace(/[^\d]/g, '') })),
      }),
    ),
    refresh < minimum
      ? h('div', { className: 'drc-actions' }, h('span', { className: 'drc-warning' }, fill(t, 'qweatherRefreshMinimum', { minutes: minimum })))
      : null,
    h('div', { className: 'drc-actions' },
      h('span', { className: 'drc-row-desc' }, usageText),
    ),
    exhausted
      ? h('div', { className: 'drc-warning' }, fill(t, 'qweatherQuotaExhausted', { provider: weatherProviderLabel(t, actualProvider) }))
      : null,
    h('div', { className: 'drc-divider' }),
    h(QWeatherConsole, { api }),
  );
}

function locationGroup(api: PanelApi): React.ReactElement {
  const { t, settings, draft, stage } = api;
  const provider = normalizeWeatherProvider(settings.weather?.provider);
  const manual = (settings.weather?.mode ?? 'auto') === 'manual';
  const location = settings.weather?.locations?.[provider];
  const name = settings.weather?.name ?? '';
  const capability = api.data.capabilities?.weather;
  const hasCoordinates = location?.latitude !== null && location?.latitude !== undefined
    && location?.longitude !== null && location?.longitude !== undefined;
  const hasId = Boolean(location?.locationId);
  const selected = hasCoordinates || hasId;
  const autoLocation = capability?.location;
  const systemAutoLocation = Boolean(autoLocation && isSystemLocationSource(autoLocation.source));
  const autoName = autoLocation?.name?.trim();
  const hasAutoName = Boolean(autoName && autoName !== '当前位置');
  const qweather: QWeatherSettings = {
    apiHost: draft.qweatherApiHost,
    credentialId: draft.qweatherCredentialId,
    projectId: draft.qweatherProjectId,
    developerId: draft.qweatherDeveloperId,
    privateKey: draft.qweatherPrivateKey,
    monthlyLimit: Number(draft.qweatherMonthlyLimit) || QWEATHER_DEFAULT_MONTHLY_LIMIT,
    refreshMinutes: Number(draft.qweatherRefreshMinutes) || QWEATHER_DEFAULT_REFRESH_MINUTES,
  };

  const hint = manual
    ? selected
      ? provider === 'nmc'
        ? fill(t, 'locationMatchedId', { name: name || '—', id: location?.locationId || '—' })
        : fill(t, 'locationMatchedCoords', {
          name: name || '—',
          latitude: Number(location?.latitude ?? 0).toFixed(4),
          longitude: Number(location?.longitude ?? 0).toFixed(4),
        })
      : t('locationNotSelected')
    : systemAutoLocation && hasAutoName && typeof autoLocation?.latitude === 'number' && typeof autoLocation?.longitude === 'number'
      ? fill(t, 'locationAutoNamedCoords', {
        name: autoName || '',
        latitude: Number(autoLocation.latitude).toFixed(3),
        longitude: Number(autoLocation.longitude).toFixed(3),
      })
      : systemAutoLocation && typeof autoLocation?.latitude === 'number' && typeof autoLocation?.longitude === 'number'
        ? fill(t, 'locationAutoSystem', {
          latitude: Number(autoLocation.latitude).toFixed(3),
          longitude: Number(autoLocation.longitude).toFixed(3),
        })
        : t('locationAutoHint');

  const choosePlace = (place: GeocodePlace): void => {
    stage({
      weather: {
        name: place.name,
        locations: {
          ...(settings.weather?.locations ?? {}),
          [provider]: {
            latitude: place.latitude,
            longitude: place.longitude,
            locationId: String(place.id ?? ''),
            timezone: place.timezone ?? '',
            country: place.country ?? '',
          },
        },
      },
    });
  };

  return h('div', { className: 'drc-group' },
    groupHead(t('weatherSource'), t('weatherHint')),
    h('div', { className: 'drc-actions' },
      h(Seg, {
        options: [{ value: 'auto', label: t('auto') }, { value: 'manual', label: t('manual') }],
        value: settings.weather?.mode ?? 'auto',
        onChange: (value) => stage({ weather: { mode: value } }),
      }),
    ),
    h('div', { className: 'drc-divider' }),
    manual
      ? h('div', { className: 'drc-fields' },
        h(CitySearch, {
          t,
          provider,
          initialValue: selected ? name : '',
          disabled: !manual,
          qweather,
          onSelect: choosePlace,
        }),
      )
      : null,
    h('div', { className: 'drc-actions' },
      h('span', { className: `drc-row-desc${manual && !selected ? ' is-warning' : ''}` }, hint),
    ),
  );
}

function forecastGroup(api: PanelApi): React.ReactElement {
  const { t, settings, stage } = api;
  const provider = normalizeWeatherProvider(settings.weather?.provider);
  const limited = provider === 'nmc';
  const mode = limited ? 'daily' : (settings.weather?.forecastMode ?? 'hourly');
  return h('div', { className: 'drc-group' },
    groupHead(t('forecastDisplay'), t('forecastDisplayHint')),
    h('div', { className: 'drc-actions' },
      h(Seg, {
        options: [{ value: 'hourly', label: t('hourly') }, { value: 'daily', label: t('daily') }],
        value: mode,
        disabled: limited,
        onChange: (value) => stage({ weather: { forecastMode: value } }),
      }),
    ),
    limited
      ? h('div', { className: 'drc-actions' }, h('span', { className: 'drc-row-desc' }, t('forecastNmcHint')))
      : null,
  );
}

export function renderWeather(api: PanelApi): React.ReactElement {
  const { t, settings } = api;
  const provider = normalizeWeatherProvider(settings.weather?.provider);
  return h('div', { className: 'drc-section' },
    sectionHead(t('weather'), t('weatherPageHint')),
    permissionGroup(api),
    providerGroup(api),
    provider === 'qweather' ? h(QWeatherGroup, { api }) : null,
    locationGroup(api),
    forecastGroup(api),
  );
}
