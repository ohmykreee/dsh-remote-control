/** Pomodoro and countdown settings: enablement, durations, presets, and alert sound. */

import type * as React from 'react';
import { Btn, Field, Row, Toggle, groupHead, h, sectionHead } from '../ui.js';
import { COUNTDOWN_PRESET_LIMIT } from '../logic.js';
import type { PanelApi, StagedSettings } from '../types.js';

function pomodoroGroup(api: PanelApi): React.ReactElement {
  const { t, settings, draft, setDraft, stage } = api;
  return h('div', { className: 'drc-group' },
    h(Row, { title: t('pomodoroEnable'), description: t('pomodoroEnableHint') },
      h(Toggle, {
        checked: Boolean(settings.pomodoro?.enabled),
        label: t('pomodoroEnable'),
        onChange: (checked) => {
          const patch: StagedSettings = { pomodoro: { enabled: checked } };
          if (checked) patch.countdown = { enabled: false };
          stage(patch);
        },
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
  );
}

function countdownGroup(api: PanelApi): React.ReactElement {
  const { t, settings, draft, setDraft, stage } = api;
  const presets = draft.countdownPresets;

  const updatePreset = (index: number, value: string): void => {
    setDraft((current) => {
      const next = [...current.countdownPresets];
      next[index] = value;
      return { ...current, countdownPresets: next };
    });
  };

  const removePreset = (index: number): void => {
    setDraft((current) => {
      if (current.countdownPresets.length <= 1) return current;
      return {
        ...current,
        countdownPresets: current.countdownPresets.filter((_, position) => position !== index),
      };
    });
  };

  const addPreset = (): void => {
    setDraft((current) => current.countdownPresets.length >= COUNTDOWN_PRESET_LIMIT
      ? current
      : { ...current, countdownPresets: [...current.countdownPresets, ''] });
  };

  return h('div', { className: 'drc-group' },
    h(Row, { title: t('countdownEnable'), description: t('countdownEnableHint') },
      h(Toggle, {
        checked: Boolean(settings.countdown?.enabled),
        label: t('countdownEnable'),
        onChange: (checked) => {
          const patch: StagedSettings = { countdown: { enabled: checked } };
          if (checked) patch.pomodoro = { enabled: false };
          stage(patch);
        },
      }),
    ),
    h('div', { className: 'drc-divider' }),
    groupHead(t('countdownPresets'), t('countdownHint')),
    h('div', { className: 'drc-list' }, presets.map((value, index) => h('div', {
      className: 'drc-preset-row',
      key: `preset-${index}`,
    },
    h('label', { className: 'drc-preset-main' },
      h('span', { className: 'drc-preset-label' }, t(`countdownPreset${index + 1}`)),
      h('input', {
        className: 'drc-map-input drc-preset-input',
        value,
        placeholder: t('countdownPresetPlaceholder'),
        inputMode: 'numeric',
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => updatePreset(index, event.target.value),
      }),
    ),
    h(Btn, {
      small: true,
      danger: true,
      disabled: presets.length <= 1,
      title: t('removePreset'),
      onClick: () => removePreset(index),
    }, t('removePreset')),
    ))),
    h('div', { className: 'drc-actions' },
      h(Btn, {
        small: true,
        onClick: addPreset,
        disabled: presets.length >= COUNTDOWN_PRESET_LIMIT,
      }, t('addPreset')),
      h('span', { className: 'drc-preset-count' }, `${presets.length}/${COUNTDOWN_PRESET_LIMIT}`),
      h('span', { className: 'drc-group-desc' }, t('countdownPresetLimitHint')),
    ),
  );
}

function soundGroup(api: PanelApi): React.ReactElement {
  const { t, draft, setDraft } = api;
  return h('div', { className: 'drc-group' },
    groupHead(t('pomodoroSoundSection'), t('pomodoroSoundHint')),
    h('div', { className: 'drc-fields' },
      h(Field, { label: t('pomodoroSound'), value: draft.pomodoroSound, placeholder: t('pomodoroSoundPlaceholder'), onChange: (value) => setDraft((current) => ({ ...current, pomodoroSound: value })) }),
    ),
  );
}

export function renderPomodoro(api: PanelApi): React.ReactElement {
  return h('div', { className: 'drc-section' },
    sectionHead(api.t('pomodoro'), api.t('pomodoroHint')),
    pomodoroGroup(api),
    countdownGroup(api),
    soundGroup(api),
  );
}
