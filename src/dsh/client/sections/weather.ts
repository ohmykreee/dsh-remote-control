/** Weather section: location permission, city search, source, and forecast mode. */

import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Btn, Field, Seg, groupHead, h, sectionHead } from '../ui.js';
import type { GeocodePlace, PanelApi, Translator } from '../types.js';
import { accessLabel } from '../logic.js';
import { GEOCODE_URL, describeError, isRecord, requestJson } from '../api.js';

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';

interface CitySearchProps {
  t: Translator;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
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
    places.push({
      id: Number.isFinite(Number(item.id)) ? Number(item.id) : undefined,
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

/**
 * City combobox for the manual weather location. Typing queries the Host's
 * Open-Meteo geocoding proxy after a short debounce; picking a result hands the
 * coordinates to the section, which writes them into the coordinate fields.
 */
function CitySearch({ t, value, disabled, onChange, onSelect }: CitySearchProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [places, setPlaces] = useState<GeocodePlace[]>([]);
  const [active, setActive] = useState(-1);
  const [failure, setFailure] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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
    const query = value.trim();
    if (!query) {
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
      requestJson(`${GEOCODE_URL}?q=${encodeURIComponent(query)}`, { signal: controller.signal })
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
  }, [open, disabled, value]);

  const visible = open && !disabled && value.trim().length > 0;

  const choose = (place: GeocodePlace): void => {
    onSelect(place);
    setOpen(false);
    inputRef.current?.blur();
  };

  const pickActive = (): void => {
    if (active >= 0 && places[active]) choose(places[active]);
  };

  return h('div', { className: 'drc-field drc-city', ref: wrapRef },
    h('span', null, t('locationName')),
    h('input', {
      ref: inputRef,
      value,
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
        onChange(event.target.value);
      },
      onFocus: () => {
        if (!disabled && value.trim()) setOpen(true);
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
      ? h('div', { className: 'drc-city-menu', id: 'drc-city-options', role: 'listbox', 'aria-label': t('locationName') },
        status === 'loading'
          ? h('div', { className: 'drc-city-empty' }, t('citySearching'))
          : status === 'error'
            ? h('div', { className: 'drc-city-empty is-error' },
              h('span', { className: 'drc-city-error-title' },
                /\b404\b/.test(failure) ? t('citySearchUnavailable') : t('citySearchFailed')),
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

function locationGroup(api: PanelApi): React.ReactElement {
  const { t, locationResult, locationBusy, busy, requestLocation } = api;
  return h('div', { className: 'drc-group' },
    groupHead(t('locationPermission'), t('locationPermissionHint')),
    h('div', { className: 'drc-actions' },
      h(Btn, { primary: true, disabled: locationBusy || busy, onClick: () => void requestLocation() }, locationBusy ? t('locationRequesting') : t('locationRequest')),
      locationResult ? h('span', { className: 'drc-row-desc' }, `${t('locationStatus')} · ${accessLabel(t, locationResult.access)}`) : null,
    ),
  );
}

export function renderWeather(api: PanelApi): React.ReactElement {
  const { t, settings, draft, setDraft, stage } = api;
  const manual = (settings.weather?.mode ?? 'auto') === 'manual';
  const choosePlace = (place: GeocodePlace): void => {
    setDraft((current) => ({
      ...current,
      locationName: place.name,
      latitude: place.latitude.toFixed(4),
      longitude: place.longitude.toFixed(4),
    }));
  };
  return h('div', { className: 'drc-section' },
    sectionHead(t('weather'), t('weatherPageHint')),
    locationGroup(api),
    h('div', { className: 'drc-group' },
      groupHead(t('weatherSource'), t('weatherHint')),
      h('div', { className: 'drc-actions' },
        h(Seg, {
          options: [{ value: 'auto', label: t('auto') }, { value: 'manual', label: t('manual') }],
          value: settings.weather?.mode ?? 'auto',
          onChange: (value) => stage({ weather: { mode: value } }),
        }),
      ),
      h('div', { className: 'drc-divider' }),
      h('div', { className: 'drc-fields' },
        h(CitySearch, {
          t,
          value: draft.locationName,
          disabled: !manual,
          onChange: (value) => setDraft((current) => ({ ...current, locationName: value })),
          onSelect: choosePlace,
        }),
        h(Field, { label: t('latitude'), value: draft.latitude, placeholder: '0.0000', inputMode: 'decimal', disabled: !manual, onChange: (value) => setDraft((current) => ({ ...current, latitude: value })) }),
        h(Field, { label: t('longitude'), value: draft.longitude, placeholder: '0.0000', inputMode: 'decimal', disabled: !manual, onChange: (value) => setDraft((current) => ({ ...current, longitude: value })) }),
      ),
      h('div', { className: 'drc-actions' },
        h('span', { className: 'drc-row-desc' }, manual ? t('citySearchHint') : t('locationAutoHint')),
      ),
    ),
    h('div', { className: 'drc-group' },
      groupHead(t('forecastDisplay'), t('forecastDisplayHint')),
      h('div', { className: 'drc-actions' },
        h(Seg, {
          options: [{ value: 'hourly', label: t('hourly') }, { value: 'daily', label: t('daily') }],
          value: settings.weather?.forecastMode ?? 'hourly',
          onChange: (value) => stage({ weather: { forecastMode: value } }),
        }),
      ),
    ),
  );
}
