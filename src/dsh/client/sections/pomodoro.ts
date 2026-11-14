/** Pomodoro and countdown settings: enablement, durations, presets, and alert sound. */

import type * as React from 'react';
import { Btn, Field, Row, Toggle, groupHead, h, sectionHead } from '../ui.js';
import {
  COUNTDOWN_PRESET_LIMIT,
  POMODORO_MAX_BREAK_MINUTES,
  POMODORO_MAX_FOCUS_MINUTES,
  POMODORO_MIN_MINUTES,
  capMinuteInput,
  capPresetDraft,
  sanitizeMinuteInput,
} from '../logic.js';
import type { PanelApi, StagedSettings } from '../types.js';

/** Minute fields accept up to two decimals and cap to the limits on blur. */
function minuteField(
  label: string,
  value: string,
  max: number,
  onChange: (value: string) => void,
): React.ReactElement {
  return h(Field, {
    label,
    value,
    placeholder: '25',
    inputMode: 'decimal',
    onChange: (next) => onChange(sanitizeMinuteInput(next)),
    onBlur: () => onChange(capMinuteInput(value, POMODORO_MIN_MINUTES, max)),
  });
}

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
    groupHead(t('pomodoroDurations'), t('pomodoroDurationHint')),
    h('div', { className: 'drc-fields' },
      minuteField(t('pomodoroFocus'), draft.pomodoroFocus, POMODORO_MAX_FOCUS_MINUTES, (value) => setDraft((current) => ({ ...current, pomodoroFocus: value }))),
      minuteField(t('pomodoroBreak'), draft.pomodoroBreak, POMODORO_MAX_BREAK_MINUTES, (value) => setDraft((current) => ({ ...current, pomodoroBreak: value }))),
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

  const updatePreset = (index: number, part: 'minutes' | 'seconds', value: string): void => {
    setDraft((current) => ({
      ...current,
      countdownPresets: current.countdownPresets.map((preset, position) => position === index
        ? { ...preset, [part]: value.replace(/[^\d]/g, '') }
        : preset),
    }));
  };

  /**
   * Cap a preset row on blur: seconds carry into minutes and the total stays
   * inside the supported 1–86400 second range.
   */
  const capPreset = (index: number): void => {
    setDraft((current) => ({
      ...current,
      countdownPresets: current.countdownPresets.map((preset, position) => position === index ? capPresetDraft(preset) : preset),
    }));
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
      : { ...current, countdownPresets: [...current.countdownPresets, { minutes: '', seconds: '' }] });
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
    h('div', { className: 'drc-list' }, presets.map((preset, index) => h('div', {
      className: 'drc-preset-row',
      key: `preset-${index}`,
    },
    h('label', { className: 'drc-preset-main' },
      h('span', { className: 'drc-preset-label' }, t(`countdownPreset${index + 1}`)),
      h('span', { className: 'drc-preset-duration' },
        h('input', {
          className: 'drc-map-input drc-preset-part',
          value: preset.minutes,
          placeholder: '0',
          inputMode: 'numeric',
          'aria-label': `${t(`countdownPreset${index + 1}`)} ${t('durationMinutes')}`,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => updatePreset(index, 'minutes', event.target.value),
          onBlur: () => capPreset(index),
        }),
        h('span', { className: 'drc-preset-unit' }, t('durationMinutes')),
        h('input', {
          className: 'drc-map-input drc-preset-part',
          value: preset.seconds,
          placeholder: '0',
          inputMode: 'numeric',
          'aria-label': `${t(`countdownPreset${index + 1}`)} ${t('durationSeconds')}`,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => updatePreset(index, 'seconds', event.target.value),
          onBlur: () => capPreset(index),
        }),
        h('span', { className: 'drc-preset-unit' }, t('durationSeconds')),
      ),
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
