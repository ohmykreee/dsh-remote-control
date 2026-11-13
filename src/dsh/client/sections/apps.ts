/** App-name mapping: notification and media display names, saved immediately. */

import type * as React from 'react';
import { Btn, groupHead, h, sectionHead } from '../ui.js';
import type { PanelApi } from '../types.js';

export function renderAppMapping(api: PanelApi): React.ReactElement {
  const { t, data, appNames, setAppNames, appBusyKey, saveAppName } = api;
  const apps = data.apps ?? [];
  return h('div', { className: 'drc-section' },
    sectionHead(t('appMapping'), t('appsPageHint')),
    h('div', { className: 'drc-group' },
      groupHead(t('appNamesBlock'), t('appMappingHint')),
      apps.length === 0
        ? h('p', { className: 'drc-empty' }, t('noApps'))
        : h('div', { className: 'drc-list' }, apps.map((app) => h('div', { className: 'drc-map-row', key: app.key },
          h('div', { className: 'drc-map-main' },
            h('input', {
              className: 'drc-map-input',
              value: appNames[app.key] ?? app.name,
              placeholder: app.defaultName || app.key,
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
