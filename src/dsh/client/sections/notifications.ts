/** Notifications section: remote answers, visible apps, and display limit. */

import type * as React from 'react';
import { Btn, Field, Row, Toggle, groupHead, h, sectionHead } from '../ui.js';
import type { PanelApi } from '../types.js';

export function renderNotifications(api: PanelApi): React.ReactElement {
  const { t, data, settings, draft, setDraft, stage, selectedApps, toggleApp, selectAllApps } = api;
  const apps = data.apps ?? [];
  return h('div', { className: 'drc-section' },
    sectionHead(t('notifications'), t('notificationsPageHint')),
    h('div', { className: 'drc-group' },
      groupHead(t('pushQuestions'), t('pushQuestionsHint')),
      h(Row, { title: t('pushQuestionsToggle') },
        h(Toggle, {
          checked: Boolean(settings.notifications?.pushQuestions),
          label: t('pushQuestions'),
          onChange: (checked) => stage({ notifications: { pushQuestions: checked } }),
        }),
      ),
    ),
    h('div', { className: 'drc-group' },
      groupHead(t('notificationApps'), t('notificationsHint')),
      apps.length === 0
        ? h('p', { className: 'drc-empty' }, t('noApps'))
        : h('div', { className: 'drc-apps' }, apps.map((app) => h('button', {
          key: app.key,
          type: 'button',
          className: `drc-app${selectedApps.includes(app.key) ? ' is-on' : ''}`,
          onClick: () => toggleApp(app.key),
        }, h('i'), app.name))),
      h('div', { className: 'drc-actions' },
        h(Btn, { onClick: selectAllApps }, t('allApps')),
      ),
    ),
    h('div', { className: 'drc-group' },
      groupHead(t('limitDisplay'), t('notificationLimitHint')),
      h('div', { className: 'drc-fields' },
        h(Field, { label: t('limitField'), value: draft.notificationLimit, placeholder: '5', inputMode: 'numeric', onChange: (value) => setDraft((current) => ({ ...current, notificationLimit: value })) }),
      ),
    ),
  );
}
