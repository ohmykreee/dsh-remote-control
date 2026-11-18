/**
 * Live catalogs the Quick Q&A settings and page are allowed to offer.
 *
 * Everything here comes from the running DSH composition — models, workspaces,
 * agent presets, and permission presets (which plugins may extend, e.g. the
 * experimental Auto review preset). Nothing is hard-coded.
 */

import type { DshContext } from '../shared/types.js';
import { isRecord, type JsonRecord } from '../shared/types.js';
import { serializeError } from '../shared/util.js';
import type { QuickQaSettings } from '../settings/index.js';
import { readVoiceStatus } from './voice.js';

export interface QuickQaModelSelection {
  provider: string;
  model: string;
  reasoningEffort: string;
}

export interface QuickQaReasoningEffort {
  id: string;
  name: string;
}

export interface QuickQaModel {
  id: string;
  name: string;
  description?: string;
  reasoning: {
    efforts: QuickQaReasoningEffort[];
    defaultEffort: string;
  } | null;
}

export interface QuickQaModelGroup {
  id: string;
  name: string;
  models: QuickQaModel[];
}

export interface QuickQaModelCatalog {
  default: QuickQaModelSelection;
  groups: QuickQaModelGroup[];
  failures: Array<{ id: string; name: string; message: string }>;
}

export interface QuickQaWorkspace {
  id: string;
  title: string;
  path: string;
}

export interface QuickQaMode {
  id: string;
  name: string;
  description: string;
  broken: string;
}

export interface QuickQaPermissionOption {
  value: string;
  name: string;
  description: string;
}

export interface QuickQaOptions {
  voice: {
    ready: boolean;
    providerName: string;
    language: string;
  };
  model: QuickQaModelCatalog;
  workspaces: QuickQaWorkspace[];
  modes: QuickQaMode[];
  permissions: {
    options: QuickQaPermissionOption[];
    defaultPreset: string;
  };
  errors: string[];
  updatedAt: number;
}

interface AgentPresetLike {
  id?: string;
  name?: string;
  description?: string;
  broken?: string;
  isDefault?: boolean;
}

interface WorkspaceLike {
  id?: string | number;
  title?: string;
  path?: string;
}

interface ModelInfoLike {
  id?: string;
  name?: string;
  description?: string;
}

interface ResolvedModelLike extends ModelInfoLike {
  reasoning?: {
    efforts?: Array<{ id?: string; name?: string }>;
    defaultEffort?: string;
  };
}

interface LlmLike {
  listProviders?(): Array<{ id?: string; name?: string }>;
  listModels?(provider: string): Promise<ModelInfoLike[]>;
  resolveModelInfo?(provider: string, model: string): Promise<ResolvedModelLike>;
}

const EMPTY_SELECTION: QuickQaModelSelection = { provider: '', model: '', reasoningEffort: '' };

function text(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function selectionOf(value: unknown): QuickQaModelSelection {
  if (!isRecord(value)) return { ...EMPTY_SELECTION };
  return {
    provider: text(value.provider, 200),
    model: text(value.model, 300),
    reasoningEffort: text(value.reasoningEffort, 120),
  };
}

function reasoningOf(value: unknown): QuickQaModel['reasoning'] {
  if (!isRecord(value)) return null;
  const effortsRaw = Array.isArray(value.efforts) ? value.efforts : [];
  const efforts: QuickQaReasoningEffort[] = [];
  for (const item of effortsRaw) {
    if (!isRecord(item)) continue;
    const id = text(item.id, 120);
    if (!id) continue;
    efforts.push({ id, name: text(item.name, 160) || id });
  }
  if (efforts.length === 0) return null;
  return { efforts, defaultEffort: text(value.defaultEffort, 120) };
}

async function readModelCatalog(ctx: DshContext, errors: string[]): Promise<QuickQaModelCatalog> {
  const controller = ctx.get?.('sessionController') as
    | { modelCatalog?(): Promise<unknown> }
    | undefined;
  if (controller?.modelCatalog) {
    try {
      const raw = await controller.modelCatalog();
      const record: JsonRecord = isRecord(raw) ? raw : {};
      const groupsRaw = Array.isArray(record.groups) ? record.groups : [];
      const groups: QuickQaModelGroup[] = [];
      for (const group of groupsRaw) {
        if (!isRecord(group)) continue;
        const modelsRaw = Array.isArray(group.models) ? group.models : [];
        const models: QuickQaModel[] = [];
        for (const model of modelsRaw) {
          if (!isRecord(model)) continue;
          const id = text(model.id, 300);
          if (!id) continue;
          models.push({
            id,
            name: text(model.name, 200) || id,
            ...(typeof model.description === 'string' ? { description: text(model.description, 500) } : {}),
            reasoning: reasoningOf(model.reasoning),
          });
        }
        if (models.length === 0) continue;
        groups.push({ id: text(group.id, 200), name: text(group.name, 200) || text(group.id, 200), models });
      }
      const failuresRaw = Array.isArray(record.failures) ? record.failures : [];
      const failures = failuresRaw
        .filter(isRecord)
        .map((entry) => ({
          id: text(entry.id, 200),
          name: text(entry.name, 200) || text(entry.id, 200),
          message: text(entry.message, 500),
        }));
      return { default: selectionOf(record.default), groups, failures };
    } catch (errorValue) {
      errors.push(serializeError(errorValue));
    }
  }

  // Minimal compositions may not mount the session controller but still have
  // the llm registry. Build the same shape from it.
  const llm = ctx.get?.('llm') as LlmLike | undefined;
  const groups: QuickQaModelGroup[] = [];
  const failures: QuickQaModelCatalog['failures'] = [];
  if (llm?.listProviders && llm.listModels) {
    for (const provider of llm.listProviders()) {
      const id = text(provider.id, 200);
      if (!id) continue;
      try {
        const modelsRaw = await llm.listModels(id);
        const models: QuickQaModel[] = [];
        for (const info of Array.isArray(modelsRaw) ? modelsRaw : []) {
          const modelId = text(info.id, 300);
          if (!modelId) continue;
          let resolved: ResolvedModelLike | null = null;
          try {
            resolved = llm.resolveModelInfo ? await llm.resolveModelInfo(id, modelId) : null;
          } catch {
            resolved = null;
          }
          models.push({
            id: modelId,
            name: text(resolved?.name ?? info.name, 200) || modelId,
            ...(typeof (resolved?.description ?? info.description) === 'string'
              ? { description: text(resolved?.description ?? info.description, 500) }
              : {}),
            reasoning: reasoningOf(resolved?.reasoning),
          });
        }
        if (models.length > 0) {
          groups.push({ id, name: text(provider.name, 200) || id, models });
        }
      } catch (errorValue) {
        failures.push({ id, name: text(provider.name, 200) || id, message: serializeError(errorValue) });
      }
    }
  }
  let fallbackDefault: QuickQaModelSelection = { ...EMPTY_SELECTION };
  try {
    const defaults = ctx.get?.('agentDefaultModel') as { currentSelection?(): unknown } | undefined;
    fallbackDefault = selectionOf(defaults?.currentSelection?.());
  } catch {
    fallbackDefault = { ...EMPTY_SELECTION };
  }
  return { default: fallbackDefault, groups, failures };
}

function readWorkspaces(ctx: DshContext, errors: string[]): QuickQaWorkspace[] {
  try {
    const registry = ctx.get?.('workspaceRegistry') as { list?(): WorkspaceLike[] } | undefined;
    const list = registry?.list?.() ?? [];
    const workspaces: QuickQaWorkspace[] = [];
    for (const entry of list) {
      const id = text(entry.id, 300);
      if (!id) continue;
      workspaces.push({
        id,
        title: text(entry.title, 200) || text(entry.path, 400) || id,
        path: text(entry.path, 1000),
      });
    }
    return workspaces;
  } catch (errorValue) {
    errors.push(serializeError(errorValue));
    return [];
  }
}

async function readModes(ctx: DshContext, errors: string[]): Promise<QuickQaMode[]> {
  try {
    const registry = ctx.get?.('agentPresets') as { list?(): Promise<AgentPresetLike[]> } | undefined;
    if (!registry?.list) return [];
    const list = await registry.list();
    const modes: QuickQaMode[] = [];
    for (const entry of Array.isArray(list) ? list : []) {
      const id = text(entry.id, 300);
      if (!id) continue;
      modes.push({
        id,
        name: text(entry.name, 200) || id,
        description: text(entry.description, 500),
        broken: text(entry.broken, 500),
      });
    }
    return modes;
  } catch (errorValue) {
    errors.push(serializeError(errorValue));
    return [];
  }
}

function readPermissions(ctx: DshContext, errors: string[]): QuickQaOptions['permissions'] {
  try {
    const presets = ctx.get?.('permissionPresets') as
      | { catalog?(): { options?: unknown[]; defaultPreset?: string } }
      | undefined;
    const catalog = presets?.catalog?.();
    const options: QuickQaPermissionOption[] = [];
    for (const item of Array.isArray(catalog?.options) ? catalog?.options ?? [] : []) {
      if (!isRecord(item)) continue;
      const value = text(item.value, 200);
      if (!value) continue;
      options.push({
        value,
        name: text(item.name, 200) || value,
        description: text(item.description, 500),
      });
    }
    return { options, defaultPreset: text(catalog?.defaultPreset, 200) };
  } catch (errorValue) {
    errors.push(serializeError(errorValue));
    return { options: [], defaultPreset: '' };
  }
}

/**
 * Read every live catalog. Results are cached briefly because the settings
 * panel polls while its quickqa section is open.
 */
export function createQuickQaCatalog(ctx: DshContext): { read(force?: boolean): Promise<QuickQaOptions> } {
  let cache: Omit<QuickQaOptions, 'voice' | 'updatedAt'> | null = null;
  let cachedAt = 0;
  // Models, workspaces, modes, and presets change rarely; readiness is read
  // fresh on every request so the gate opens as soon as the model is prepared.
  const TTL = 15_000;

  function withVoice(base: Omit<QuickQaOptions, 'voice' | 'updatedAt'>): QuickQaOptions {
    const voice = readVoiceStatus(ctx);
    return {
      ...base,
      voice: { ready: voice.ready, providerName: voice.providerName, language: voice.language },
      updatedAt: Date.now(),
    };
  }

  async function read(force = false): Promise<QuickQaOptions> {
    const now = Date.now();
    if (!force && cache && now - cachedAt < TTL) return withVoice(cache);
    const errors: string[] = [];
    const [model, modes] = await Promise.all([
      readModelCatalog(ctx, errors),
      readModes(ctx, errors),
    ]);
    cache = {
      model,
      workspaces: readWorkspaces(ctx, errors),
      modes,
      permissions: readPermissions(ctx, errors),
      errors,
    };
    cachedAt = now;
    return withVoice(cache);
  }

  return { read };
}

/** Fallback selection when the saved quickqa model is no longer routable. */
export function bestQuickQaSelection(
  saved: QuickQaSettings['model'],
  catalog: QuickQaModelCatalog,
): QuickQaModelSelection {
  const groups = catalog.groups;
  const all = groups.flatMap((group) => group.models.map((model) => ({ provider: group.id, model })));
  const savedId = selectionOf(saved);
  const matched = all.find((entry) => entry.provider === savedId.provider && entry.model.id === savedId.model);
  if (matched) {
    const efforts = matched.model.reasoning?.efforts ?? [];
    const effort = efforts.some((item) => item.id === savedId.reasoningEffort)
      ? savedId.reasoningEffort
      : matched.model.reasoning?.defaultEffort || '';
    return { provider: matched.provider, model: matched.model.id, reasoningEffort: effort };
  }
  const fallback = catalog.default;
  if (fallback.provider && fallback.model) {
    const entry = all.find((item) => item.provider === fallback.provider && item.model.id === fallback.model);
    const effort = entry?.model.reasoning?.efforts.some((item) => item.id === fallback.reasoningEffort)
      ? fallback.reasoningEffort
      : entry?.model.reasoning?.defaultEffort || '';
    return { provider: fallback.provider, model: fallback.model, reasoningEffort: effort };
  }
  const first = all[0];
  if (first) {
    return {
      provider: first.provider,
      model: first.model.id,
      reasoningEffort: first.model.reasoning?.defaultEffort || '',
    };
  }
  return { ...EMPTY_SELECTION };
}
