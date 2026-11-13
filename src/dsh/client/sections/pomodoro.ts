/** Pomodoro settings: enablement, durations, alert sound, and looping. */

import type * as React from 'react';
import { Field, Row, Toggle, groupHead, h, sectionHead } from '../ui.js';
import type { PanelApi } from '../types.js';

export function renderPomodoro(api: PanelApi): React.ReactElement {
  const { t, settings, draft, setDraft, stage } = api;
  return h('div', { className: 'drc-section' },
    sectionHead(t('pomodoro'), t('pomodoroHint')),
    h('div', { className: 'drc-group' },
      h(Row, { title: t('pomodoroEnable'), description: t('pomodoroEnableHint') },
        h(Toggle, {
          checked: Boolean(settings.pomodoro?.enabled),
          label: t('pomodoroEnable'),
          onChange: (checked) => stage({ pomodoro: { enabled: checked } }),
        }),
      ),
      h('div', { className: 'drc-divider' }),
      h('div', { className: 'drc-fields' },
        h(Field, { label: t('pomodoroFocus'), value: draft.pomodoroFocus, placeholder: '25', inputMode: 'numeric', onChange: (value) => setDraft((current) => ({ ...current, pomodoroFocus: value })) }),
        h(Field, { label: t('pomodoroBreak'), value: draft.pomodoroBreak, placeholder: '5', inputMode: 'numeric', onChange: (value) => setDraft((current) => ({ ...current, pomodoroBreak: value })) }),
      ),
      h('div', { className: 'drc-divider' }),
      h(Row, { title: t('pomodoroLoop'), description: t('pomodoroLoopHint') },
        h(Toggle, {
          checked: Boolean(settings.pomodoro?.loopAlarm),
          label: t('pomodoroLoop'),
          onChange: (checked) => stage({ pomodoro: { loopAlarm: checked } }),
        }),
      ),
    ),
    h('div', { className: 'drc-group' },
      groupHead(t('pomodoroSoundSection'), t('pomodoroSoundHint')),
      h('div', { className: 'drc-fields' },
        h(Field, { label: t('pomodoroSound'), value: draft.pomodoroSound, placeholder: t('pomodoroSoundPlaceholder'), onChange: (value) => setDraft((current) => ({ ...current, pomodoroSound: value })) }),
      ),
    ),
  );
}
