/**
 * Quick Q&A section: official voice-input gate, reply model, and workspaces.
 *
 * The first block is read-only status. While the official voice input plugin is
 * not ready every following control stays disabled, and the saved settings are
 * left untouched — the Host also refuses to persist quick-Q&A changes then.
 */

import type * as React from 'react';
import { Btn, LinkedHint, Row, Select, Toggle, groupHead, h, sectionHead } from '../ui.js';
import { effectiveQuickQaModel, quickQaImageInput } from '../logic.js';
import type {
  PanelApi,
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
  const selectedGroup = groups.find((group) => group.id === selected.provider) ?? null;

  /** Stage a model change; a text-only target also turns attachments off. */
  function stageModel(provider: string, modelId: string, reasoningEffort: string): void {
    const group = groups.find((entry) => entry.id === provider) ?? null;
    const model = group?.models.find((entry) => entry.id === modelId) ?? null;
    stage({
      quickqa: {
        model: { provider, model: modelId, reasoningEffort },
        ...(model && model.imageInput === false ? { allowImages: false } : {}),
      },
    });
  }

  const providerOptions: Array<{ value: string; label: string }> = [
    { value: '', label: t('quickqaFollowDefault') },
    ...groups.map((group) => ({ value: group.id, label: group.name })),
  ];
  if (selected.provider && !selectedGroup) {
    providerOptions.push({
      value: selected.provider,
      label: `${selected.provider} (${t('quickqaModelUnavailable')})`,
    });
  }

  const models = selectedGroup?.models ?? [];
  const modelOptions: Array<{ value: string; label: string }> = [
    { value: '', label: t('quickqaFollowDefault') },
    ...models.map((model) => ({ value: model.id, label: model.name })),
  ];
  const matched = models.find((model) => model.id === selected.model) ?? null;
  if (selected.model && !matched) {
    modelOptions.push({
      value: selected.model,
      label: `${selected.model} (${t('quickqaModelUnavailable')})`,
    });
  }
  const efforts = matched?.reasoning?.efforts ?? [];
  const effortOptions = [
    { value: '', label: t('quickqaReasoningDefault') },
    ...efforts.map((effort) => ({ value: effort.id, label: effort.name })),
  ];

  return h('div', { className: 'drc-group' },
    groupHead(t('quickqaModelGroup'), t('quickqaModelHint')),
    groups.length === 0
      ? h('p', { className: 'drc-empty' }, t('quickqaModelEmpty'))
      : h('div', { className: 'drc-fields' },
        h(Select, {
          label: t('quickqaProviderField'),
          value: selected.provider ?? '',
          options: providerOptions,
          disabled,
          onChange: (value) => {
            const group = groups.find((entry) => entry.id === value) ?? null;
            const model = group?.models.some((entry) => entry.id === selected.model)
              ? selected.model ?? ''
              : group?.models[0]?.id ?? '';
            const effort = group?.models.find((entry) => entry.id === model)?.reasoning?.defaultEffort ?? '';
            stageModel(value, model, effort);
          },
        }),
        h(Select, {
          label: t('quickqaModelField'),
          value: selected.model ?? '',
          options: modelOptions,
          disabled: disabled || !selectedGroup,
          onChange: (value) => {
            const effort = selectedGroup?.models
              .find((entry) => entry.id === value)?.reasoning?.defaultEffort ?? '';
            stageModel(selected.provider ?? '', value, effort);
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
  const candidates = workspaces.filter((workspace) => workspace.id !== defaultId);
  const pinnedWorkspaces = [...new Set(pinned)]
    .filter((id) => id !== defaultId)
    .map((id) => byId.get(id))
    .filter((workspace): workspace is QuickQaWorkspaceOption => workspace !== undefined);
  const unpinnedWorkspaces = candidates.filter((workspace) => !pinned.includes(workspace.id));
  const dragging = api.draggingWorkspaceId;
  const remaining = dragging ? pinnedWorkspaces.filter((workspace) => workspace.id !== dragging) : pinnedWorkspaces;
  const rawIndex = dragging ? (api.workspaceDragIndex ?? pinnedWorkspaces.findIndex((workspace) => workspace.id === dragging)) : -1;
  const insertAt = dragging ? Math.max(0, Math.min(rawIndex, remaining.length)) : -1;

  function workspaceRow(
    workspace: QuickQaWorkspaceOption,
    checked: boolean,
    locked: boolean,
    options: { dragging?: boolean } = {},
  ): React.ReactElement {
    const isDefault = workspace.id === defaultId;
    const isDragging = options.dragging === true;
    const canDrag = checked && !locked && !disabled && !isDragging;
    return h('div', {
      className: [
        'drc-quickqa-workspace-row',
        'drc-order-row',
        checked ? 'drc-quickqa-draggable' : 'is-disabled',
        locked ? 'is-locked' : '',
        isDragging ? 'is-dragging' : '',
      ].filter(Boolean).join(' '),
      key: workspace.id,
      onPointerDown: canDrag
        ? (event: React.PointerEvent<HTMLElement>) => api.startWorkspaceDrag(workspace.id, event)
        : undefined,
    },
      h('span', {
        className: `drc-drag-handle${canDrag ? '' : ' is-disabled'}`,
        'aria-hidden': 'true',
      }, canDrag ? '⋮⋮' : ''),
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

  const placeholder = (): React.ReactElement => h('div', { className: 'drc-order-placeholder', key: 'workspace-placeholder' },
    h('span', { className: 'drc-drag-handle', 'aria-hidden': 'true' }, '⋮⋮'),
    h('span', { className: 'drc-order-placeholder-title' }, byId.get(dragging ?? '')?.title ?? ''),
  );
  const pinnedRows: React.ReactElement[] = [];
  for (const workspace of pinnedWorkspaces) {
    if (workspace.id === dragging) {
      pinnedRows.push(workspaceRow(workspace, true, false, { dragging: true }));
      continue;
    }
    if (dragging && remaining.findIndex((item) => item.id === workspace.id) === insertAt) pinnedRows.push(placeholder());
    pinnedRows.push(workspaceRow(workspace, true, false));
  }
  if (dragging && insertAt >= remaining.length) pinnedRows.push(placeholder());
  pinnedRows.push(...unpinnedWorkspaces.map((workspace) => workspaceRow(workspace, false, false)));

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
    h('div', { className: 'drc-quickqa-workspaces', ref: api.workspaceListRef }, pinnedRows),
    h('p', { className: 'drc-row-desc' }, h(LinkedHint, { hint: 'quickqaPushHint', t, onJump: api.jump })),
  );
}
function imageGroup(api: PanelApi): React.ReactElement {
  const { t, settings, quickQaOptions, stage, jump } = api;
  const quickQa = settings.quickqa ?? {};
  const catalog = quickQaOptions?.model;
  const imageInput = quickQaImageInput(catalog, quickQa);
  const effective = effectiveQuickQaModel(catalog, quickQa);
  // Unknown support stays off until the live catalog says the route accepts
  // images; a model that explicitly declares text-only stays off for good.
  const supported = imageInput === true;
  const disabled = quickQaOptions?.voice?.ready !== true || !supported;
  return h('div', { className: 'drc-group' },
    groupHead(t('quickqaImageGroup'), h(LinkedHint, { hint: 'quickqaImageHint', t, onJump: jump })),
    h(Row, { title: t('quickqaAllowImages') },
      h(Toggle, {
        checked: supported && quickQa.allowImages === true,
        label: t('quickqaAllowImages'),
        disabled,
        onChange: (checked) => stage({ quickqa: { allowImages: checked } }),
      }),
    ),
    !supported && effective
      ? h('p', { className: 'drc-row-desc' }, t('quickqaImageModelHint'))
      : null,
  );
}

export function renderQuickQa(api: PanelApi): React.ReactElement {
  const { t, quickQaOptions, quickQaBusy, jump } = api;
  const ready = quickQaOptions?.voice?.ready === true;
  const errors = quickQaOptions?.errors ?? [];
  return h('div', { className: 'drc-section' },
    sectionHead(t('menuQuickQa'), h(LinkedHint, { hint: 'quickqaPageHint', t, onJump: jump })),
    quickQaBusy && !quickQaOptions ? h('p', { className: 'drc-row-desc' }, t('quickqaOptionsBusy')) : null,
    errors.length > 0
      ? h('p', { className: 'drc-banner is-error' }, `${t('quickqaOptionsError')} ${errors.join('; ')}`)
      : null,
    voiceGroup(api),
    h('div', { className: `drc-quickqa-groups${ready ? '' : ' drc-quickqa-gated'}` },
      ready ? null : h('p', { className: 'drc-row-desc' }, t('quickqaGateHint')),
      modelGroup(api),
      workspaceGroup(api),
      imageGroup(api),
    ),
  );
}
