/** Presentational primitives styled only through DSH theme tokens. */

import * as React from 'react';

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
}

export interface TextAreaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  mono?: boolean;
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
  description?: string;
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

export function Field({ label, value, onChange, onBlur, placeholder, inputMode, disabled = false }: FieldProps): React.ReactElement {
  return h('label', { className: 'drc-field' },
    h('span', null, label),
    h('input', {
      value: value ?? '',
      placeholder,
      inputMode,
      disabled,
      onBlur,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
    }),
  );
}

export function TextArea({ label, value, onChange, placeholder, rows = 4, disabled = false, mono = false }: TextAreaProps): React.ReactElement {
  return h('label', { className: `drc-field drc-field-area${mono ? ' is-mono' : ''}` },
    h('span', null, label),
    h('textarea', {
      value,
      placeholder,
      rows,
      disabled,
      spellCheck: false,
      autoComplete: 'off',
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

export function Row({ title, description, children }: RowProps): React.ReactElement {  return h('div', { className: 'drc-row' },
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

export function sectionHead(title: string, desc?: string): React.ReactElement {
  return h('div', { className: 'drc-section-head' },
    h('h2', { className: 'drc-section-title' }, title),
    desc ? h('p', { className: 'drc-intro' }, desc) : null,
  );
}

export function groupHead(title: string, desc?: string): React.ReactElement {
  return h('div', { className: 'drc-group-head' },
    h('h3', { className: 'drc-group-title' }, title),
    desc ? h('p', { className: 'drc-group-desc' }, desc) : null,
  );
}
