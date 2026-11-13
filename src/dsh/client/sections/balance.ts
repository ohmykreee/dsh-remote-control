/** Balance section: spend window, low-balance alert, and the peak/valley marker. */

import type * as React from 'react';
import { Field, Row, Seg, Toggle, groupHead, h, sectionHead } from '../ui.js';
import type { PanelApi } from '../types.js';

export function renderBalance(api: PanelApi): React.ReactElement {
  const { t, settings, draft, setDraft, stage } = api;
  return h('div', { className: 'drc-section' },
    sectionHead(t('balance'), t('balancePageHint')),
    h('div', { className: 'drc-group' },
      groupHead(t('balanceSpend'), t('balanceHint')),
      h('div', { className: 'drc-actions' },
        h(Seg, {
          options: [{ value: 'calendar', label: t('calendar') }, { value: 'rolling', label: t('rolling') }],
          value: settings.balance?.spendWindow ?? 'calendar',
          onChange: (value) => stage({ balance: { spendWindow: value } }),
        }),
      ),
    ),
    h('div', { className: 'drc-group' },
      groupHead(t('lowThreshold'), t('lowThresholdHint')),
      h('div', { className: 'drc-fields' },
        h(Field, { label: t('lowThreshold'), value: draft.threshold, placeholder: '例如：5', inputMode: 'decimal', onChange: (value) => setDraft((current) => ({ ...current, threshold: value })) }),
      ),
    ),
    h('div', { className: 'drc-group' },
      groupHead(t('peakValleyBlock'), t('peakValleyHint')),
      h(Row, { title: t('peakValleyToggle') },
        h(Toggle, {
          checked: settings.balance?.showPeakValley !== false,
          label: t('peakValley'),
          onChange: (checked) => stage({ balance: { showPeakValley: checked } }),
        }),
      ),
    ),
  );
}
