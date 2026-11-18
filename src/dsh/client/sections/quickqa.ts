/**
 * Quick Q&A section: official voice-input gate, reply model, and workspaces.
 *
 * The first block is read-only status. While the official voice input plugin is
 * not ready every following control stays disabled, and the saved settings are
 * left untouched — the Host also refuses to persist quick-Q&A changes then.
 */

import type * as React from 'react';
import { Btn, Select, groupHead, h, sectionHead } from '../ui.js';
import type {
  PanelApi,
  QuickQaModelOption,
  QuickQaSettings,
  QuickQaWorkspaceOption,
} from '../types.js';

function voiceGroup(api: PanelApi): React.ReactElement {
  const { t, quickQaOptions, quickQaBusy, refreshQuickQaOptions } = api;
  const ready = quickQaOptions?.voice?.ready === true;
  const provider = String(quickQaOptions?.voice?.providerName || '');
  return h('div', { className: 'drc-group' },
    groupHead(t('quickqaVoice'), t('quickqaVoiceHint')),
    h('div', { className: 'drc-quickqa-voice-row' },
      h('span', { className: 'drc-row-desc' }, provider),
      h('span', { className: 'drc-status' },
        h('i', { className: `drc-dot ${ready ? 'ok' : 'bad'}` }),
        ready ? t('quickqaVoiceReady') : t('quickqaVoiceNotReady'),
      ),
      h(Btn, { small: true, disabled: quickQaBusy, onClick: () => void refreshQuickQaOptions(true) }, t('quickqaRefreshStatus')),
    ),
    ready ? null : h('p', { className: 'drc-row-desc' }, t('quickqaVoiceGate')),
  );
}

function modelGroup(api: PanelApi): React.ReactElement {
  const { t, settings, quickQaOptions, stage } = api;
  const quickQa = settings.quickqa ?? {};
  const disabled = quickQaOptions?.voice?.ready !== true;
  const groups = quickQaOptions?.model?.groups ?? [];
  const selected = quickQa.model ?? {};
  const modelOptions: Array<{ value: string; label: string }> = [];
  let matched: QuickQaModelOption | null = null;
  for (const group of groups) {
    for (const model of group.models) {
      const value = JSON.stringify([group.id, model.id]);
      if (selected.provider === group.id && selected.model === model.id) matched = model;
      modelOptions.push({ value, label: `${group.name} · ${model.name}` });
    }
  }
  const savedKey = selected.provider && selected.model
    ? JSON.stringify([selected.provider, selected.model])
    : '';
  if (savedKey && !matched) {
    modelOptions.push({
      value: savedKey,
      label: `${selected.provider} · ${selected.model} (${t('quickqaModelUnavailable')})`,
    });
  }
  const efforts = matched?.reasoning?.efforts ?? [];
  const effortOptions = [
    { value: '', label: t('quickqaReasoningDefault') },
    ...efforts.map((effort) => ({ value: effort.id, label: effort.name })),
  ];
  return h('div', { className: 'drc-group' },
    groupHead(t('quickqaModelGroup'), t('quickqaModelHint')),
    modelOptions.length === 0
      ? h('p', { className: 'drc-empty' }, t('quickqaModelEmpty'))
      : h('div', { className: 'drc-fields' },
        h(Select, {
          label: t('quickqaModelField'),
          value: savedKey,
          options: modelOptions,
          disabled,
          onChange: (value) => {
            let provider = '';
            let model = '';
            try {
              const parsed: unknown = JSON.parse(value);
              if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
                provider = parsed[0];
                model = parsed[1];
              }
            } catch {
              /* keep an empty selection */
            }
            const next = groups
              .find((group) => group.id === provider)
              ?.models.find((entry) => entry.id === model) ?? null;
            const effort = next?.reasoning?.defaultEffort ?? '';
            stage({ quickqa: { model: { provider, model, reasoningEffort: effort } } });
          },
        }),
        h(Select, {
          label: t('quickqaReasoning'),
          value: efforts.some((effort) => effort.id === selected.reasoningEffort)
            ? selected.reasoningEffort ?? ''
            : '',
          options: effortOptions,
          disabled: disabled || efforts.length === 0,
          onChange: (value) => stage({ quickqa: { model: { reasoningEffort: value } } }),
        }),
      ),
  );
}

function workspaceModeSelects(
  api: PanelApi,
  workspace: QuickQaWorkspaceOption,
  quickQa: QuickQaSettings,
  disabled: boolean,
): React.ReactElement {
  const { t, quickQaOptions, stage } = api;
  const modes = (quickQaOptions?.modes ?? []).filter((mode) => !mode.broken);
  const permissions = quickQaOptions?.permissions?.options ?? [];
  const profile = quickQa.profiles?.[workspace.id] ?? {};
  const modeOptions = [
    { value: '', label: t('quickqaFollowDefault') },
    ...modes.map((mode) => ({ value: mode.id, label: mode.name })),
  ];
  const permissionOptions = [
    { value: '', label: t('quickqaFollowDefault') },
    ...permissions.map((option) => ({ value: option.value, label: option.name })),
  ];
  return h('div', { className: 'drc-quickqa-profile' },
    h(Select, {
      label: t('quickqaWorkspaceMode'),
      value: profile.agentPreset ?? '',
      options: modes.length > 0 ? modeOptions : [{ value: '', label: t('quickqaNoModes') }],
      disabled: disabled || modes.length === 0,
      onChange: (value) => stage({ quickqa: { profiles: { [workspace.id]: { agentPreset: value } } } }),
    }),
    h(Select, {
      label: t('quickqaWorkspacePermission'),
      value: profile.permissionPreset ?? '',
      options: permissions.length > 0 ? permissionOptions : [{ value: '', label: t('quickqaNoPermissions') }],
      disabled: disabled || permissions.length === 0,
      onChange: (value) => stage({
        quickqa: { profiles: { [workspace.id]: { permissionPreset: value } } },
      }),
    }),
  );
}

function workspaceGroup(api: PanelApi): React.ReactElement {
  const { t, settings, quickQaOptions, stage } = api;
  const quickQa = settings.quickqa ?? {};
  const disabled = quickQaOptions?.voice?.ready !== true;
  const workspaces = quickQaOptions?.workspaces ?? [];
  const defaultId = quickQa.defaultWorkspaceId ?? '';
  const pinned = quickQa.pinnedWorkspaceIds ?? [];
  const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const defaultWorkspace = byId.get(defaultId) ?? null;
  const pinnedWorkspaces = workspaces.filter((workspace) => workspace.id !== defaultId);

  function workspaceRow(workspace: QuickQaWorkspaceOption, checked: boolean, locked: boolean): React.ReactElement {
    const isDefault = workspace.id === defaultId;
    return h('div', {
      className: `drc-quickqa-workspace-row${checked ? ' is-checked' : ''}`,
      key: workspace.id,
    },
      h('label', { className: 'drc-quickqa-workspace-check' },
        h('input', {
          type: 'checkbox',
          checked,
          disabled: disabled || locked,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
            const next = event.target.checked
              ? [...pinned, workspace.id]
              : pinned.filter((id) => id !== workspace.id);
            stage({
              quickqa: {
                pinnedWorkspaceIds: [...new Set(next)],
                profiles: { [workspace.id]: quickQa.profiles?.[workspace.id] ?? {} },
              },
            });
          },
        }),
        h('span', { className: 'drc-quickqa-workspace-name' },
          h('span', { className: 'drc-row-title' }, workspace.title),
          h('span', { className: 'drc-code' }, workspace.path),
        ),
        isDefault ? h('span', { className: 'drc-tag', 'data-tone': 'info' }, t('quickqaDefaultWorkspace')) : null,
      ),
      workspaceModeSelects(api, workspace, quickQa, disabled || !checked),
    );
  }

  return h('div', { className: 'drc-group' },
    groupHead(t('quickqaWorkspacesGroup'), t('quickqaWorkspacesHint')),
    workspaces.length === 0
      ? h('p', { className: 'drc-empty' }, t('quickqaNoWorkspaces'))
      : h('div', { className: 'drc-fields' },
        h(Select, {
          label: t('quickqaDefaultWorkspace'),
          value: defaultWorkspace ? defaultId : '',
          options: [
            { value: '', label: t('quickqaFollowDefault') },
            ...workspaces.map((workspace) => ({ value: workspace.id, label: workspace.title })),
          ],
          disabled,
          onChange: (value) => {
            const nextPinned = pinned.filter((id) => id !== value);
            stage({
              quickqa: {
                defaultWorkspaceId: value,
                pinnedWorkspaceIds: nextPinned,
                profiles: value ? { [value]: quickQa.profiles?.[value] ?? {} } : {},
              },
            });
          },
        }),
      ),
    defaultWorkspace
      ? h('div', { className: 'drc-quickqa-workspaces' }, workspaceRow(defaultWorkspace, true, true))
      : null,
    h('div', { className: 'drc-divider' }),
    h('div', { className: 'drc-row-main' }, h('div', { className: 'drc-row-title' }, t('quickqaPinnedWorkspaces'))),
    h('div', { className: 'drc-quickqa-workspaces' },
      pinnedWorkspaces.map((workspace) => workspaceRow(workspace, pinned.includes(workspace.id), false)),
    ),
    h('p', { className: 'drc-row-desc' }, t('quickqaPushHint')),
  );
}
export function renderQuickQa(api: PanelApi): React.ReactElement {
  const { t, quickQaOptions, quickQaBusy } = api;
  const ready = quickQaOptions?.voice?.ready === true;
  const errors = quickQaOptions?.errors ?? [];
  return h('div', { className: 'drc-section' },
    sectionHead(t('menuQuickQa'), t('quickqaPageHint')),
    quickQaBusy && !quickQaOptions ? h('p', { className: 'drc-row-desc' }, t('quickqaOptionsBusy')) : null,
    errors.length > 0
      ? h('p', { className: 'drc-banner is-error' }, `${t('quickqaOptionsError')} ${errors.join('; ')}`)
      : null,
    voiceGroup(api),
    h('div', { className: ready ? '' : 'drc-quickqa-gated' },
      ready ? null : h('p', { className: 'drc-row-desc' }, t('quickqaGateHint')),
      modelGroup(api),
      workspaceGroup(api),
    ),
  );
}
