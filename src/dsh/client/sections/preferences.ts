/** Preferences section: units, theme, page order, and navigation placement. */

import type * as React from 'react';
import { Seg, Toggle, groupHead, h, sectionHead } from '../ui.js';
import type { PanelApi } from '../types.js';

function unitGroup(api: PanelApi): React.ReactElement {
  const { t, settings, stage } = api;
  return h('div', { className: 'drc-group' },
    groupHead(t('temperatureUnit'), t('temperatureUnitHint')),
    h('div', { className: 'drc-actions' },
      h(Seg, {
        options: [
          { value: 'celsius', label: t('celsius') },
          { value: 'fahrenheit', label: t('fahrenheit') },
        ],
        value: settings.temperatureUnit ?? 'celsius',
        onChange: (value) => stage({ temperatureUnit: value }),
      }),
    ),
  );
}

function themeGroup(api: PanelApi): React.ReactElement {
  const { t, settings, stage } = api;
  return h('div', { className: 'drc-group' },
    groupHead(t('theme'), t('themeHint')),
    h('div', { className: 'drc-actions' },
      h(Seg, {
        options: [
          { value: 'dsh', label: t('followDsh') },
          { value: 'light', label: t('light') },
          { value: 'dark', label: t('dark') },
        ],
        value: settings.theme,
        onChange: (value) => stage({ theme: value }),
      }),
    ),
  );
}

function orderRows(api: PanelApi): React.ReactElement[] {
  const { t, order, labels, draggingKey, dragIndex, settings, togglePage, startOrderDrag } = api;
  const rows: React.ReactElement[] = [];
  const remaining = draggingKey ? order.filter((key) => key !== draggingKey) : order;
  const rawIndex = draggingKey ? (dragIndex == null ? order.indexOf(draggingKey) : dragIndex) : -1;
  const insertAt = draggingKey ? Math.max(0, Math.min(rawIndex, remaining.length)) : -1;
  let visualIndex = 0;
  const placeholder = (): React.ReactElement => h('div', { className: 'drc-order-placeholder', key: 'order-placeholder' },
    h('span', { className: 'drc-drag-handle', 'aria-hidden': 'true' }, '⋮⋮'),
    h('span', { className: 'drc-order-placeholder-title' }, labels[draggingKey ?? ''] || ''),
  );

  for (const key of order) {
    if (key === draggingKey) {
      // Keep the dragged row mounted so its state survives, but take it out of
      // layout; the dashed placeholder marks the insertion point.
      rows.push(h('div', { className: 'drc-order-row is-dragging', key },
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
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => startOrderDrag(key, event),
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
}

function orderGroup(api: PanelApi): React.ReactElement {
  const { t, orderListRef } = api;
  return h('div', { className: 'drc-group' },
    groupHead(t('pageOrder'), t('pageOrderHint')),
    h('div', { className: 'drc-list', ref: orderListRef }, orderRows(api)),
  );
}

function navGroup(api: PanelApi): React.ReactElement {
  const { t, settings, stage } = api;
  return h('div', { className: 'drc-group' },
    groupHead(t('navPosition'), t('navPositionHint')),
    h('div', { className: 'drc-actions' },
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
    ),
  );
}

export function renderPreferences(api: PanelApi): React.ReactElement {
  return h('div', { className: 'drc-section' },
    sectionHead(api.t('menuPlugin'), api.t('preferencesHint')),
    unitGroup(api),
    themeGroup(api),
    orderGroup(api),
    navGroup(api),
  );
}
