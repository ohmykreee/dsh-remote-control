/** Weather section: location permission, source, coordinates, and forecast mode. */

import type * as React from 'react';
import { Btn, Field, Seg, groupHead, h, sectionHead } from '../ui.js';
import type { PanelApi } from '../types.js';
import { accessLabel } from '../logic.js';

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
        h(Field, { label: t('locationName'), value: draft.locationName, placeholder: '例如：示例城市', onChange: (value) => setDraft((current) => ({ ...current, locationName: value })) }),
        h(Field, { label: t('latitude'), value: draft.latitude, placeholder: '0.0000', inputMode: 'decimal', onChange: (value) => setDraft((current) => ({ ...current, latitude: value })) }),
        h(Field, { label: t('longitude'), value: draft.longitude, placeholder: '0.0000', inputMode: 'decimal', onChange: (value) => setDraft((current) => ({ ...current, longitude: value })) }),
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
