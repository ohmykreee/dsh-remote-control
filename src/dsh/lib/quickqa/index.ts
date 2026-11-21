/**
 * Quick Q&A coordinator.
 *
 * One phone starts a turn by recording audio, transcribing it through the
 * official `speechToText` service, then creating a DSH Session in the selected
 * workspace with the configured agent preset, permission preset, and model.
 * Only the final assistant text reaches the page; reasoning and tool traffic
 * stay behind the "thinking" state.
 */

import crypto from 'node:crypto';
import { hostMessage } from '../i18n/index.js';
import type { PendingInfo, PendingTracker } from '../sessions/index.js';
import type { PluginLocale, QuickQaWorkspaceProfile, RemoteControlSettings } from '../settings/index.js';
import { isRecord, type DshContext, type JsonRecord, type WebSocketClient } from '../shared/types.js';
import { safeString, serializeError } from '../shared/util.js';
import type { RemoteSettingsPayload } from '../server/types.js';
import type {
  PromptContentPart,
  SessionCancelRequest,
  SessionCancelValue,
  SessionCreateRequest,
  SessionCreateValue,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionPromptRequest,
  SessionPromptValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
} from '@deepseek-ai/dsh-api-session-controller/types';
import {
  bestQuickQaSelection,
  createQuickQaCatalog,
  modelSupportsImage,
  type QuickQaModelSelection,
  type QuickQaOptions,
} from './catalog.js';
import {
  createQuickQaImageStore,
  type QuickQaImage,
  type QuickQaImageMediaType,
} from './image.js';
import { isVoiceReady, transcribeAudio } from './voice.js';

export interface QuickQaServiceOptions {
  ctx: DshContext;
  getSettings: () => RemoteControlSettings;
  pending: PendingTracker;
  log: (message: string) => void;
  getLocale: () => PluginLocale;
}

export interface QuickQaService {
  readOptions(force?: boolean): Promise<QuickQaOptions>;
  remoteSettings(): RemoteSettingsPayload['quickqa'];
  isVoiceReady(): boolean;
  /** Whether this profile lets the phone attach one image to a question. */
  canAttachImages(): boolean;
  /** Keep one uploaded image until the next prompt claims it. */
  saveImage(mediaType: QuickQaImageMediaType, data: Uint8Array): QuickQaImage;
  transcribe(audio: Uint8Array, signal: AbortSignal): Promise<{ text: string; audioSeconds: number }>;
  /** Handle one socket frame; returns true when it belonged to Quick Q&A. */
  handleMessage(client: WebSocketClient, message: unknown): Promise<boolean>;
  detach(clientId: string): void;
  dispose(): void;
}

interface SessionLike {
  id?: string;
}

interface AgentsService {
  turnBoundaryOf?(session: SessionLike): { lastTurn?: number | string } | null | undefined;
}

interface SessionsService {
  get?(id: string): SessionLike | undefined;
}

interface PermissionPresetsService {
  set?(session: SessionLike, name: string): void;
}

interface WorkspaceLike {
  id?: string | number;
  title?: string;
  path?: string;
}

interface WorkspaceRegistryService {
  get?(id: string): WorkspaceLike | undefined;
  list?(): WorkspaceLike[];
}

interface SessionControllerService {
  create?(request: SessionCreateRequest): Promise<SessionCreateValue>;
  prompt?(request: SessionPromptRequest, signal?: AbortSignal): Promise<SessionPromptValue>;
  follow?(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame>;
  cancel?(request: SessionCancelRequest): SessionCancelValue;
  selectModel?(request: SessionSelectModelRequest): Promise<SessionSelectModelValue>;
}

interface QuickQaRun {
  client: WebSocketClient;
  sessionId: string;
  workspaceId: string;
  agentPreset: string;
  permissionPreset: string;
  /** The model this run selected; used to gate later image prompts. */
  selection: QuickQaModelSelection;
  busy: boolean;
  abort: AbortController | null;
  turnId: number;
  pendingSignature: string;
}

const FOLLOW_TIMEOUT_MS = 15 * 60_000;
const PENDING_POLL_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function service<T>(ctx: DshContext, name: string): T | undefined {
  try {
    const value = ctx.get?.(name);
    return value && typeof value === 'object' ? (value as T) : undefined;
  } catch {
    return undefined;
  }
}

function messageText(message: unknown): string {
  if (!isRecord(message)) return '';
  const blocks = Array.isArray(message.content) ? message.content : [];
  const parts: string[] = [];
  for (const block of blocks) {
    if (typeof block === 'string') parts.push(block);
    else if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('').trim();
}

/**
 * Read visible assistant text from one process-local stream record.
 *
 * The official follow stream may pack text deltas into `text-chunks`, or send
 * a raw `text-delta`. Reasoning and tool-call records are deliberately ignored;
 * they never reach the phone.
 */
function assistantText(value: unknown): string {
  if (!isRecord(value)) return '';
  if (value.type === 'text-chunks') {
    const texts = Array.isArray(value.texts) ? value.texts : [];
    return texts.filter((entry): entry is string => typeof entry === 'string').join('');
  }
  if (value.type === 'text-delta' && typeof value.text === 'string') return value.text;
  if (value.type === 'chunk' && isRecord(value.chunk)) {
    const chunk = value.chunk;
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') return chunk.text;
  }
  return '';
}

function turnOf(event: JsonRecord): number {
  const data = isRecord(event.data) ? event.data : {};
  return Number(data.turn) || 0;
}

function reasonOf(event: JsonRecord): JsonRecord {
  const data = isRecord(event.data) ? event.data : {};
  return isRecord(data.reason) ? data.reason : {};
}

/** Record the quickqa model selection through the public Session controller. */
async function selectModel(
  deps: QuickQaServiceOptions,
  controller: SessionControllerService | undefined,
  sessionId: string,
  selection: QuickQaModelSelection,
): Promise<void> {
  if (!selection.provider || !selection.model) return;
  if (!controller?.selectModel) {
    deps.log('quickqa: sessionController.selectModel is unavailable');
    return;
  }
  try {
    await controller.selectModel({
      sessionId: sessionId as SessionSelectModelRequest['sessionId'],
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
    });
  } catch (errorValue) {
    deps.log(`quickqa: model selection failed: ${serializeError(errorValue)}`);
  }
}

/** Apply the per-workspace permission preset to the freshly created session. */
function selectPermission(deps: QuickQaServiceOptions, sessionId: string, preset: string): void {
  if (!preset) return;
  const sessions = service<SessionsService>(deps.ctx, 'sessions');
  const session = sessions?.get?.(sessionId);
  if (!session) return;
  const presets = service<PermissionPresetsService>(deps.ctx, 'permissionPresets');
  try {
    presets?.set?.(session, preset);
  } catch (errorValue) {
    deps.log(`quickqa: permission preset rejected: ${serializeError(errorValue)}`);
  }
}

function profileFor(settings: RemoteControlSettings, workspaceId: string): QuickQaWorkspaceProfile {
  return settings.quickqa.profiles[workspaceId] ?? { agentPreset: '', permissionPreset: '' };
}

function allowedWorkspaceIds(settings: RemoteControlSettings): Set<string> {
  return new Set([
    settings.quickqa.defaultWorkspaceId,
    ...settings.quickqa.pinnedWorkspaceIds,
  ].filter(Boolean));
}

function resolveWorkspaceId(deps: QuickQaServiceOptions, requested: string): string {
  const settings = deps.getSettings();
  const allowed = allowedWorkspaceIds(settings);
  const registry = service<WorkspaceRegistryService>(deps.ctx, 'workspaceRegistry');
  const exists = (id: string): boolean => Boolean(id && registry?.get?.(id));
  if (requested && allowed.has(requested) && exists(requested)) return requested;
  const fallback = settings.quickqa.defaultWorkspaceId;
  return fallback && allowed.has(fallback) && exists(fallback) ? fallback : '';
}

export function createQuickQaService(deps: QuickQaServiceOptions): QuickQaService {
  const catalog = createQuickQaCatalog(deps.ctx);
  const images = createQuickQaImageStore();
  const runs = new Map<string, QuickQaRun>();
  /** Last successful catalog read, used for the synchronous settings push. */
  let lastCatalog: QuickQaOptions | null = null;

  function locale(): PluginLocale {
    return deps.getLocale();
  }

  async function readOptions(force = false): Promise<QuickQaOptions> {
    const options = await catalog.read(force);
    lastCatalog = options;
    return options;
  }

  function selectionImageInput(selection: QuickQaModelSelection): boolean {
    const modelCatalog = lastCatalog?.model;
    if (!modelCatalog) return true;
    for (const group of modelCatalog.groups) {
      if (group.id !== selection.provider) continue;
      const model = group.models.find((entry) => entry.id === selection.model);
      if (model) return model.imageInput;
    }
    return true;
  }

  function effectiveSelection(): QuickQaModelSelection {
    const settings = deps.getSettings();
    const modelCatalog = lastCatalog?.model;
    return modelCatalog ? bestQuickQaSelection(settings.quickqa.model, modelCatalog) : settings.quickqa.model;
  }

  function sendError(client: WebSocketClient, key: Parameters<typeof hostMessage>[1], sessionId?: string): void {
    client.send({
      type: 'quickqa-state',
      phase: 'error',
      error: hostMessage(locale(), key),
      ...(sessionId ? { sessionId } : {}),
    });
  }

  function remoteSettings(): RemoteSettingsPayload['quickqa'] {
    const settings = deps.getSettings();
    const registry = service<WorkspaceRegistryService>(deps.ctx, 'workspaceRegistry');
    const workspace = (id: string): { id: string; title: string; path: string } | null => {
      if (!id) return null;
      try {
        const entry = registry?.get?.(id);
        if (!entry) return null;
        return { id, title: safeString(entry.title, 200) || safeString(entry.path, 400) || id, path: safeString(entry.path, 1000) };
      } catch {
        return null;
      }
    };
    const pinned = settings.quickqa.pinnedWorkspaceIds
      .map((id) => workspace(id))
      .filter((entry): entry is { id: string; title: string; path: string } => entry !== null);
    const defaultWorkspace = workspace(settings.quickqa.defaultWorkspaceId);
    return {
      voiceReady: isVoiceReady(deps.ctx),
      defaultWorkspaceId: defaultWorkspace?.id ?? '',
      defaultWorkspaceTitle: defaultWorkspace?.title ?? '',
      pinned,
      pushQuestions: settings.notifications.pushQuestions,
      allowImages: settings.quickqa.allowImages && selectionImageInput(effectiveSelection()),
    };
  }

  function pendingPayload(info: PendingInfo, pushEnabled: boolean): Record<string, unknown> {
    if (!pushEnabled) {
      return {
        kind: info.kind,
        question: '',
        header: '',
        detail: '',
        requestId: '',
        answerable: false,
        count: info.count ?? 1,
        questions: [],
        pushEnabled: false,
      };
    }
    return {
      kind: info.kind,
      question: info.question,
      header: info.header ?? '',
      detail: info.detail ?? '',
      requestId: info.requestId ?? '',
      answerable: info.answerable === true,
      count: info.count ?? 1,
      questions: info.questions ?? [],
      pushEnabled: true,
    };
  }

  function pushPending(run: QuickQaRun, info: PendingInfo | null): void {
    const pushEnabled = deps.getSettings().notifications.pushQuestions;
    const signature = info
      ? `${info.kind}|${info.requestId ?? ''}|${info.answerable === true}|${pushEnabled}`
      : '';
    if (signature === run.pendingSignature) return;
    run.pendingSignature = signature;
    if (!info) {
      run.client.send({ type: 'quickqa-pending', clear: true, sessionId: run.sessionId });
      return;
    }
    run.client.send({
      type: 'quickqa-pending',
      sessionId: run.sessionId,
      ...pendingPayload(info, pushEnabled),
    });
  }

  async function streamAnswer(run: QuickQaRun, text: string, signal: AbortSignal, turnId: number): Promise<void> {
    if (run.turnId !== turnId) return;
    run.client.send({ type: 'quickqa-state', phase: 'streaming', sessionId: run.sessionId, workspaceId: run.workspaceId });
    if (!text) {
      run.client.send({ type: 'quickqa-state', phase: 'done', sessionId: run.sessionId, workspaceId: run.workspaceId, empty: true });
      return;
    }
    const chars = Array.from(text);
    const chunkSize = Math.max(2, Math.ceil(chars.length / 120));
    for (let index = 0; index < chars.length; index += chunkSize) {
      if (signal.aborted || run.turnId !== turnId) return;
      const chunk = chars.slice(index, index + chunkSize).join('');
      run.client.send({ type: 'quickqa-delta', text: chunk, sessionId: run.sessionId });
      await sleep(22);
    }
    if (signal.aborted || run.turnId !== turnId) return;
    run.client.send({ type: 'quickqa-state', phase: 'done', sessionId: run.sessionId, workspaceId: run.workspaceId });
  }

  async function runTurn(
    run: QuickQaRun,
    targetTurn: number,
    controller: SessionControllerService,
    abort: AbortController,
    turnId: number,
  ): Promise<void> {
    if (run.turnId !== turnId) return;
    if (!controller.follow) {
      run.busy = false;
      pushPending(run, null);
      sendError(run.client, 'quickqaFollowUnsupported', run.sessionId);
      return;
    }
    run.abort = abort;
    run.busy = true;
    run.pendingSignature = '';
    let turnEnd: JsonRecord | null = null;
    let answer = '';
    let settled = false;
    let timedOut = false;
    let failed = false;
    /** Visible assistant text accumulated from live assistant stream frames. */
    let liveText = '';
    let liveAttemptId = '';
    let liveStreaming = false;

    /** Append one live text fragment to the phone's streaming answer. */
    const sendLiveText = (text: string): void => {
      if (!text || run.turnId !== turnId) return;
      if (!liveStreaming) {
        liveStreaming = true;
        run.client.send({
          type: 'quickqa-state',
          phase: 'streaming',
          sessionId: run.sessionId,
          workspaceId: run.workspaceId,
        });
      }
      liveText += text;
      run.client.send({ type: 'quickqa-delta', text, sessionId: run.sessionId });
    };

    /** Put each further assistant attempt on a fresh line above the last. */
    const separateLiveAttempt = (): void => {
      if (!liveText || liveText.endsWith('\n\n')) return;
      sendLiveText(liveText.endsWith('\n') ? '\n' : '\n\n');
    };

    /** Rebuild text already streaming when a follow opening carries a baseline. */
    const adoptAssistantBaseline = (value: unknown): void => {
      if (!isRecord(value)) return;
      const attempt = isRecord(value.activeAttempt) ? value.activeAttempt : null;
      if (!attempt || Number(attempt.turn) !== targetTurn) return;
      const attemptId = safeString(attempt.attemptId, 200);
      if (!attemptId) return;
      liveAttemptId = attemptId;
      const records = Array.isArray(attempt.stream) ? attempt.stream : [];
      for (const record of records) {
        const text = assistantText(record);
        if (text) sendLiveText(text);
      }
    };

    const pendingTimer = setInterval(() => {
      try {
        const list = deps.pending.snapshot(run.sessionId);
        pushPending(run, list[0] ?? null);
      } catch {
        /* pending tracking is best-effort */
      }
    }, PENDING_POLL_MS);
    pendingTimer.unref?.();
    const timeout = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, FOLLOW_TIMEOUT_MS);
    timeout.unref?.();

    const processEvent = (event: JsonRecord): void => {
      const type = String(event.type || '');
      if (type === 'turn/start' && turnOf(event) === targetTurn) {
        answer = '';
        return;
      }
      if (type === 'assistant/message' && turnOf(event) === targetTurn) {
        const data = isRecord(event.data) ? event.data : {};
        const message = isRecord(data.message) ? data.message : {};
        const blocks = Array.isArray(message.content) ? message.content : [];
        const hasToolCall = blocks.some((block) => isRecord(block) && block.type === 'tool-call');
        // Visible prose is forwarded live from assistant stream frames; this
        // value is the final text-only message used to reconcile at turn end.
        answer = hasToolCall ? '' : messageText(message);
        return;
      }
      if (type === 'turn/end' && turnOf(event) === targetTurn) {
        turnEnd = event;
        settled = true;
      }
    };

    const processFrame = (value: unknown): void => {
      if (!isRecord(value)) return;
      if (value.type === 'snapshot') {
        const records = Array.isArray(value.records) ? value.records : [];
        for (const record of records) {
          if (!isRecord(record)) continue;
          if (record.type === 'event' && isRecord(record.event)) processEvent(record.event);
          else if (typeof record.type === 'string') processEvent(record);
        }
        adoptAssistantBaseline(value.assistantStream);
        return;
      }
      if (value.type === 'assistant-stream' && isRecord(value.frame)) {
        const frame = value.frame;
        const frameType = String(frame.type || '');
        if (frameType === 'start') {
          if (Number(frame.turn) !== targetTurn) return;
          const attemptId = safeString(frame.attemptId, 200);
          if (!attemptId) return;
          // A new model attempt (for example after a tool call) starts a new
          // visible paragraph instead of overwriting what the user already saw.
          if (liveAttemptId && liveAttemptId !== attemptId) separateLiveAttempt();
          else if (!liveAttemptId && liveText) separateLiveAttempt();
          liveAttemptId = attemptId;
          return;
        }
        if (frameType === 'chunk') {
          if (!liveAttemptId || safeString(frame.attemptId, 200) !== liveAttemptId) return;
          const text = assistantText(frame.chunk);
          if (text) sendLiveText(text);
          return;
        }
        if (frameType === 'end' && safeString(frame.attemptId, 200) === liveAttemptId) {
          liveAttemptId = '';
        }
        return;
      }
      if (value.type === 'event' && isRecord(value.event)) {
        processEvent(value.event);
      }
    };

    try {
      const iterable = controller.follow(
        {
          address: { kind: 'session', sessionId: run.sessionId } as SessionFollowRequest['address'],
          assistantStream: true,
        },
        abort.signal,
      );
      const iterator = iterable[Symbol.asyncIterator]();
      while (!abort.signal.aborted) {
        const next = await iterator.next();
        if (next.done) break;
        processFrame(next.value);
        if (settled) {
          await iterator.return?.(undefined);
          break;
        }
      }
    } catch (errorValue) {
      if (!abort.signal.aborted) {
        failed = true;
        deps.log(`quickqa: follow failed: ${serializeError(errorValue)}`);
        sendError(run.client, 'quickqaRunFailed', run.sessionId);
      }
    } finally {
      clearInterval(pendingTimer);
      clearTimeout(timeout);
      if (run.turnId === turnId && run.abort === abort) run.abort = null;
    }

    if (run.turnId !== turnId) return;
    if (failed) {
      run.busy = false;
      pushPending(run, null);
      return;
    }
    if (abort.signal.aborted) {
      run.busy = false;
      pushPending(run, null);
      if (timedOut) sendError(run.client, 'quickqaRunFailed', run.sessionId);
      return;
    }
    if (!turnEnd) {
      run.busy = false;
      pushPending(run, null);
      sendError(run.client, 'quickqaRunFailed', run.sessionId);
      return;
    }

    const reason = reasonOf(turnEnd);
    const kind = String(reason.kind || 'completed');
    if (kind === 'error') {
      const detail = isRecord(reason.error) ? String(reason.error.message || '') : '';
      run.busy = false;
      pushPending(run, null);
      run.client.send({
        type: 'quickqa-state',
        phase: 'error',
        sessionId: run.sessionId,
        workspaceId: run.workspaceId,
        error: detail || hostMessage(locale(), 'quickqaRunFailed'),
      });
      return;
    }
    if (kind === 'blocked' || kind === 'interrupted' || kind === 'aborted') {
      run.busy = false;
      pushPending(run, null);
      sendError(run.client, kind === 'blocked' ? 'turnBlocked' : 'quickqaTurnStopped', run.sessionId);
      return;
    }

    try {
      if (liveText) {
        const finalText = String(answer || '').trim();
        if (finalText && !liveText.trimEnd().endsWith(finalText)) {
          separateLiveAttempt();
          sendLiveText(finalText);
        }
        run.client.send({
          type: 'quickqa-state',
          phase: 'done',
          sessionId: run.sessionId,
          workspaceId: run.workspaceId,
        });
      } else {
        // Older Hosts or a session without process-local stream frames still
        // receive the final answer through the existing paced fallback.
        await streamAnswer(run, answer, abort.signal, turnId);
      }
    } finally {
      run.busy = false;
      pushPending(run, null);
    }
  }

  async function prompt(
    run: QuickQaRun,
    text: string,
    image: QuickQaImage | null,
    controller: SessionControllerService,
    agents: AgentsService | undefined,
    sessions: SessionsService | undefined,
  ): Promise<void> {
    const session = sessions?.get?.(run.sessionId);
    let baseline = 0;
    try {
      baseline = Number(agents?.turnBoundaryOf?.(session ?? {})?.lastTurn) || 0;
    } catch {
      baseline = 0;
    }
    const targetTurn = baseline + 1;
    const turnId = ++run.turnId;
    const abort = new AbortController();
    run.abort = abort;
    run.busy = true;
    run.client.send({
      type: 'quickqa-state',
      phase: 'thinking',
      sessionId: run.sessionId,
      workspaceId: run.workspaceId,
      question: text,
    });
    const content: PromptContentPart[] = [{ type: 'text', text }];
    if (image) content.push({ type: 'image', mediaType: image.mediaType, data: image.data });
    try {
      await controller.prompt?.({
        requestId: crypto.randomUUID() as SessionPromptRequest['requestId'],
        sessionId: run.sessionId as SessionPromptRequest['sessionId'],
        mode: 'queue',
        content,
      }, abort.signal);
    } catch (errorValue) {
      if (run.turnId !== turnId) return;
      run.busy = false;
      if (run.abort === abort) run.abort = null;
      if (abort.signal.aborted) return;
      deps.log(`quickqa: prompt failed: ${serializeError(errorValue)}`);
      const rejectedByImage = image !== null && /image|attachment/i.test(serializeError(errorValue));
      sendError(run.client, rejectedByImage ? 'quickqaImageRejected' : 'quickqaPromptFailed', run.sessionId);
      return;
    }
    if (run.turnId !== turnId) return;
    if (abort.signal.aborted) {
      run.busy = false;
      if (run.abort === abort) run.abort = null;
      return;
    }
    await runTurn(run, targetTurn, controller, abort, turnId);
  }

  async function startNew(
    client: WebSocketClient,
    text: string,
    requestedWorkspaceId: string,
    image: QuickQaImage | null,
  ): Promise<void> {
    const controller = service<SessionControllerService>(deps.ctx, 'sessionController');
    if (!controller?.create || !controller.prompt) {
      sendError(client, 'quickqaUnsupported');
      return;
    }
    const settings = deps.getSettings();
    const workspaceId = resolveWorkspaceId(deps, requestedWorkspaceId);
    const profile = profileFor(settings, workspaceId);
    const options = await readOptions();
    const selection = bestQuickQaSelection(settings.quickqa.model, options.model);
    const imageInput = await modelSupportsImage(deps.ctx, selection);
    if (image && !imageInput) {
      sendError(client, 'quickqaImageModel');
      return;
    }
    const placeholder: QuickQaRun = {
      client,
      sessionId: '',
      workspaceId,
      agentPreset: profile.agentPreset,
      permissionPreset: profile.permissionPreset,
      selection,
      busy: true,
      abort: null,
      turnId: 0,
      pendingSignature: '',
    };
    runs.set(client.id, placeholder);
    try {
      const created = await controller.create({
        ...(workspaceId ? { workspaceId: workspaceId as SessionCreateRequest['workspaceId'] } : {}),
        ...(profile.agentPreset ? { agentPreset: profile.agentPreset } : {}),
      });
      const sessionId = safeString(created?.sessionId, 300);
      if (!sessionId) throw new Error('session was not created');
      placeholder.sessionId = sessionId;
      await selectModel(deps, controller, sessionId, selection);
      selectPermission(deps, sessionId, profile.permissionPreset);
      const agents = service<AgentsService>(deps.ctx, 'agents');
      const sessions = service<SessionsService>(deps.ctx, 'sessions');
      await prompt(placeholder, text, image, controller, agents, sessions);
    } catch (errorValue) {
      runs.delete(client.id);
      deps.log(`quickqa: session creation failed: ${serializeError(errorValue)}`);
      client.send({
        type: 'quickqa-state',
        phase: 'error',
        error: hostMessage(locale(), 'quickqaCreateFailed', { error: serializeError(errorValue) }),
      });
    }
  }

  async function followUp(
    client: WebSocketClient,
    run: QuickQaRun,
    text: string,
    image: QuickQaImage | null,
  ): Promise<void> {
    const controller = service<SessionControllerService>(deps.ctx, 'sessionController');
    if (!controller?.prompt) {
      sendError(client, 'quickqaUnsupported', run.sessionId);
      return;
    }
    if (image) {
      const supported = run.selection.provider && run.selection.model
        ? await modelSupportsImage(deps.ctx, run.selection)
        : true;
      if (!supported) {
        sendError(client, 'quickqaImageModel', run.sessionId);
        return;
      }
    }
    const agents = service<AgentsService>(deps.ctx, 'agents');
    const sessions = service<SessionsService>(deps.ctx, 'sessions');
    await prompt(run, text, image, controller, agents, sessions);
  }

  async function handleAsk(client: WebSocketClient, message: JsonRecord): Promise<void> {
    const text = safeString(message.text, 20_000).trim();
    if (!text) {
      sendError(client, 'quickqaEmptyText');
      return;
    }
    if (!isVoiceReady(deps.ctx)) {
      sendError(client, 'quickqaVoiceNotReady');
      return;
    }
    let run = runs.get(client.id) ?? null;
    if (run?.busy) {
      sendError(client, 'quickqaBusy', run.sessionId || undefined);
      return;
    }
    const requestedSession = safeString(message.sessionId, 300);
    if (requestedSession && (!run || run.sessionId !== requestedSession)) {
      sendError(client, 'quickqaUnknownSession');
      return;
    }
    let image: QuickQaImage | null = null;
    const imageId = safeString(message.imageId, 120).trim();
    if (imageId) {
      if (!deps.getSettings().quickqa.allowImages) {
        sendError(client, 'quickqaImageNotAllowed', run?.sessionId || undefined);
        return;
      }
      image = images.take(imageId);
      if (!image) {
        sendError(client, 'quickqaImageExpired', run?.sessionId || undefined);
        return;
      }
    }
    if (requestedSession && run) {
      await followUp(client, run, text, image);
      return;
    }
    if (run) runs.delete(client.id);
    await startNew(client, text, safeString(message.workspaceId, 300), image);
  }

  function cancelActiveTurn(run: QuickQaRun): void {
    const controller = service<SessionControllerService>(deps.ctx, 'sessionController');
    try {
      controller?.cancel?.({ sessionId: run.sessionId as SessionCancelRequest['sessionId'] });
    } catch (errorValue) {
      deps.log(`quickqa: cancel failed: ${serializeError(errorValue)}`);
    }
  }

  async function handleMessage(client: WebSocketClient, message: unknown): Promise<boolean> {
    if (!isRecord(message)) return false;
    if (message.type === 'quickqa-ask') {
      await handleAsk(client, message);
      return true;
    }
    if (message.type === 'quickqa-stop') {
      const run = runs.get(client.id);
      if (run?.busy && run.sessionId) {
        run.turnId += 1;
        run.abort?.abort();
        cancelActiveTurn(run);
        run.busy = false;
        run.client.send({
          type: 'quickqa-state',
          phase: 'done',
          sessionId: run.sessionId,
          workspaceId: run.workspaceId,
          stopped: true,
        });
      }
      return true;
    }
    if (message.type === 'quickqa-reset') {
      const run = runs.get(client.id);
      if (run) {
        if (run.busy) cancelActiveTurn(run);
        run.abort?.abort();
        runs.delete(client.id);
      }
      return true;
    }
    return false;
  }

  return {
    readOptions,
    remoteSettings,
    isVoiceReady: () => isVoiceReady(deps.ctx),
    canAttachImages: () => deps.getSettings().quickqa.allowImages && selectionImageInput(effectiveSelection()),
    saveImage(mediaType, data) {
      if (!deps.getSettings().quickqa.allowImages || !selectionImageInput(effectiveSelection())) {
        throw new Error('image-not-allowed');
      }
      return images.save(mediaType, data);
    },
    async transcribe(audio: Uint8Array, signal: AbortSignal) {
      if (!audio || audio.length < 44) throw new Error('voice-input-empty');
      if (!isVoiceReady(deps.ctx)) throw new Error('voice-input-not-ready');
      return transcribeAudio(deps.ctx, audio, signal);
    },
    handleMessage,
    detach(clientId: string) {
      const run = runs.get(clientId);
      if (!run) return;
      if (run.busy) cancelActiveTurn(run);
      run.abort?.abort();
      runs.delete(clientId);
    },
    dispose() {
      for (const run of runs.values()) {
        if (run.busy) cancelActiveTurn(run);
        run.abort?.abort();
      }
      runs.clear();
      images.clear();
    },
  };
}
