/** App-name mapping: notification and media display names, saved immediately. */

import type * as React from 'react';
import { useState } from 'react';
import { Btn, groupHead, h, sectionHead } from '../ui.js';
import type { PanelApi } from '../types.js';

function AppMappingSection({ api }: { api: PanelApi }): React.ReactElement {
  const { t, data, appNames, setAppNames, appBusyKey, saveAppName } = api;
  const apps = data.apps ?? [];
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const visibleApps = needle
    ? apps.filter((app) => `${app.name || ''} ${app.key}`.toLowerCase().includes(needle))
    : apps;

  return h('div', { className: 'drc-section' },
    sectionHead(t('appMapping'), t('appsPageHint')),
    h('div', { className: 'drc-group' },
      groupHead(t('appNamesBlock'), t('appMappingHint'), 'appNames'),
      apps.length > 0
        ? h('div', { className: 'drc-search' },
          h('input', {
            className: 'drc-map-input',
            type: 'search',
            value: query,
            placeholder: t('appSearchPlaceholder'),
            'aria-label': t('appSearchPlaceholder'),
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value),
          }),
          h('div', { className: 'drc-divider', 'aria-hidden': 'true' }),
        )
        : null,
      apps.length === 0
        ? h('p', { className: 'drc-empty' }, t('noApps'))
        : visibleApps.length === 0
          ? h('p', { className: 'drc-empty' }, t('appSearchEmpty'))
          : h('div', { className: 'drc-list' }, visibleApps.map((app) => h('div', { className: 'drc-map-row', key: app.key },
            h('div', { className: 'drc-map-main' },
              h('input', {
                className: 'drc-map-input',
                value: appNames[app.key] ?? app.name,
                placeholder: app.defaultName || app.key,
                maxLength: 60,
                onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                  const value = event.target.value;
                  setAppNames((current) => ({ ...current, [app.key]: value }));
                },
                onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
                  if (event.key === 'Enter') void saveAppName(app.key, event.currentTarget.value);
                },
              }),
              h('small', { className: 'drc-code drc-map-key', title: app.key }, app.key),
            ),
            h('div', { className: 'drc-map-meta' },
              (app.sources ?? []).map((source) => h('span', { className: 'drc-tag', key: source }, source === 'music' ? t('sourceMusic') : t('sourceNotification'))),
              h(Btn, { small: true, onClick: () => void saveAppName(app.key, appNames[app.key] ?? app.name), disabled: appBusyKey === app.key }, t('save')),
              h(Btn, { small: true, onClick: () => void saveAppName(app.key, ''), disabled: appBusyKey === app.key || !app.customName }, t('resetName')),
            ),
          ))),
    ),
  );
}

export function renderAppMapping(api: PanelApi): React.ReactElement {
  return h(AppMappingSection, { api });
}
