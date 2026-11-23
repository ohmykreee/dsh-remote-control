/** Presentational primitives styled only through DSH theme tokens. */

import * as React from 'react';
import type { JumpTarget, Translator } from './types.js';

export const h = React.createElement;

export interface SegOption {
  value: string;
  label: string;
}

export interface ToggleProps {
  checked?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export interface SegProps {
  options: SegOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export interface BtnProps {
  children?: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  small?: boolean;
  title?: string;
}

export interface FieldProps {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  disabled?: boolean;
  /** Mark the field as failing validation without adding a new visual language. */
  invalid?: boolean;
}

export interface TextAreaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  mono?: boolean;
  invalid?: boolean;
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

export interface RowProps {
  title: string;
  description?: React.ReactNode;
  /** Jump anchor; targets `jump()` from a hint and flashes this row. */
  anchor?: string;
  children?: React.ReactNode;
}

export interface StatusRowProps {
  label: string;
  value?: boolean;
  detail?: React.ReactNode;
  okLabel: string;
  badLabel: string;
  pendingLabel: string;
}

export function Toggle({ checked, onChange, label, disabled = false }: ToggleProps): React.ReactElement {
  return h('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': checked,
    'aria-label': label,
    'aria-disabled': disabled || undefined,
    disabled,
    className: `drc-toggle${checked ? ' is-on' : ''}`,
    onClick: () => onChange(!checked),
  }, h('i'));
}

export function Seg({ options, value, onChange, disabled = false }: SegProps): React.ReactElement {
  return h('div', { className: `drc-seg${disabled ? ' is-disabled' : ''}`, role: 'group' }, options.map((option) => h('button', {
    key: option.value,
    type: 'button',
    disabled,
    className: value === option.value ? 'is-active' : '',
    'aria-pressed': value === option.value,
    onClick: () => onChange(option.value),
  }, option.label)));
}

export function Btn({ children, onClick, primary = false, danger = false, disabled = false, small = false, title }: BtnProps): React.ReactElement {
  const classes = ['drc-btn'];
  if (primary) classes.push('is-primary');
  if (danger) classes.push('is-danger');
  if (small) classes.push('is-sm');
  return h('button', { type: 'button', className: classes.join(' '), onClick, disabled, title }, children);
}

export function Field({ label, value, onChange, onBlur, placeholder, inputMode, disabled = false, invalid = false }: FieldProps): React.ReactElement {
  return h('label', { className: 'drc-field' },
    h('span', null, label),
    h('input', {
      value: value ?? '',
      placeholder,
      inputMode,
      disabled,
      'aria-invalid': invalid || undefined,
      onBlur,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
    }),
  );
}

export function TextArea({ label, value, onChange, placeholder, rows = 4, disabled = false, mono = false, invalid = false }: TextAreaProps): React.ReactElement {
  return h('label', { className: `drc-field drc-field-area${mono ? ' is-mono' : ''}` },
    h('span', null, label),
    h('textarea', {
      value,
      placeholder,
      rows,
      disabled,
      spellCheck: false,
      autoComplete: 'off',
      'aria-invalid': invalid || undefined,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value),
    }),
  );
}

export function Select({ label, value, options, onChange, disabled = false }: SelectProps): React.ReactElement {
  const known = options.some((option) => option.value === value);
  return h('label', { className: 'drc-field' },
    h('span', null, label),
    h('select', {
      value: known ? value : '',
      disabled,
      onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value),
    }, options.map((option) => h('option', {
      key: option.value,
      value: option.value,
      disabled: option.disabled || undefined,
    }, option.label))),
  );
}

export function Row({ title, description, anchor, children }: RowProps): React.ReactElement {
  return h('div', { className: 'drc-row', 'data-drc-anchor': anchor },
    h('div', { className: 'drc-row-main' },
      h('div', { className: 'drc-row-title' }, title),
      description ? h('div', { className: 'drc-row-desc' }, description) : null,
    ),
    h('div', { className: 'drc-row-control' }, children),
  );
}

export function StatusRow({ label, value, detail, okLabel, badLabel, pendingLabel }: StatusRowProps): React.ReactElement {
  const state = value === true ? 'ok' : value === false ? 'bad' : '';
  return h('div', { className: 'drc-status-row' },
    h('div', { className: 'drc-status-main' },
      h('span', { className: 'drc-status-label' }, label),
      detail ? h('span', { className: 'drc-status-detail' }, detail) : null,
    ),
    h('span', { className: 'drc-status' },
      h('i', { className: `drc-dot ${state}` }),
      state === 'ok' ? okLabel : state === 'bad' ? badLabel : pendingLabel,
    ),
  );
}

export function Tag({ children, tone = 'neutral' }: { children?: React.ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'outline' }): React.ReactElement {
  return h('span', { className: 'drc-tag', 'data-tone': tone }, children);
}

export function sectionHead(title: string, desc?: React.ReactNode): React.ReactElement {
  return h('div', { className: 'drc-section-head' },
    h('h2', { className: 'drc-section-title' }, title),
    desc ? h('p', { className: 'drc-intro' }, desc) : null,
  );
}

export function groupHead(title: string, desc?: React.ReactNode, anchor?: string): React.ReactElement {
  return h('div', { className: 'drc-group-head', 'data-drc-anchor': anchor },
    h('h3', { className: 'drc-group-title' }, title),
    desc ? h('p', { className: 'drc-group-desc' }, desc) : null,
  );
}

/** Hints whose sentence contains one phrase that jumps to a related setting. */
export type HintKey =
  | 'advancedHint'
  | 'wakeLockHint'
  | 'quickqaPageHint'
  | 'quickqaImageHint'
  | 'quickqaPushHint'
  | 'notificationsHint';

interface HintLinkSpec {
  /** i18n field for the link label; also the `{field}` placeholder in the text. */
  field: string;
  target: JumpTarget;
}

/**
 * Link phrases stay in their own i18n fields and are referenced from the
 * sentence by a `{field}` placeholder, so a link only underlines the phrase
 * itself instead of the whole hint.
 */
const HINT_LINKS: Record<HintKey, readonly HintLinkSpec[]> = {
  advancedHint: [{ field: 'secureContextLink', target: 'tlsEnable' }],
  wakeLockHint: [{ field: 'secureContextLink', target: 'tlsEnable' }],
  quickqaPageHint: [{ field: 'secureContextLink', target: 'tlsEnable' }],
  quickqaImageHint: [{ field: 'secureContextLink', target: 'tlsEnable' }],
  quickqaPushHint: [{ field: 'quickqaPushLink', target: 'pushQuestions' }],
  notificationsHint: [{ field: 'appNamesLink', target: 'appNames' }],
};

export interface LinkedHintProps {
  hint: HintKey;
  t: Translator;
  onJump: (target: JumpTarget) => void;
}

/** Render one hint sentence with its link fields replaced by jump buttons. */
export function LinkedHint({ hint, t, onJump }: LinkedHintProps): React.ReactElement {
  const text = t(hint);
  const specs = HINT_LINKS[hint];
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
    const spec = specs.find((entry) => entry.field === match[1]);
    if (!spec) continue;
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    parts.push(h('button', {
      key: `${match.index}-${spec.field}`,
      type: 'button',
      className: 'drc-hint-link',
      onClick: () => onJump(spec.target),
    }, t(spec.field)));
    cursor = match.index + match[0].length;
  }
  if (cursor === 0) return h(React.Fragment, null, text);
  if (cursor < text.length) parts.push(text.slice(cursor));
  return h(React.Fragment, null, ...parts);
}
